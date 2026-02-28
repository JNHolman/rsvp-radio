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

function getSessionActive()  { return localStorage.getItem(LS_ACTIVE) === "1"; }
function getSessionMode()    { return localStorage.getItem(LS_MODE) || ""; }

function setSessionActive(v) {
  localStorage.setItem(LS_ACTIVE, v ? "1" : "0");
  if (!v) localStorage.removeItem(LS_MODE);
}

function setSessionMode(mode) {
  if (mode) localStorage.setItem(LS_MODE, mode);
}

// ── Core POST ─────────────────────────────────────────────────────────────────

async function lightsPost(path, payload = {}) {
  try {
    await fetch(LIGHTS_URL + path, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch (_) {
    // Lights service is optional — never crash the UI over it
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

async function onPlaybackStart() {
  _idleFired = false;

  if (!getSessionActive()) {
    setSessionActive(true);
    if (!getSessionMode()) setSessionMode(blockModeForNow());
  }

  const mode = getSessionMode() || blockModeForNow();
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
  setSessionMode(mode);
  setSessionActive(true);
  await lightsPost("/mode/" + mode);
}

async function setLightsOn()  { await lightsPost("/on");  }
async function setLightsOff() { await lightsPost("/off"); }

// ── Boundary timer (30s interval, not 1s) ────────────────────────────────────

const _BOUNDARIES   = [4 * 60, 12 * 60, 17 * 60, 23 * 60];
const _PRE_FADE_MIN = 5;
let   _lastBoundaryKey = null;

function _boundaryMode(b) {
  if (b === 4  * 60) return "lofi";
  if (b === 12 * 60) return "wrap";
  if (b === 17 * 60) return "rap";
  return "rnb";
}

async function _checkBoundary() {
  if (!getSessionActive()) return;

  const m = new Date().getHours() * 60 + new Date().getMinutes();

  for (const b of _BOUNDARIES) {
    const fireAt = (b - _PRE_FADE_MIN + 24 * 60) % (24 * 60);
    // Fire within the 1-minute window
    if (m >= fireAt && m < fireAt + 1) {
      const key = `${new Date().toDateString()}_${b}`;
      if (_lastBoundaryKey === key) return;
      _lastBoundaryKey = key;

      const from = getSessionMode() || blockModeForNow();
      const to   = _boundaryMode(b);
      await lightsPost("/transition", { from, to, durMs: TRANSITION_MS_DEFAULT });
      setSessionMode(to);
      return;
    }
  }
}

function startBoundaryTimer() {
  _checkBoundary(); // immediate check on boot
  setInterval(_checkBoundary, 30 * 1000);
}
