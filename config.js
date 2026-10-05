"use strict";

const fs = require("fs");
const path = require("path");

const LOCAL_PUBLIC_DIR = path.join(__dirname, "public");
const BG_DAY = "/assets/bg/rsvp_day_720_optimized.mp4";
const BG_NIGHT = "/assets/bg/rsvp_night_720.mp4";

function existingDir(...candidates) {
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return candidates.find(Boolean) || LOCAL_PUBLIC_DIR;
}

const cfg = {
  PORT:     Number(process.env.PORT)    || 3000,
  POLL_MS:  Number(process.env.POLL_MS) || 2000,
  POLL_TIMEOUT_MS: Number(process.env.POLL_TIMEOUT_MS) || 2500,

  PLEX_TOKEN: process.env.PLEX_TOKEN || "",
  PLEX_BASE:  process.env.PLEX_BASE  || "http://127.0.0.1:32400",

  FEATURES_STALE_MS: Number(process.env.FEATURES_STALE_MS) || 5000,
  FEATURES_DECAY_MS: Number(process.env.FEATURES_DECAY_MS) || 12000,
  FEATURE_SIGNAL_RELAY_MS: Number(process.env.FEATURE_SIGNAL_RELAY_MS) ||
    Math.max(2000, (Number(process.env.HUE_REACTIVE_MIN_INTERVAL_MS) || 1800) + 200),
  HEALTH_STALE_MS: Number(process.env.HEALTH_STALE_MS) || 15000,
  PLEX_WEBHOOK_MAX_BYTES: Number(process.env.PLEX_WEBHOOK_MAX_BYTES) || (128 * 1024),
  PLEX_WEBHOOK_TOKEN: process.env.PLEX_WEBHOOK_TOKEN || "",

  LIGHTS_URL: process.env.LIGHTS_URL || "http://127.0.0.1:5005",
  PUBLIC_DIR: existingDir(process.env.PUBLIC_DIR, LOCAL_PUBLIC_DIR),
  BG_DAY,
  BG_NIGHT,

  EXIT_API_TOKEN: process.env.EXIT_API_TOKEN || "",

  // ── Video ─────────────────────────────────────────────────────────────────
  // Absolute path to the root of your Plex media library on this Pi.
  // The /video route only serves files whose resolved path starts here.
  // Set via environment variable: MEDIA_DIR=/mnt/music
  MEDIA_DIR: process.env.MEDIA_DIR || "/mnt/music",

  PLEX_TARGET_CLIENT_IDENTIFIER:
    process.env.PLEX_TARGET_CLIENT_IDENTIFIER || "",

  // ── Timeblock playlist switching ──────────────────────────────────────────
  // ratingKey of the Plex playlist for each time-block mode.
  // Empty = no auto-switch for that block (server stays observer-only for that
  // mode). Fill in once playlists exist in Plex.
  PLAYLIST_LOFI: process.env.PLAYLIST_LOFI || "",
  PLAYLIST_WRAP: process.env.PLAYLIST_WRAP || "",
  PLAYLIST_RAP:  process.env.PLAYLIST_RAP  || "",
  PLAYLIST_RNB:  process.env.PLAYLIST_RNB  || "",

  // ── Skip-driven lateral steering (the brain) ───────────────────────────────
  // Within a time block, N consecutive skips walk you to a vibe-adjacent lane.
  // The time boundary still owns the big vertical shift (resets to anchor).
  SKIP_STEER_THRESHOLD: Number(process.env.SKIP_STEER_THRESHOLD) || 2,
  STEERING_SKIP_WINDOW_MS: Number(process.env.STEERING_SKIP_WINDOW_MS) || 10 * 60 * 1000,
  STEERING_MIN_DWELL_MS: Number(process.env.STEERING_MIN_DWELL_MS) || 15 * 60 * 1000,

  // Lane pools per mode. The anchor (PLAYLIST_<MODE> above) is lane 0 and the
  // boundary-reset target; these are the SIBLING lanes skips can move you to.
  //   Format: "Lane Name:ratingKey, Lane Name:ratingKey"
  // Make names DJ-legible ("Memphis Trap", "Southern Bounce") so the picker
  // chooses the right adjacent move. Empty = no lateral steering for that mode.
  LANES_LOFI: process.env.LANES_LOFI || "",
  LANES_WRAP: process.env.LANES_WRAP || "",
  LANES_RAP:  process.env.LANES_RAP  || "",
  LANES_RNB:  process.env.LANES_RNB  || "",

  // Display name for each anchor lane (how the picker refers to PLAYLIST_<MODE>).
  LANE_NAME_LOFI: process.env.LANE_NAME_LOFI || "",
  LANE_NAME_WRAP: process.env.LANE_NAME_WRAP || "",
  LANE_NAME_RAP:  process.env.LANE_NAME_RAP  || "",
  LANE_NAME_RNB:  process.env.LANE_NAME_RNB  || "",

  // Anthropic API key for the optional DJ-ear lane picker. Unset = fully
  // deterministic round-robin through the declared lanes.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
  ANTHROPIC_TIMEOUT_MS: Number(process.env.ANTHROPIC_TIMEOUT_MS) || 3000,
};

if (!cfg.PLEX_TOKEN) {
  console.warn("[config] WARNING: PLEX_TOKEN is not set.");
}

module.exports = cfg;
