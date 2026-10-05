"use strict";

/**
 * intelligence/plex-sync.js — RSVP Radio Plex Rating Sync
 *
 * Reads skip-data.json and updates song ratings in Plex via API.
 * Called automatically after every skip or scrobble.
 *
 * Plex rating ladder (internal 0-10, shown as 1-5 stars):
 *   0 strikes, 0 soft       → 10  (5 stars)   clean, full rotation
 *   0 strikes, soft > 0     →  8  (4 stars)   minor accumulation, still safe
 *   1 strike                →  6  (3 stars)   warning, still in rotation
 *   2-3 strikes             →  3  (1.5 stars) on notice, exile
 *   4 strikes               →  2  (1 star)    deep exile
 *   5+ strikes              →  1  (0.5 star)  permanent exile
 *
 * Smart playlist setup in Plex:
 *   "RSVP Rotation" → Track Rating is greater than 4  (3 stars+ = ratings 6, 8, 10)
 *   "RSVP Exile"    → Track Rating is less than 4     (1.5 stars and below = 1, 2, 3)
 *
 * Note: rating 4 is intentionally never used to avoid a dead zone between
 * the rotation (>4) and exile (<4) playlists.
 */

const fs   = require("fs");
const path = require("path");

const DATA_PATH = process.env.SKIP_DATA_PATH || path.join(__dirname, "..", "data", "skip-data.json");

// ── Rating map ────────────────────────────────────────────────────────────────
// Plex internal scale: 1=0.5star, 2=1star, 3=1.5star, 6=3star, 8=4star, 10=5star
//
// Smart playlist setup:
//   "RSVP Rotation" → Track Rating is greater than 4  (3 stars+ = ratings 6, 8, 10)
//   "RSVP Exile"    → Track Rating is less than 4     (1.5 stars and below = 1, 2, 3)
//
// Rating 4 is intentionally skipped to avoid a dead zone between the two
// playlists (not in rotation > 4, not in exile < 4).
function starsForStrikes(strikes, softStrikes = 0) {
  if (strikes <= 0 && softStrikes <= 0) return 10; // 5 stars   — clean
  if (strikes <= 0 && softStrikes > 0)  return 8;  // 4 stars   — minor accumulation
  if (strikes === 1)                    return 6;  // 3 stars   — warning, still rotating
  if (strikes <= 3)                     return 3;  // 1.5 stars — on notice, exile
  if (strikes === 4)                    return 2;  // 1 star    — deep exile
  return 1;                                        // 0.5 star  — permanent exile (5+)
}

// ── Plex API call ─────────────────────────────────────────────────────────────
async function updatePlexRating(ratingKey, stars, plexBase, plexToken, timeoutMs = 4000) {
  if (!ratingKey || !plexBase || !plexToken) return false;
  const url = `${plexBase}/:/rate?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(ratingKey)}&rating=${stars}&X-Plex-Token=${encodeURIComponent(plexToken)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || 4000));
  try {
    const res = await fetch(url, { method: "PUT", signal: controller.signal });
    if (!res.ok) {
      console.warn(`[plex-sync] Failed to rate key:${ratingKey} — HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    const reason = err?.name === "AbortError" ? "timeout" : err.message;
    console.warn(`[plex-sync] Error rating key:${ratingKey} —`, reason);
    return false;
  } finally {
    clearTimeout(timer);
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

    const stars = starsForStrikes(entry.strikes, entry.softStrikes || 0);
    const ok    = await updatePlexRating(ratingKey, stars, plexBase, plexToken);

    if (ok) {
      const softTag = entry.softStrikes ? ` (+${entry.softStrikes} soft)` : "";
      console.log(`[plex-sync] "${entry.title}" → ${stars / 2} stars (${entry.strikes} strikes${softTag})`);
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

module.exports = { syncRating, syncAll, starsForStrikes, updatePlexRating };
