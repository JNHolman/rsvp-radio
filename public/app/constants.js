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

// ── Polling ───────────────────────────────────────────────────────────────────
const POLL_MS      = Number(RUNTIME.pollMs) || 2000;
const POLL_TIMEOUT = Number(RUNTIME.pollTimeoutMs) || 2000;

// ── Background video ──────────────────────────────────────────────────────────
const BG_CHECK_MS      = 20000;
const BG_RELOAD_MS     = 30 * 60 * 1000;
const BG_CROSSFADE_MS  = 1200;

function isDayTime() {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 8 * 60 && m < 22 * 60;
}