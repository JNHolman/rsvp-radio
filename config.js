"use strict";

const cfg = {
  PORT:     Number(process.env.PORT)    || 3000,
  POLL_MS:  Number(process.env.POLL_MS) || 2000,

  PLEX_TOKEN: process.env.PLEX_TOKEN || "",
  PLEX_BASE:  process.env.PLEX_BASE  || "http://127.0.0.1:32400",

  FEATURES_STALE_MS: Number(process.env.FEATURES_STALE_MS) || 5000,
  FEATURES_DECAY_MS: Number(process.env.FEATURES_DECAY_MS) || 12000,

  PUBLIC_DIR: process.env.PUBLIC_DIR || "/home/pi/rsvp-radio/public",
};

if (!cfg.PLEX_TOKEN) {
  console.warn("[config] WARNING: PLEX_TOKEN is not set.");
}

module.exports = cfg;
