/**
 * public/app/background.js
 * Background video crossfade and memory-safe reload.
 *
 * Rules:
 *   1. Always load into the BACK buffer first.
 *   2. Only detach the FRONT buffer after back is playing and faded in.
 *   3. Boot: one load, one play, done — no swap on startup.
 *   4. Reload uses the same crossfade path as a day/night swap — no gap, no flash.
 */

const _bgA = document.getElementById("bgA");
const _bgB = document.getElementById("bgB");

let _front      = _bgA;
let _back       = _bgB;
let _currentSrc = null;
let _lastReload = Date.now();

// ── Internals ─────────────────────────────────────────────────────────────────

function _setSrc(video, src) {
  if (video.getAttribute("src") !== src) {
    video.setAttribute("src", src);
    video.load();
  }
}

function _detach(video) {
  try { video.pause(); } catch (_) {}
  video.classList.remove("on");
  video.removeAttribute("src");
  try { video.load(); } catch (_) {}
}

async function _crossfadeTo(src) {
  const oldFront = _front;
  const oldBack  = _back;

  _setSrc(oldBack, src);
  try { await oldBack.play(); } catch (_) {}

  oldBack.classList.add("on");
  oldFront.classList.remove("on");

  // Detach old front after CSS transition finishes
  setTimeout(() => {
    _detach(oldFront);
    _front      = oldBack;
    _back       = oldFront;
    _currentSrc = src;
  }, BG_CROSSFADE_MS + 50);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function bootBackground() {
  _currentSrc = isDayTime() ? BG_DAY : BG_NIGHT;
  _setSrc(_front, _currentSrc);
  _front.classList.add("on");
  try { await _front.play(); } catch (_) {}
  _detach(_back);
}

async function swapBackgroundIfNeeded(force = false) {
  // Never swap ambient background while music video is active
  if (_inMusicMode) return;
  const want = isDayTime() ? BG_DAY : BG_NIGHT;
  if (!force && want === _currentSrc) return;
  await _crossfadeTo(want);
}

async function reloadCurrentVideoIfDue() {
  // Never reload ambient background while music video is active
  if (_inMusicMode) return;
  if (Date.now() - _lastReload < BG_RELOAD_MS) return;
  _lastReload = Date.now();
  console.log("[bg] Reloading video through back buffer");
  await _crossfadeTo(_currentSrc);
}

function startBackgroundTimers() {
  setInterval(() => swapBackgroundIfNeeded(false), BG_CHECK_MS);
  setInterval(reloadCurrentVideoIfDue, 60 * 1000);
}

// ── Music video mode ──────────────────────────────────────────────────────────
// enterMusicVideoMode() fades in a #musicVideo element over the ambient bg.
// exitMusicVideoMode()  fades it back out and cleans up.
// The background videos keep running behind it — no gap on exit.

const _musicVideo   = document.getElementById("musicVideo");
const _blackHold    = document.getElementById("blackHold");
let _inMusicMode    = false;
let _musicActiveKey = null;
let _cleanupToken   = 0;
let _musicEnded     = false;
// Failed video cooldown — if a mediaUrl fails, don't retry it for 20 seconds
const _failedUrls   = new Map(); // mediaUrl → failedAtMs
const FAIL_COOLDOWN_MS = 20000;

function isMusicVideoEnded() { return _musicEnded; }
function isMusicVideoFailed(mediaUrl) { return _isFailedUrl(mediaUrl); }

function _isFailedUrl(mediaUrl) {
  const failedAt = _failedUrls.get(mediaUrl);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAIL_COOLDOWN_MS) {
    _failedUrls.delete(mediaUrl);
    return false;
  }
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _showBlackHold(on) {
  if (_blackHold) _blackHold.classList.toggle("on", !!on);
}

// Full cleanup on video failure — invalidates any pending event listeners.
// Also notifies the server so it can resume Plexamp and stop reporting the
// failed video as active. Without this, the server stays in video mode while
// the browser is in audio mode — Plexamp stays paused, no music plays.
function failMusicVideoMode(mediaUrl) {
  ++_cleanupToken;
  if (mediaUrl) _failedUrls.set(mediaUrl, Date.now()); // cooldown this URL
  _inMusicMode    = false;
  _musicActiveKey = null;
  _musicEnded     = false;
  _showBlackHold(false);
  _musicVideo.classList.remove("on");
  _musicVideo.removeAttribute("src");
  try { _musicVideo.load(); } catch (_) {}
  document.getElementById("nowCard")?.classList.remove("on");
  swapBackgroundIfNeeded(true);

  // Tell the server. Fire-and-forget — never block recovery on this.
  if (mediaUrl) {
    fetch("/video-failed", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ mediaUrl }),
    }).catch(() => {});
  }
}

async function enterMusicVideoMode(mediaUrl, playerState = "playing") {
  if (_inMusicMode && _musicActiveKey === mediaUrl) return;

  // Don't retry a recently failed video — prevents retry loop
  if (_isFailedUrl(mediaUrl)) {
    console.warn("[bg] Skipping recently failed video:", mediaUrl);
    return;
  }

  // Hide ambient backgrounds, show explicit black hold during transition
  _front.classList.remove("on");
  _back.classList.remove("on");
  _showBlackHold(true);

  const myToken = ++_cleanupToken;

  if (_inMusicMode && _musicActiveKey !== mediaUrl) {
    // Hard stop old video audio immediately — don't wait for fade
    try { _musicVideo.pause(); _musicVideo.currentTime = 0; } catch (_) {}
    _musicVideo.removeAttribute("src");
    try { _musicVideo.load(); } catch (_) {}
    _musicVideo.classList.remove("on");
    document.getElementById("nowCard")?.classList.remove("on");
    if (_cleanupToken !== myToken) return;
  }

  _inMusicMode    = true;
  _musicActiveKey = mediaUrl;
  _musicEnded     = false;

  // ── Attach listeners BEFORE setting src ──────────────────────────────────
  // Fast local files can fire events before listeners are attached if src is set first.

  // Metadata load timeout — if video doesn't load in 8s, treat as failure
  const loadTimer = setTimeout(() => {
    if (_cleanupToken === myToken) {
      console.warn("[bg] Video metadata timeout:", mediaUrl);
      failMusicVideoMode(mediaUrl);
    }
  }, 8000);

  _musicVideo.addEventListener("ended", function onEnded() {
    if (_cleanupToken !== myToken) return;
    clearTimeout(loadTimer);
    _musicEnded = true;
    console.log("[bg] Video ended naturally");
    // Tell the server the clip finished so admin video mode can auto-advance.
    try {
      const _b = JSON.stringify({ event: "ended", mediaUrl: mediaUrl });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/log", new Blob([_b], { type: "application/json" }));
      } else {
        fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: _b, keepalive: true }).catch(() => {});
      }
    } catch (_) {}
    _musicVideo.classList.remove("on");
    _showBlackHold(true);
    document.getElementById("nowCard")?.classList.remove("on");
  }, { once: true });

  _musicVideo.addEventListener("playing", function onPlaying() {
    if (_cleanupToken !== myToken) return;
    clearTimeout(loadTimer);
    _showBlackHold(false);
    _musicVideo.classList.add("on");
    document.getElementById("nowCard")?.classList.add("on");
  }, { once: true });

  _musicVideo.addEventListener("loadedmetadata", function onMeta() {
    if (_cleanupToken !== myToken) return;
    if (playerState !== "paused") {
      _musicVideo.play().catch((err) => {
        console.warn("[bg] Video play failed:", err.message);
        if (_cleanupToken === myToken) failMusicVideoMode(mediaUrl);
      });
    }
  }, { once: true });

  // Error handler — catches 404, 403, codec failures etc.
  _musicVideo.addEventListener("error", function onError() {
    if (_cleanupToken !== myToken) return;
    clearTimeout(loadTimer);
    // Send one narrow telemetry beacon so playback failures are visible in
    // journalctl can show what went wrong. Single fire, never re-attached
    // (listener is { once: true }), no main-thread cost during normal play.
    try {
      const err = _musicVideo.error;
      const body = JSON.stringify({
        event:        "error",
        mediaUrl,
        currentTime:  Number.isFinite(_musicVideo.currentTime) ? _musicVideo.currentTime : 0,
        duration:     Number.isFinite(_musicVideo.duration)    ? _musicVideo.duration    : 0,
        readyState:   _musicVideo.readyState,
        networkState: _musicVideo.networkState,
        errorCode:    err ? err.code : 0,
        errorMsg:     err ? err.message || "" : "",
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch (_) {}
    console.warn("[bg] Video element error:", mediaUrl);
    failMusicVideoMode(mediaUrl);
  }, { once: true });

  // Set src AFTER listeners are attached
  _musicVideo.src = mediaUrl;
}

function exitMusicVideoMode() {
  if (!_inMusicMode) return;
  const myToken = ++_cleanupToken; // invalidate pending listeners and old cleanup
  _inMusicMode    = false;
  _musicActiveKey = null;
  _musicEnded     = false;

  // Stop video/audio immediately. The old fade-delayed cleanup could leave
  // video audio audible underneath a newly-started Radio session.
  try { _musicVideo.pause(); _musicVideo.currentTime = 0; } catch (_) {}
  _musicVideo.classList.remove("on");
  _musicVideo.removeAttribute("src");
  try { _musicVideo.load(); } catch (_) {}
  _showBlackHold(false);
  swapBackgroundIfNeeded(true);
}

function isMusicVideoMode() { return _inMusicMode; }