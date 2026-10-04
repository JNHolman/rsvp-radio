"use strict";

/**
 * intelligence/steering.js
 *
 * Playlist-lane steering for RSVP Radio.
 *
 * The curator owns the lanes. The engine only decides when to move laterally
 * after repeated hard/soft skips; it never invents music or crosses modes.
 *
 * Lane config is supplied as JSON:
 * {
 *   "lofi": ["RSVP LOFI - A", "RSVP LOFI - B"],
 *   "wrap": ["RSVP WRAP - A", "RSVP WRAP - B"],
 *   "rap":  ["RSVP RAP - A",  "RSVP RAP - B"],
 *   "rnb":  ["RSVP RNB - A",  "RSVP RNB - B"]
 * }
 */

const MODES = new Set(["lofi", "wrap", "rap", "rnb"]);

function normalizeLanes(input) {
  const out = {};
  for (const mode of MODES) {
    const lanes = Array.isArray(input?.[mode]) ? input[mode] : [];
    out[mode] = lanes
      .map((lane) => typeof lane === "string" ? { title: lane } : lane)
      .filter((lane) => lane && typeof lane.title === "string" && lane.title.trim())
      .map((lane) => ({ ...lane, title: lane.title.trim() }));
  }
  return out;
}

function parseLaneConfig(raw) {
  if (!raw) return normalizeLanes({});
  try {
    return normalizeLanes(JSON.parse(raw));
  } catch (err) {
    throw new Error(`invalid RSVP_LANES_JSON: ${err.message}`);
  }
}

function nextLane({ mode, currentTitle, lanes, laneStats = {}, direction = 1 }) {
  if (!MODES.has(mode)) return null;
  const list = lanes?.[mode] || [];
  if (list.length < 2) return null;

  const currentIndex = list.findIndex((lane) => lane.title === currentTitle);
  const step = direction < 0 ? -1 : 1;
  const start = currentIndex < 0 ? -1 : currentIndex;

  // Prefer the next curated lane that has not already failed this session.
  for (let offset = 1; offset <= list.length; offset++) {
    const idx = (start + (step * offset) + list.length) % list.length;
    const lane = list[idx];
    const stats = laneStats[lane.title] || {};
    if (!stats.failedThisSession) return lane;
  }

  // If every lane has failed, fall back to the normal curated rotation.
  const fallbackIndex = (start + step + list.length) % list.length;
  return list[fallbackIndex];
}

function shouldSteer({
  consecutiveSkips,
  threshold = 2,
  lastSteeredAt = 0,
  now = Date.now(),
  minDwellMs = 0,
}) {
  if (Number(consecutiveSkips) < Number(threshold)) return false;
  if (lastSteeredAt && (now - lastSteeredAt) < Number(minDwellMs || 0)) return false;
  return true;
}

function createState() {
  return {
    mode: null,
    currentLaneTitle: null,
    consecutiveSkips: 0,
    lastSkipRatingKey: null,
    lastSkipAt: 0,
    lastSteeredAt: 0,
    laneStats: {},
  };
}

function notePlay(state, { mode, laneTitle } = {}) {
  if (mode && state.mode !== mode) {
    state.mode = mode;
    state.currentLaneTitle = laneTitle || null;
  } else if (laneTitle) {
    state.currentLaneTitle = laneTitle;
  }
  state.consecutiveSkips = 0;
  state.lastSkipRatingKey = null;
  state.lastSkipAt = 0;
  return state;
}

function noteSkip(state, {
  mode,
  laneTitle,
  ratingKey,
  now = Date.now(),
  windowMs = 10 * 60 * 1000,
} = {}) {
  if (mode && state.mode !== mode) {
    state.mode = mode;
    state.currentLaneTitle = laneTitle || null;
    state.consecutiveSkips = 0;
    state.lastSkipRatingKey = null;
    state.lastSkipAt = 0;
  } else if (laneTitle) {
    state.currentLaneTitle = laneTitle;
  }

  const outsideWindow = state.lastSkipAt && (now - state.lastSkipAt) > Number(windowMs || 0);
  if (outsideWindow) state.consecutiveSkips = 0;

  // Repeated skips of the same track remain song-level feedback. They should
  // not be allowed to vote multiple times for abandoning an entire lane.
  if (!ratingKey || ratingKey !== state.lastSkipRatingKey) {
    state.consecutiveSkips += 1;
  }

  state.lastSkipRatingKey = ratingKey || null;
  state.lastSkipAt = now;
  return state;
}

function markLaneResult(state, laneTitle, result) {
  if (!laneTitle) return state;
  const stats = state.laneStats[laneTitle] || {
    plays: 0,
    skips: 0,
    successfulRuns: 0,
    failedThisSession: false,
  };

  if (result === "play") {
    stats.plays += 1;
    if (stats.plays >= 2 && stats.skips === 0) {
      stats.successfulRuns += 1;
      stats.failedThisSession = false;
    }
  } else if (result === "skip") {
    stats.skips += 1;
  } else if (result === "failed") {
    stats.failedThisSession = true;
  }

  state.laneStats[laneTitle] = stats;
  return state;
}

function resetLaneStatsForSession(state) {
  state.laneStats = {};
  return state;
}

function resetForMode(state, mode, laneTitle = null) {
  state.mode = mode || null;
  state.currentLaneTitle = laneTitle;
  state.consecutiveSkips = 0;
  state.lastSkipRatingKey = null;
  state.lastSkipAt = 0;
  return state;
}

module.exports = {
  MODES,
  normalizeLanes,
  parseLaneConfig,
  nextLane,
  shouldSteer,
  createState,
  notePlay,
  noteSkip,
  markLaneResult,
  resetLaneStatsForSession,
  resetForMode,
};
