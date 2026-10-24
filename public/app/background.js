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

const _artDay = document.getElementById("artDay");
const _artNight = document.getElementById("artNight");
const _stage = document.querySelector(".stage");
const ART_DAY = "/assets/bg/rsvp_day_art.webp";
const ART_NIGHT = "/assets/bg/rsvp_night_art.webp";
let _artReady = false;
const HORIZON_REVEAL_MS = 10000;
let _activeArtwork = null;
let _horizonTimer = null;
let _horizonSettleTimer = null;

// The incoming approved image reveals sky -> skyline -> waterfront with a
// feathered mask; the outgoing image stays underneath for the full 10 seconds.
// No artwork moves, and the UI and music-video handoffs remain untouched.
let _horizonFrame = null;
let _horizonQueuedSrc = null;
let _horizonQueueTimer = null;

function _setArtworkPhase(artwork) {
  _stage.classList.toggle("art-phase-day", artwork === _artDay);
  _stage.classList.toggle("art-phase-night", artwork === _artNight);
}

// Complete a reveal atomically: settle both image layers before switching the
// water/shading source, while the water layer is still suppressed.
function _finishHorizonReveal() {
  if (_horizonTimer !== null) {
    clearTimeout(_horizonTimer);
    _horizonTimer = null;
  }
  if (_horizonFrame !== null) {
    cancelAnimationFrame(_horizonFrame);
    _horizonFrame = null;
  }
  if (_horizonSettleTimer !== null) {
    clearTimeout(_horizonSettleTimer);
    _horizonSettleTimer = null;
  }
  if (_horizonQueueTimer !== null) {
    clearTimeout(_horizonQueueTimer);
    _horizonQueueTimer = null;
  }

  for (const art of [_artDay, _artNight]) {
    art.style.transition = "none";
    art.classList.remove("horizon-incoming", "horizon-outgoing", "horizon-reveal");
    art.classList.toggle("on", art === _activeArtwork);
  }
  _setArtworkPhase(_activeArtwork);
  _stage.classList.remove("horizon-transition");

  // Keep the old 1.2s image opacity transition disabled through the settle.
  _horizonSettleTimer = setTimeout(() => {
    _horizonSettleTimer = null;
    for (const art of [_artDay, _artNight]) art.style.removeProperty("transition");
  }, 200);

  // Rapid solar/preview changes should not interrupt the current 10s reveal.
  // Only the last requested phase is shown after the current image settles.
  const queued = _horizonQueuedSrc;
  _horizonQueuedSrc = null;
  if (queued && (queued === BG_DAY ? _artDay : _artNight) !== _activeArtwork) {
    _horizonQueueTimer = setTimeout(() => {
      _horizonQueueTimer = null;
      _setArtworkForSource(queued);
    }, 200);
  }
}

// Keep the outgoing artwork and its water overlay stable until the incoming
// image is masked and the transition actually begins.
function _setArtworkForSource(src) {
  if (!_artReady || !src) return;
  const requested = src === BG_DAY ? _artDay : _artNight;
  const incoming = requested.naturalWidth > 0 ? requested : null;
  const outgoing = _activeArtwork;

  if (_horizonTimer !== null || _horizonFrame !== null) {
    _horizonQueuedSrc = incoming === outgoing ? null : src;
    return;
  }
  if (incoming === outgoing) return;

  if (_horizonQueueTimer !== null) {
    clearTimeout(_horizonQueueTimer);
    _horizonQueueTimer = null;
  }
  if (_horizonSettleTimer !== null) {
    clearTimeout(_horizonSettleTimer);
    _horizonSettleTimer = null;
  }

  _activeArtwork = incoming;
  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (incoming && outgoing && outgoing.naturalWidth > 0 && !reduceMotion && !_inMusicMode) {
    outgoing.classList.add("on", "horizon-outgoing");
    incoming.classList.add("on", "horizon-incoming");
    _stage.classList.add("horizon-transition");

    // Paint a fully masked incoming image BEFORE starting its reveal. This
    // prevents a one-frame unmasked flash in Chromium's compositor.
    _horizonFrame = requestAnimationFrame(() => {
      _horizonFrame = requestAnimationFrame(() => {
        _horizonFrame = null;
        incoming.classList.add("horizon-reveal");
        _horizonTimer = setTimeout(_finishHorizonReveal, HORIZON_REVEAL_MS + 100);
      });
    });
  } else {
    for (const art of [_artDay, _artNight]) {
      art.style.transition = "none";
      art.classList.toggle("on", art === incoming);
    }
    _setArtworkPhase(incoming);
    _horizonSettleTimer = setTimeout(() => {
      _horizonSettleTimer = null;
      for (const art of [_artDay, _artNight]) art.style.removeProperty("transition");
    }, 200);
  }
}
function _bootArtwork() {
  if (_artReady) return;
  _artReady = true;
  for (const [img, path] of [[_artDay, ART_DAY], [_artNight, ART_NIGHT]]) {
    img.addEventListener("load", () => _setArtworkForSource(_currentSrc));
    img.addEventListener("error", () => console.info("[bg] Artwork not installed; using ambient video fallback:", path));
    img.src = path;
  }
}

let _front      = _bgA;
let _back       = _bgB;
let _currentSrc = null;
let _lastReload = Date.now();

let _lastSolarPhase = null;
let _solarWarned = false;
let _nextSolarTransitionAt = null;
let _solarClockStarted = false;
let _solarTimer = null;
let _solarRefreshInFlight = null;
let _solarRefreshQueued = false;
const SOLAR_RETRY_MS = 60000;
const SOLAR_SAFETY_MS = 60 * 60 * 1000;

// Set a single timer for the precise server-computed sunrise or civil dusk.
// If the endpoint is unavailable, retry after one minute; never poll every 20s.
function _armSolarTransition(when) {
  _nextSolarTransitionAt = when;
  if (!_solarClockStarted) return;
  if (_solarTimer !== null) clearTimeout(_solarTimer);
  const wait = Number.isFinite(when)
    ? Math.max(750, Math.min(when - Date.now(), 2147483647))
    : SOLAR_RETRY_MS;
  _solarTimer = setTimeout(() => {
    _solarTimer = null;
    _reconcileSolarClock().catch(err => console.warn("[bg] Solar timer:", err.message));
  }, wait);
}

// Coalesce a scheduled event, a preview button press, and a wake-up refresh.
// A preview notification that arrives during a request is processed afterward.
async function _reconcileSolarClock() {
  if (_solarRefreshInFlight) {
    _solarRefreshQueued = true;
    return _solarRefreshInFlight;
  }
  const run = (async () => {
    do {
      _solarRefreshQueued = false;
      // Video playback owns the screen, but the solar clock still advances.
      if (_inMusicMode) await _desiredBackground();
      else await swapBackgroundIfNeeded(false);
    } while (_solarRefreshQueued);
  })();
  _solarRefreshInFlight = run;
  try { await run; } finally { _solarRefreshInFlight = null; }
}

// Sun times are computed by the Pi using its configured Louisville timezone.
// Keep the last confirmed value on a temporary server error; fixed hours are
// used only if the solar endpoint has never returned a valid response.
async function _desiredBackground() {
  // All preview DAY / NIGHT / AUTO selections come from the isolated
  // :3001 solar endpoint. Ignore stale ?art= links so they cannot freeze
  // the artwork while the preview controls and Hue follow a new phase.
  try {
    const response = await fetch("/api/solar-state", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const solar = await response.json();
    if (solar.phase !== "day" && solar.phase !== "night") throw new Error("Invalid phase");
    _lastSolarPhase = solar.phase;
    const nextAt = Date.parse(solar.nextTransition || "");
    _armSolarTransition(Number.isFinite(nextAt) ? nextAt : null);
    _solarWarned = false;
  } catch (err) {
    if (!_solarWarned) console.warn("[bg] Solar phase unavailable; retaining last known phase:", err.message);
    _solarWarned = true;
    _armSolarTransition(null);
  }
  const day = _lastSolarPhase === null ? isDayTime() : _lastSolarPhase === "day";
  return day ? BG_DAY : BG_NIGHT;
}

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

let _bgTransition = null;
let _bgPending = null;

// Only one background video fade may own the two video elements at a time.
// Keep the existing front visible if the incoming video cannot play.
async function _performBackgroundCrossfade(src) {
  const oldFront = _front;
  const oldBack = _back;
  _setSrc(oldBack, src);

  try {
    await oldBack.play();
    if (oldBack.readyState < 2 || _inMusicMode) {
      throw new Error("incoming_background_not_ready");
    }
  } catch (err) {
    console.warn("[bg] Retaining current background:", err.message);
    _detach(oldBack);
    return false;
  }

  oldBack.classList.add("on");
  oldFront.classList.remove("on");
  await new Promise((resolve) => setTimeout(resolve, BG_CROSSFADE_MS + 50));

  _detach(oldFront);
  _front = oldBack;
  _back = oldFront;
  _currentSrc = src;
  return true;
}

async function _drainBackgroundQueue() {
  try {
    while (_bgPending) {
      const next = _bgPending;
      _bgPending = null;
      if (!next.force && next.src === _currentSrc) continue;
      if (await _performBackgroundCrossfade(next.src)) {
        _setArtworkForSource(next.src);
      }
    }
  } finally {
    _bgTransition = null;
  }
}

function _crossfadeTo(src, force = false) {
  // Coalesce repeated solar/reload requests; latest desired phase wins.
  _bgPending = { src, force };
  if (!_bgTransition) {
    _bgTransition = Promise.resolve().then(_drainBackgroundQueue);
  }
  return _bgTransition;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function bootBackground() {
  _bootArtwork();
  _currentSrc = await _desiredBackground();
  _setSrc(_front, _currentSrc);
  _front.classList.add("on");
  _setArtworkForSource(_currentSrc);
  try { await _front.play(); } catch (_) {}
  _detach(_back);
}

async function swapBackgroundIfNeeded(force = false) {
  // Never swap ambient background while music video is active
  if (_inMusicMode) return;
  const want = await _desiredBackground();
  if (!force && want === _currentSrc && !_bgTransition) return;
  await _crossfadeTo(want, force);
}

async function reloadCurrentVideoIfDue() {
  // Never reload ambient background while music video is active
  if (_inMusicMode) return;
  if (Date.now() - _lastReload < BG_RELOAD_MS) return;
  _lastReload = Date.now();
  console.log("[bg] Reloading video through back buffer");
  await _crossfadeTo(_currentSrc, true);
}

function startBackgroundTimers() {
  if (_solarClockStarted) return;
  _solarClockStarted = true;
  _armSolarTransition(_nextSolarTransitionAt);

  // One occasional safety reconciliation catches clock adjustments and missed
  // timers after sleep; it is not the normal day/night change mechanism.
  setInterval(() => {
    _reconcileSolarClock().catch(err => console.warn("[bg] Solar safety:", err.message));
  }, SOLAR_SAFETY_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) _reconcileSolarClock().catch(() => {});
  });
  window.addEventListener("pageshow", () => _reconcileSolarClock().catch(() => {}));
  window.addEventListener("online", () => _reconcileSolarClock().catch(() => {}));

  // The isolated test server pushes DAY/NIGHT/AUTO button changes immediately.
  // Production needs no push channel: its exact nextTransition is sufficient.
  if (window.RSVP_PREVIEW_MODE === true && typeof EventSource !== "undefined") {
    const events = new EventSource("/api/solar-events");
    events.addEventListener("open", () => _reconcileSolarClock().catch(() => {}));
    events.addEventListener("phase", () => _reconcileSolarClock().catch(() => {}));
  }

  // Existing media reload maintenance stays independent of the solar clock.
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
  _stage.classList.remove("videoMode");
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
  // TV playback always takes priority over an in-progress solar reveal.
  _finishHorizonReveal();

  // Don't retry a recently failed video — prevents retry loop
  if (_isFailedUrl(mediaUrl)) {
    console.warn("[bg] Skipping recently failed video:", mediaUrl);
    return;
  }

  _stage.classList.add("videoMode");

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
  _stage.classList.remove("videoMode");
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