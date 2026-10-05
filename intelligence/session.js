"use strict";

/**
 * intelligence/session.js — RSVP Radio Session Detection
 *
 * Detects when a new session starts (first song after 30+ min of silence)
 * and reads the seed song's genre from Plex to set the initial lights mode.
 *
 * Seed → Lights mode map:
 *   R&B, Soul, Neo-Soul, 90s R&B, 2000s R&B  → rnb
 *   Hip Hop, Rap, Trap, Southern Hip Hop       → rap
 *   Lo-Fi, Lounge, Chill, Jazz, Ambient        → lofi
 *   Pop, Dance, Party, Electronic              → wrap
 *   Unrecognized / untagged                    → current time block (safe fallback)
 *
 * Session state persists to data/session.json
 */

const fs   = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./atomic-json");

const DATA_PATH    = process.env.SESSION_DATA_PATH || path.join(__dirname, "..", "data", "session.json");
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes of silence = new session
const GENRE_FETCH_TIMEOUT_MS = Number(process.env.SESSION_GENRE_FETCH_TIMEOUT_MS) || 4000;
const HEARTBEAT_PERSIST_MS = Number(process.env.SESSION_HEARTBEAT_PERSIST_MS) || 5 * 60 * 1000;
let _lastHeartbeatPersistAt = 0;

// ── Genre → mode map ──────────────────────────────────────────────────────────
const GENRE_MODE_MAP = [
  { keywords: ["r&b", "rnb", "soul", "neo-soul", "neo soul", "quiet storm"], mode: "rnb"  },
  { keywords: ["hip hop", "hip-hop", "rap", "trap", "southern", "drill"],     mode: "rap"  },
  { keywords: ["lo-fi", "lofi", "lo fi", "lounge", "chill", "jazz", "ambient", "instrumental"], mode: "lofi" },
  { keywords: ["pop", "dance", "party", "electronic", "edm", "funk"],         mode: "wrap" },
];

function genreToMode(genres) {
  if (!genres || genres.length === 0) return null;
  const combined = genres.join(" ").toLowerCase();
  for (const entry of GENRE_MODE_MAP) {
    if (entry.keywords.some(k => combined.includes(k))) return entry.mode;
  }
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────
function load() {
  try {
    if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {}
  return { lastPlayedAt: 0, seedRatingKey: null, seedTitle: "", seedArtist: "", seedMode: null, sessionCount: 0 };
}

function save(data) {
  try {
    writeJsonAtomic(DATA_PATH, data);
    _lastHeartbeatPersistAt = Date.now();
  } catch (err) {
    console.warn("[session] save failed:", err.message);
  }
}

// ── Fetch genres from Plex ────────────────────────────────────────────────────
async function fetchGenres(ratingKey, plexBase, plexToken) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GENRE_FETCH_TIMEOUT_MS);
  try {
    const url = `${plexBase}/library/metadata/${ratingKey}?X-Plex-Token=${encodeURIComponent(plexToken)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const xml    = await res.text();
    const genres = [];
    const re     = /<Genre[^>]+tag="([^"]+)"/gi;
    let m;
    while ((m = re.exec(xml)) !== null) genres.push(m[1]);
    return genres;
  } catch { return []; }
  finally { clearTimeout(timer); }
}

// ── Main: check if new session and handle seed ────────────────────────────────

/**
 * checkSession — call this every poll when a track is playing
 * Returns the seed mode if a new session was detected, null otherwise
 *
 * @param {object} track       - { ratingKey, title, artist }
 * @param {string} plexBase    - e.g. http://127.0.0.1:32400
 * @param {string} plexToken   - Plex auth token
 * @param {function} blockMode - fallback function returning current time block mode
 * @returns {string|null}      - mode to switch to, or null if mid-session
 */
async function checkSession(track, plexBase, plexToken, blockMode) {
  const state = load();
  const now   = Date.now();

  // Update last played timestamp
  const wasIdle = (now - state.lastPlayedAt) > IDLE_TIMEOUT;
  state.lastPlayedAt = now;

  // Mid-session we only need a coarse persisted heartbeat. Writing and fsyncing
  // every poll adds needless storage churn on a Pi; a five-minute checkpoint is
  // comfortably inside the 30-minute idle threshold while still surviving restarts.
  if (!wasIdle) {
    if (!_lastHeartbeatPersistAt || (now - _lastHeartbeatPersistAt) >= HEARTBEAT_PERSIST_MS) save(state);
    return null;
  }

  // ── New session detected ──────────────────────────────────────────────────
  state.sessionCount++;
  state.seedRatingKey = track.ratingKey;
  state.seedTitle     = track.title;
  state.seedArtist    = track.artist;
  state.sessionStartedAt = now;
  state.seedMode      = null;
  state.seedGenres    = [];

  // Persist immediately so slow Plex metadata does not trigger duplicate sessions
  save(state);

  console.log(`[session] New session #${state.sessionCount} — seed: "${track.title}" by ${track.artist}`);

  // Fetch genres for seed song
  const genres = await fetchGenres(track.ratingKey, plexBase, plexToken);
  console.log(`[session] Seed genres: ${genres.length ? genres.join(", ") : "none"}`);

  // Reload latest state so we only enrich the same session we started above
  const latest = load();
  if (latest.sessionStartedAt !== now || latest.seedRatingKey !== track.ratingKey) {
    return latest.seedMode || null;
  }

  // Map genres to mode
  const detectedMode = genreToMode(genres);
  const mode         = detectedMode || blockMode();

  latest.seedMode   = mode;
  latest.seedGenres = genres;

  console.log(`[session] Setting lights mode → ${mode}${detectedMode ? " (from genre)" : " (time block fallback)"}`);

  save(latest);
  return mode;
}

/**
 * getSession — returns current session state for dashboard
 */
function getSession() {
  return load();
}

module.exports = { checkSession, getSession, genreToMode, fetchGenres };