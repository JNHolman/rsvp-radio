"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PI_PUBLIC_DIR = "/home/pi/rsvp-radio/public";
const LOCAL_PUBLIC_DIR = path.join(__dirname, "public");
const BG_DAY = "/assets/bg/rsvp_day_720_optimized.mp4";
const BG_NIGHT = "/assets/bg/rsvp_night_720.mp4";
const DEFAULT_LANES_PATH = path.join(__dirname, "config", "lanes.json");

function laneConfigRaw() {
  if (process.env.RSVP_LANES_JSON) return process.env.RSVP_LANES_JSON;

  const lanesPath = process.env.RSVP_LANES_PATH || DEFAULT_LANES_PATH;
  try {
    if (fs.existsSync(lanesPath)) return fs.readFileSync(lanesPath, "utf8");
  } catch (err) {
    console.warn("[config] Could not read lane config:", err.message);
  }
  return "";
}

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
  PLEXAMP_BASE: process.env.PLEXAMP_BASE || "http://127.0.0.1:32500",
  RSVP_LANES_JSON: laneConfigRaw(),
  RSVP_LANES_PATH: process.env.RSVP_LANES_PATH || DEFAULT_LANES_PATH,
  STEERING_SKIP_THRESHOLD: Number(process.env.STEERING_SKIP_THRESHOLD) || 2,
  STEERING_SKIP_WINDOW_MS: Number(process.env.STEERING_SKIP_WINDOW_MS) || (10 * 60 * 1000),
  STEERING_MIN_DWELL_MS: Number(process.env.STEERING_MIN_DWELL_MS) || (15 * 60 * 1000),

  FEATURES_STALE_MS: Number(process.env.FEATURES_STALE_MS) || 5000,
  FEATURES_DECAY_MS: Number(process.env.FEATURES_DECAY_MS) || 12000,
  HEALTH_STALE_MS: Number(process.env.HEALTH_STALE_MS) || 15000,
  PLEX_WEBHOOK_MAX_BYTES: Number(process.env.PLEX_WEBHOOK_MAX_BYTES) || (128 * 1024),

  LIGHTS_URL: process.env.LIGHTS_URL || "http://127.0.0.1:5005",
  PUBLIC_DIR: existingDir(process.env.PUBLIC_DIR, DEFAULT_PI_PUBLIC_DIR, LOCAL_PUBLIC_DIR),
  BG_DAY,
  BG_NIGHT,

  EXIT_API_TOKEN: process.env.EXIT_API_TOKEN || "",
  PLEX_TARGET_CLIENT_IDENTIFIER:
    process.env.PLEX_TARGET_CLIENT_IDENTIFIER || "5336489d-cecf-4597-b1ab-7377aa825c6a",
};

if (!cfg.PLEX_TOKEN) {
  console.warn("[config] WARNING: PLEX_TOKEN is not set.");
}

module.exports = cfg;
