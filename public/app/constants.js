/**
 * public/app/constants.js
 * Repo-side runtime constants. Server injects deployment values through
 * /runtime-config.js so schedule and endpoint changes do not drift.
 */

const RUNTIME = window.RSVP_RUNTIME_CONFIG || {};

// ── Video assets ──────────────────────────────────────────────────────────────
const BG_DAY   = RUNTIME.bgDay || "/assets/bg/rsvp_day_720_optimized.mp4";
const BG_NIGHT = RUNTIME.bgNight || "/assets/bg/rsvp_night_720.mp4";

// ── Server endpoints ──────────────────────────────────────────────────────────
const STATE_URL  = "/state";
const LIGHTS_URL = RUNTIME.lightsUrl || "http://127.0.0.1:5005";

// ── Polling ───────────────────────────────────────────────────────────────────
const POLL_MS      = Number(RUNTIME.pollMs) || 2000;
const POLL_TIMEOUT = Number(RUNTIME.pollTimeoutMs) || 2000;

// ── Background video ──────────────────────────────────────────────────────────
const BG_CHECK_MS      = 20000;
const BG_RELOAD_MS     = 30 * 60 * 1000;
const BG_CROSSFADE_MS  = 1200;

// ── Lights signal ─────────────────────────────────────────────────────────────
const SIGNAL_DELTA_THRESHOLD = 0.03;

// ── Time blocks / transitions ────────────────────────────────────────────────
const TIME_BLOCKS = Array.isArray(RUNTIME.timeBlocks) && RUNTIME.timeBlocks.length
  ? RUNTIME.timeBlocks
  : [
      { mode: "lofi", startMin: 240, endMin: 720 },
      { mode: "wrap", startMin: 720, endMin: 1020 },
      { mode: "rap",  startMin: 1020, endMin: 1380 },
      { mode: "rnb",  startMin: 1380, endMin: 240 },
    ];

const PRE_FADE_MIN = Number(RUNTIME.preFadeMin) || 5;
const IDLE_TRANSITION_MS    = 90000;
const TRANSITION_MS_DEFAULT = Number(RUNTIME.transitionMsDefault) || 360000;

// ── Session storage keys ──────────────────────────────────────────────────────
const LS_MODE   = "rsvp.sessionMode.v1";
const LS_ACTIVE = "rsvp.sessionActive.v1";

function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function isDayTime() {
  const m = minutesOfDay(new Date());
  return m >= 8 * 60 && m < 22 * 60;
}

function blockModeForMinute(minute) {
  for (const block of TIME_BLOCKS) {
    if (block.startMin < block.endMin) {
      if (minute >= block.startMin && minute < block.endMin) return block.mode;
    } else if (minute >= block.startMin || minute < block.endMin) {
      return block.mode;
    }
  }
  return "rnb";
}

function blockModeForNow() {
  return blockModeForMinute(minutesOfDay(new Date()));
}
