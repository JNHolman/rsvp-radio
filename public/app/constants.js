/**
 * public/app/config.js
 * All front-end constants in one place.
 * Every other module reads from here — no magic numbers anywhere else.
 *
 * TIME BLOCKS must stay in sync with:
 *   server-side:  /home/pi/rsvp-radio/config.js → blockModeForNow()
 *   lights:       /home/pi/rsvp_lights_service.py → timeblock_mode()
 */

// ── Video assets ──────────────────────────────────────────────────────────────
const BG_DAY   = "/assets/bg/rsvp_day_720_optimized.mp4";
const BG_NIGHT = "/assets/bg/rsvp_night_720.mp4";

// ── Server endpoints ──────────────────────────────────────────────────────────
const STATE_URL  = "/state";
const LIGHTS_URL = "http://127.0.0.1:5005";

// ── Polling ───────────────────────────────────────────────────────────────────
const POLL_MS      = 2000;   // how often to fetch /state
const POLL_TIMEOUT = 2000;   // per-fetch timeout

// ── Background video ──────────────────────────────────────────────────────────
const BG_CHECK_MS    = 20000;          // how often to check day vs night
const BG_RELOAD_MS   = 30 * 60 * 1000; // memory-safe reload interval
const BG_CROSSFADE_MS = 1200;          // MUST match transition duration in styles.css

// ── Lights signal ─────────────────────────────────────────────────────────────
// Only POST /signal when bass or energy delta exceeds this threshold
const SIGNAL_DELTA_THRESHOLD = 0.03;

// ── Lights transitions ────────────────────────────────────────────────────────
const IDLE_TRANSITION_MS      = 90000;   // fade to idle/amber
const TRANSITION_MS_DEFAULT   = 360000;  // block-to-block crossfade (6 min)

// ── Session storage keys ──────────────────────────────────────────────────────
const LS_MODE   = "rsvp.sessionMode.v1";
const LS_ACTIVE = "rsvp.sessionActive.v1";

// ── Time helpers ──────────────────────────────────────────────────────────────
function isDayTime() {
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  return m >= 8 * 60 && m < 22 * 60;
}

// LOFI 04:00–12:00 | WRAP 12:00–17:00 | RAP 17:00–23:00 | RNB 23:00–04:00
function blockModeForNow() {
  const m = new Date().getHours() * 60 + new Date().getMinutes();
  if (m >= 4  * 60 && m < 12 * 60) return "lofi";
  if (m >= 12 * 60 && m < 17 * 60) return "wrap";
  if (m >= 17 * 60 && m < 23 * 60) return "rap";
  return "rnb";
}
