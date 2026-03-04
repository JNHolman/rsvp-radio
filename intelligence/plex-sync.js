"use strict";

/**
 * intelligence/plex-sync.js — RSVP Radio Plex Rating Sync
 *
 * Reads skip-data.json and updates song ratings in Plex via API.
 * Called automatically after every skip or scrobble.
 *
 * Plex rating scale (internal 0-10, shown as 1-5 stars):
 *   5 stars = 10  → clean, full rotation
 *   3 stars =  6  → 1 strike, cooling off
 *   2 stars =  4  → 2-3 strikes, on notice
 *   1 star  =  2  → 4+ strikes, exile
 *
 * Smart playlist setup in Plex:
 *   "RSVP Rotation" → Track Rating is greater than 4  (3 stars+)
 *   "RSVP Exile"    → Track Rating is less than 4     (1-2 stars)
 */

const fs   = require("fs");
const path = require("path");

const DATA_PATH = process.env.SKIP_DATA_PATH || path.join(__dirname, "..", "data", "skip-data.json");

// ── Rating map ────────────────────────────────────────────────────────────────
function starsForStrikes(strikes) {
  if (strikes === 0) return 10; // 5 stars — untouched
  if (strikes === 1) return 6;  // 3 stars — cooling off
  if (strikes <= 3)  return 4;  // 2 stars — on notice
  return 2;                     // 1 star  — exile (4+ strikes)
}

// ── Plex API call ─────────────────────────────────────────────────────────────
async function updatePlexRating(ratingKey, stars, plexBase, plexToken) {
  const url = `${plexBase}/:/rate?identifier=com.plexapp.plugins.library&key=${ratingKey}&rating=${stars}&X-Plex-Token=${encodeURIComponent(plexToken)}`;
  try {
    const res = await fetch(url, { method: "PUT" });
    if (!res.ok) {
      console.warn(`[plex-sync] Failed to rate key:${ratingKey} — HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[plex-sync] Error rating key:${ratingKey} —`, err.message);
    return false;
  }
}

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * syncRating — called after every skip or scrobble for a single track
 * @param {string} ratingKey  Plex ratingKey for the track
 * @param {string} plexBase   e.g. http://127.0.0.1:32400
 * @param {string} plexToken  Plex auth token
 */
async function syncRating(ratingKey, plexBase, plexToken) {
  try {
    if (!fs.existsSync(DATA_PATH)) return;
    const data  = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    const entry = data[ratingKey];

    // No entry = never skipped = 5 stars, no need to update
    if (!entry) return;

    const stars = starsForStrikes(entry.strikes);
    const ok    = await updatePlexRating(ratingKey, stars, plexBase, plexToken);

    if (ok) {
      console.log(`[plex-sync] "${entry.title}" → ${stars / 2} stars (${entry.strikes} strikes)`);
    }
  } catch (err) {
    console.warn("[plex-sync] syncRating error:", err.message);
  }
}

/**
 * syncAll — syncs every song in skip-data.json to Plex
 * Useful on startup or manual refresh
 */
async function syncAll(plexBase, plexToken) {
  try {
    if (!fs.existsSync(DATA_PATH)) return;
    const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    const keys = Object.keys(data);
    console.log(`[plex-sync] syncing ${keys.length} songs to Plex...`);
    for (const ratingKey of keys) {
      await syncRating(ratingKey, plexBase, plexToken);
    }
    console.log("[plex-sync] sync complete");
  } catch (err) {
    console.warn("[plex-sync] syncAll error:", err.message);
  }
}

/**
 * syncCleanPlay — called when a song scrobbles
 * Since skip-tracker.recordPlay() already reset strikes to 0,
 * we always write 5 stars here — redeemed or never penalized.
 */
async function syncCleanPlay(ratingKey, title, plexBase, plexToken) {
  try {
    const ok = await updatePlexRating(ratingKey, 10, plexBase, plexToken);
    if (ok) console.log(`[plex-sync] "${title}" → 5 stars (clean play)`);
  } catch (err) {
    console.warn("[plex-sync] syncCleanPlay error:", err.message);
  }
}

module.exports = { syncRating, syncCleanPlay, syncAll };
