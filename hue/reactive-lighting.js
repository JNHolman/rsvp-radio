"use strict";

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function clampBrightness(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(254, Math.round(n)));
}

function createReactiveLighting({ minIntervalMs = 1800, range = 36 } = {}) {
  let smoothBass = 0;
  let smoothEnergy = 0;
  let lastWriteAt = 0;
  let lastBrightness = null;
  let baseBrightness = null;
  let suppressedUntil = 0;
  let poweredOn = true;

  function onSceneTransition(nowMs, durMs) {
    const now = Number(nowMs) || Date.now();
    const dur = Math.max(0, Number(durMs) || 0);
    suppressedUntil = now + dur;
    baseBrightness = null;
    lastBrightness = null;
    smoothBass = 0;
    smoothEnergy = 0;
  }

  function onPower(on) {
    poweredOn = !!on;
    if (!poweredOn) {
      baseBrightness = null;
      lastBrightness = null;
      smoothBass = 0;
      smoothEnergy = 0;
    }
  }

  function setBaseBrightness(value) {
    baseBrightness = clampBrightness(value);
    return baseBrightness;
  }

  function getBaseBrightness() { return baseBrightness; }

  function plan({ bass, energy, nowMs = Date.now() }) {
    const now = Number(nowMs) || Date.now();
    const b = clamp01(bass);
    const e = clamp01(energy);

    // Smooth enough to breathe with the music without twitching on individual
    // analyzer samples. Bass leads; energy provides a slower room-level lift.
    // Exact silence is special: return to the scene baseline immediately at
    // the policy layer and let Hue's short transition provide the soft decay.
    // This also guarantees analyzer loss cannot strand the room above baseline.
    if (b === 0 && e === 0) {
      smoothBass = 0;
      smoothEnergy = 0;
    } else {
      smoothBass += (b - smoothBass) * 0.34;
      smoothEnergy += (e - smoothEnergy) * 0.18;
    }

    if (!poweredOn) return { kind: "hold", reason: "power_off" };
    if (now < suppressedUntil) return { kind: "hold", reason: "scene_transition" };
    if (baseBrightness === null) return { kind: "need_base" };
    if (lastWriteAt && now - lastWriteAt < minIntervalMs) return { kind: "hold", reason: "rate_limited" };

    const drive = Math.max(0, Math.min(1, (smoothBass * 0.72) + (smoothEnergy * 0.28)));
    const target = clampBrightness(baseBrightness + Math.round(drive * range));
    if (lastBrightness !== null && Math.abs(target - lastBrightness) < 2) {
      return { kind: "hold", reason: "below_delta", target };
    }

    lastWriteAt = now;
    lastBrightness = target;
    return { kind: "apply", brightness: target, drive };
  }

  function markWriteFailed() {
    lastWriteAt = 0;
    lastBrightness = null;
  }

  function snapshot() {
    return { smoothBass, smoothEnergy, lastWriteAt, lastBrightness, baseBrightness, suppressedUntil, poweredOn };
  }

  return { onSceneTransition, onPower, setBaseBrightness, getBaseBrightness, plan, markWriteFailed, snapshot };
}

module.exports = { createReactiveLighting, clampBrightness };
