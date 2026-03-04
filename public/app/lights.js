/**
 * public/app/lights.js
 * All communication with rsvp-lights service.
 *
 * - lightsPost()         fire-and-forget POST, never crashes the UI
 * - sendSignal()         throttled — only posts when bass/energy delta is meaningful
 * - onPlaybackStart()    called by player when track starts playing
 * - onPlaybackStop()     called by player when playback goes idle
 * - setLightsMode()      manual override from the menu
 * - startBoundaryTimer() time-block crossfades, checks every 30s not every 1s
 */

// ── Session persistence ───────────────────────────────────────────────────────

const _VALID_MODES = new Set(["wrap", "lofi", "rap", "rnb", "idle"]);

function normalizeMode(mode) {
  const value = String(mode || "").toLowerCase();
  return _VALID_MODES.has(value) ? value : "";
}

function getSessionActive()  { return localStorage.getItem(LS_ACTIVE) === "1"; }
function getSessionMode()    { return normalizeMode(localStorage.getItem(LS_MODE) || ""); }

function setSessionActive(v) {
  localStorage.setItem(LS_ACTIVE, v ? "1" : "0");
  if (!v) localStorage.removeItem(LS_MODE);
}

function setSessionMode(mode) {
  const normalized = normalizeMode(mode);
  if (normalized && normalized !== "idle") localStorage.setItem(LS_MODE, normalized);
}

// ── Core POST ─────────────────────────────────────────────────────────────────

async function lightsPost(path, payload = {}) {
  try {
    await fetch(LIGHTS_URL + path, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch (err) {
    // Lights are optional — never crash the UI, but log once for troubleshooting
    console.warn("[lights] POST", path, "failed:", err.message);
  }
}

// ── Signal throttle ───────────────────────────────────────────────────────────

let _lastBass   = -1;
let _lastEnergy = -1;

async function sendSignal(bass, energy) {
  if (
    Math.abs(bass   - _lastBass)   < SIGNAL_DELTA_THRESHOLD &&
    Math.abs(energy - _lastEnergy) < SIGNAL_DELTA_THRESHOLD
  ) return;
  _lastBass   = bass;
  _lastEnergy = energy;
  await lightsPost("/signal", { bass, energy });
}

// ── Playback hooks ────────────────────────────────────────────────────────────

let _idleFired = false;

async function applyServerMode(mode) {
  const next = normalizeMode(mode);
  if (!next || next === "idle") return;

  const current = getSessionMode();
  setSessionMode(next);
  setSessionActive(true);

  if (current === next && getSessionActive()) return;
  await lightsPost("/mode/" + next);
}

async function onPlaybackStart(preferredMode = "") {
  _idleFired = false;

  const preferred = normalizeMode(preferredMode);

  if (!getSessionActive()) {
    setSessionActive(true);
    setSessionMode(preferred || getSessionMode() || blockModeForNow());
  } else if (preferred && preferred !== getSessionMode()) {
    setSessionMode(preferred);
  }

  const mode = preferred || getSessionMode() || blockModeForNow();
  await lightsPost("/mode/" + mode);
}

async function onPlaybackStop() {
  if (_idleFired) return;
  _idleFired = true;

  const from = getSessionMode() || blockModeForNow();
  setSessionActive(false);
  await lightsPost("/transition", { from, to: "idle", durMs: IDLE_TRANSITION_MS });
}

// ── Menu controls ─────────────────────────────────────────────────────────────

async function setLightsMode(mode) {
  const next = normalizeMode(mode);
  if (!next || next === "idle") return;
  setSessionMode(next);
  setSessionActive(true);
  await lightsPost("/mode/" + next);
}

async function setLightsOn()  { await lightsPost("/on");  }
async function setLightsOff() { await lightsPost("/off"); }

// ── Boundary timer (30s interval, not 1s) ────────────────────────────────────

const _BOUNDARIES = TIME_BLOCKS.map((block) => block.startMin);
let   _lastBoundaryKey = null;

function _boundaryMode(boundaryMin) {
  const match = TIME_BLOCKS.find((block) => block.startMin === boundaryMin);
  return match ? match.mode : "rnb";
}

function _shouldTriggerBoundary(minute, boundaryMin) {
  const fireAt = (boundaryMin - PRE_FADE_MIN + 24 * 60) % (24 * 60);
  return minute >= fireAt && minute < fireAt + 1;
}

async function _checkBoundary() {
  if (!getSessionActive()) return;

  const minute = minutesOfDay(new Date());

  for (const boundaryMin of _BOUNDARIES) {
    if (!_shouldTriggerBoundary(minute, boundaryMin)) continue;

    const key = `${new Date().toDateString()}_${boundaryMin}`;
    if (_lastBoundaryKey === key) return;
    _lastBoundaryKey = key;

    const from = getSessionMode() || blockModeForNow();
    const to   = _boundaryMode(boundaryMin);
    await lightsPost("/transition", { from, to, durMs: TRANSITION_MS_DEFAULT });
    setSessionMode(to);
    return;
  }
}

function startBoundaryTimer() {
  _checkBoundary();
  setInterval(_checkBoundary, 30 * 1000);
}
