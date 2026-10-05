#!/usr/bin/env python3
"""RSVP audio analyzer.

Captures the active PipeWire/PulseAudio sink monitor with parec, derives a
smoothed bass + musical-energy envelope, and publishes those two normalized
features to the local RSVP server. Hue color remains scene-owned; these values
only drive the adapter's rate-limited brightness breathing.
"""

from __future__ import annotations

import json
import math
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable

import numpy as np

SAMPLE_RATE = int(os.getenv("ANALYZER_SAMPLE_RATE", "48000"))
CHUNK_FRAMES = int(os.getenv("ANALYZER_CHUNK_FRAMES", "4096"))
CHANNELS = int(os.getenv("ANALYZER_CHANNELS", "2"))
POST_INTERVAL = float(os.getenv("ANALYZER_POST_INTERVAL_SECONDS", "0.25"))
LOG_INTERVAL = float(os.getenv("ANALYZER_STATUS_LOG_INTERVAL_SECONDS", "10"))
SERVER_URL = os.getenv("ANALYZER_SERVER_URL", "http://127.0.0.1:3000/features")
SOURCE_OVERRIDE = os.getenv("ANALYZER_SOURCE", "").strip()

BASS_LOW_HZ = 35.0
BASS_HIGH_HZ = 220.0
ENERGY_LOW_HZ = 90.0
ENERGY_HIGH_HZ = 5000.0

_RUNNING = True


def _signal_handler(_sig, _frame):
    global _RUNNING
    _RUNNING = False


def _run_text(argv: list[str], timeout: float = 2.0) -> str:
    completed = subprocess.run(
        argv,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    return completed.stdout.strip()


def parse_sources(text: str) -> list[str]:
    sources: list[str] = []
    for raw in text.splitlines():
        cols = raw.split("\t")
        if len(cols) >= 2 and cols[1].strip():
            sources.append(cols[1].strip())
    return sources


def choose_monitor_source(sources: Iterable[str], default_sink: str = "", override: str = "") -> str:
    items = [str(x).strip() for x in sources if str(x).strip()]
    if override:
        exact = next((x for x in items if x == override), None)
        if exact:
            return exact
        partial = next((x for x in items if override.lower() in x.lower()), None)
        if partial:
            return partial
        raise RuntimeError(f"configured monitor source not found: {override}")

    preferred = f"{default_sink}.monitor" if default_sink else ""
    if preferred and preferred in items:
        return preferred

    monitors = [x for x in items if x.lower().endswith(".monitor") or ".monitor" in x.lower()]
    if monitors:
        return monitors[0]
    raise RuntimeError("no PulseAudio/PipeWire monitor source found")


def discover_monitor_source() -> str:
    sources = parse_sources(_run_text(["pactl", "list", "short", "sources"]))
    default_sink = ""
    try:
        default_sink = _run_text(["pactl", "get-default-sink"])
    except Exception:
        pass
    return choose_monitor_source(sources, default_sink=default_sink, override=SOURCE_OVERRIDE)


@dataclass
class AdaptiveLevel:
    floor: float
    peak: float
    decay: float = 0.997
    attack: float = 0.38
    release: float = 0.16
    smoothed: float = 0.0

    def update(self, raw: float) -> float:
        value = max(0.0, float(raw))
        self.peak = max(value, self.peak * self.decay, self.floor * 4.0)
        if value <= self.floor:
            target = 0.0
        else:
            target = min(1.0, (value - self.floor) / max(self.peak - self.floor, self.floor))
        alpha = self.attack if target > self.smoothed else self.release
        self.smoothed += (target - self.smoothed) * alpha
        if self.smoothed < 0.002:
            self.smoothed = 0.0
        return max(0.0, min(1.0, self.smoothed))


def _band_rms(psd: np.ndarray, freqs: np.ndarray, low: float, high: float) -> float:
    """Return RMS energy integrated across a frequency band."""
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask) or freqs.size < 2:
        return 0.0
    bin_width_hz = float(freqs[1] - freqs[0])
    power = float(np.sum(psd[mask]) * bin_width_hz)
    return math.sqrt(max(0.0, power))


def spectral_levels(interleaved: np.ndarray, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS) -> tuple[float, float]:
    data = np.asarray(interleaved, dtype=np.float32)
    if channels > 1:
        if data.size % channels:
            data = data[: data.size - (data.size % channels)]
        data = data.reshape(-1, channels).mean(axis=1)
    if data.size < 32:
        return 0.0, 0.0

    mono = data.astype(np.float64, copy=False)
    mono = mono - float(np.mean(mono))
    window = np.hanning(mono.size)
    window_power = float(np.sum(np.square(window)))
    if window_power <= 0 or sample_rate <= 0:
        return 0.0, 0.0
    fft = np.fft.rfft(mono * window)
    psd = np.square(np.abs(fft)) / (float(sample_rate) * window_power)
    if psd.size > 1:
        if mono.size % 2 == 0 and psd.size > 2:
            psd[1:-1] *= 2.0
        else:
            psd[1:] *= 2.0
    freqs = np.fft.rfftfreq(mono.size, d=1.0 / float(sample_rate))
    bass = _band_rms(psd, freqs, BASS_LOW_HZ, BASS_HIGH_HZ)
    energy = _band_rms(psd, freqs, ENERGY_LOW_HZ, ENERGY_HIGH_HZ)
    return bass, energy


def validate_features_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.path != "/features"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("ANALYZER_SERVER_URL must be loopback HTTP ending exactly in /features")
    return url


def post_features(url: str, bass: float, energy: float, timeout: float = 0.5) -> bool:
    payload = json.dumps({"bass": float(bass), "energy": float(energy)}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= int(response.status) < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _read_exact(stream, size: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total < size and _RUNNING:
        chunk = stream.read(size - total)
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
    return b"".join(chunks)


def main() -> int:
    validate_features_url(SERVER_URL)
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    try:
        source = discover_monitor_source()
    except Exception as exc:
        print(f"[analyzer] monitor discovery failed: {exc}", file=sys.stderr, flush=True)
        return 3

    print(f"[analyzer] source={source} rate={SAMPLE_RATE} frames={CHUNK_FRAMES}", flush=True)
    argv = [
        "parec",
        "--raw",
        "--format=float32le",
        f"--rate={SAMPLE_RATE}",
        f"--channels={CHANNELS}",
        f"--device={source}",
    ]
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=None, bufsize=0)
    except OSError as exc:
        print(f"[analyzer] unable to start parec: {exc}", file=sys.stderr, flush=True)
        return 4

    bass_level = AdaptiveLevel(floor=0.00015, peak=0.003)
    energy_level = AdaptiveLevel(floor=0.00012, peak=0.0025, attack=0.28, release=0.12)
    bytes_per_chunk = CHUNK_FRAMES * CHANNELS * 4
    last_post = 0.0
    last_log = 0.0

    try:
        assert proc.stdout is not None
        while _RUNNING:
            raw = _read_exact(proc.stdout, bytes_per_chunk)
            if len(raw) != bytes_per_chunk:
                if proc.poll() is not None:
                    print(f"[analyzer] parec exited with code {proc.returncode}", file=sys.stderr, flush=True)
                    return 5
                continue

            samples = np.frombuffer(raw, dtype="<f4")
            bass_raw, energy_raw = spectral_levels(samples)
            bass = bass_level.update(bass_raw)
            energy = energy_level.update(energy_raw)

            now = time.monotonic()
            if now - last_post >= POST_INTERVAL:
                post_features(SERVER_URL, bass, energy)
                last_post = now
            if LOG_INTERVAL > 0 and now - last_log >= LOG_INTERVAL:
                print(f"[analyzer] bass={bass:.3f} energy={energy:.3f}", flush=True)
                last_log = now
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        print("[analyzer] stopped", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())