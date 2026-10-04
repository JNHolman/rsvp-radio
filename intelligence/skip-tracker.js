"use strict";

/**
 * intelligence/skip-tracker.js — RSVP Radio Skip Intelligence
 *
 * Tracks song skip history and manages reputation cooldowns.
 * Data persists to skip-data.json — no database required.
 *
 * Skip thresholds:
 *   Hard skip (0–25% played)   = 1.0 strike
 *   Soft skip (25–40% played)  = 0.5 strike
 *   Played   (40%+ played)     = clears soft skip history
 *
 * Cooldown ladder (full strikes):
 *   1 strike  = 30 days
 *   2 strikes = 90 days
 *   3 strikes = 180 days
 *   4 strikes = 1 year
 *   5 strikes = permanent exile
 */

const fs   = require("fs");
const path = require("path");

// ── Data file ─────────────────────────────────────────────────────────────────
const DATA_PATH = process.env.SKIP_DATA_PATH || path.join(__dirname, "..", "data", "skip-data.json");

// ── Cooldown ladder (days) ────────────────────────────────────────────────────
const COOLDOWNS = [
  { strikes: 1, days: 30   },
  { strikes: 2, days: 90   },
  { strikes: 3, days: 180  },
  { strikes: 4, days: 365  },
  { strikes: 5, days: 36500 }, // permanent exile (~100 years)
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() { return Date.now(); }
function daysToMs(d) { return d * 24 * 60 * 60 * 1000; }

function load() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    }
  } catch (err) {
    console.warn("[skip-tracker] Could not load data file, starting fresh:", err.message);
  }
  return {};
}

function save(data) {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("[skip-tracker] Could not save data file:", err.message);
  }
}

function cooldownForStrikes(strikes) {
  const match = [...COOLDOWNS].reverse().find(c => strikes >= c.strikes);
  return match ? daysToMs(match.days) : 0;
}

function cooldownLabel(strikes) {
  if (strikes >= 5) return "PERMANENT EXILE";
  if (strikes >= 4) return "1 year";
  if (strikes >= 3) return "180 days";
  if (strikes >= 2) return "90 days";
  if (strikes >= 1) return "30 days";
  return "none";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * recordSkip — called when a song is skipped
 * @param {object} track  { ratingKey, title, artist }
 * @param {number} pct    0.0–1.0, how far through the song they got
 */
function recordSkip(track, pct) {
  const { ratingKey, title, artist } = track;
  const data = load();

  if (!data[ratingKey]) {
    data[ratingKey] = { ratingKey, title, artist, strikes: 0, softStrikes: 0, cooldownUntil: 0, history: [] };
  }

  const entry = data[ratingKey];

  // Determine strike weight
  let strikeWeight = 0;
  let skipType     = "";

  if (pct < 0.25) {
    strikeWeight = 1.0;
    skipType     = "hard";
  } else if (pct < 0.40) {
    strikeWeight = 0.5;
    skipType     = "soft";
  } else {
    // 40%+ counts as a listen, not a skip. It should also clear any
    // accumulated soft-skip debt without fully redeeming prior hard strikes.
    if (entry.softStrikes > 0) {
      entry.softStrikes = 0;
      entry.history.push({
        type: "listen",
        pct: Math.round(pct * 100),
        ts: now(),
        strikes: entry.strikes,
      });
      if (entry.history.length > 20) entry.history = entry.history.slice(-20);
      save(data);
    }
    console.log(`[skip-tracker] "${title}" played ${Math.round(pct * 100)}% — counts as a listen, no strike`);
    return;
  }

  // Accumulate strikes
  if (skipType === "soft") {
    entry.softStrikes += 0.5;
    if (entry.softStrikes >= 1.0) {
      entry.strikes    += 1;
      entry.softStrikes = 0;
      console.log(`[skip-tracker] "${title}" — 2 soft skips converted to 1 full strike`);
    }
  } else {
    entry.strikes += strikeWeight;
  }

  // Log history entry
  entry.history.push({
    type:   skipType,
    pct:    Math.round(pct * 100),
    ts:     now(),
    strikes: entry.strikes,
  });

  // Keep history to last 20 entries
  if (entry.history.length > 20) entry.history = entry.history.slice(-20);

  // Set cooldown
  const cooldownMs    = cooldownForStrikes(entry.strikes);
  entry.cooldownUntil = now() + cooldownMs;
  entry.title         = title;
  entry.artist        = artist;

  console.log(`[skip-tracker] ${skipType.toUpperCase()} SKIP | "${title}" by ${artist} | strikes: ${entry.strikes} | cooldown: ${cooldownLabel(entry.strikes)}`);

  save(data);
}

/**
 * recordPlay — called when a song scrobbles (played 40%+)
 * Resets all strikes to zero — one clean play = full redemption.
 * At 5000 songs the natural replay gap is so long that if a crowd
 * lets it ride, it's forgiven.
 */
function recordPlay(track) {
  const { ratingKey, title, artist } = track;
  const data = load();

  if (!data[ratingKey]) return; // never been skipped, nothing to clear

  const entry = data[ratingKey];

  if (entry.strikes > 0 || entry.softStrikes > 0) {
    console.log(`[skip-tracker] "${title}" redeemed — resetting ${entry.strikes} strikes to 0`);
    entry.strikes     = 0;
    entry.softStrikes = 0;
    entry.cooldownUntil = 0;
    entry.history.push({ type: "redemption", ts: now(), strikes: 0 });
    if (entry.history.length > 20) entry.history = entry.history.slice(-20);
    save(data);
  }
}

/**
 * isOnCooldown — returns true if song should not play right now
 */
function isOnCooldown(ratingKey) {
  const data  = load();
  const entry = data[ratingKey];
  if (!entry) return false;
  return entry.cooldownUntil > now();
}

/**
 * getStatus — returns full status for a song (for debugging/dashboard)
 */
function getStatus(ratingKey) {
  const data  = load();
  return data[ratingKey] || null;
}

/**
 * getAllExiled — returns all songs with 5+ strikes (for smart playlist reference)
 */
function getAllExiled() {
  const data = load();
  return Object.values(data).filter(e => e.strikes >= 5);
}

module.exports = { recordSkip, recordPlay, isOnCooldown, getStatus, getAllExiled };
