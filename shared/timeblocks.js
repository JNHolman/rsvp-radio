"use strict";

// Central RSVP Radio time-block schedule.
// Minutes are local time, 0-1439.
// Music + lighting handoff policy: 20 minutes centered on each time-block boundary.
// The current block gradually yields to the incoming block at natural track
// changes. No dedicated transition playlists are required.
const MUSIC_BLEND_WINDOW_MIN = 20;
const MUSIC_BLEND_HALF_MIN = MUSIC_BLEND_WINDOW_MIN / 2;
const MUSIC_BLEND_STAGES = Object.freeze([
  Object.freeze({ startOffsetMin: -10, endOffsetMin: -5, oldPct: 80, newPct: 20 }),
  Object.freeze({ startOffsetMin:  -5, endOffsetMin:  0, oldPct: 60, newPct: 40 }),
  Object.freeze({ startOffsetMin:   0, endOffsetMin:  5, oldPct: 40, newPct: 60 }),
  Object.freeze({ startOffsetMin:   5, endOffsetMin: 10, oldPct: 20, newPct: 80 }),
]);

const TIME_BLOCKS = [
  { mode: "lofi",   startMin: 4 * 60,  endMin: 10 * 60 },
  { mode: "lounge", startMin: 10 * 60, endMin: 17 * 60 },
  { mode: "rap",  startMin: 17 * 60, endMin: 23 * 60 },
  { mode: "rnb",  startMin: 23 * 60, endMin: 4 * 60  },
];

function _normMinute(minute) {
  const n = Number(minute);
  if (!Number.isFinite(n)) return 0;
  return ((Math.floor(n) % 1440) + 1440) % 1440;
}

function blockModeForMinute(minute) {
  const m = _normMinute(minute);
  for (const block of TIME_BLOCKS) {
    if (block.startMin < block.endMin) {
      if (m >= block.startMin && m < block.endMin) return block.mode;
    } else if (m >= block.startMin || m < block.endMin) {
      return block.mode;
    }
  }
  return "rnb";
}

function blockModeForDate(date = new Date()) {
  return blockModeForMinute(date.getHours() * 60 + date.getMinutes());
}

function getNextBoundaryMs(date = new Date()) {
  const nowMin = date.getHours() * 60 + date.getMinutes();
  const boundaries = TIME_BLOCKS.map((b) => b.startMin).sort((a, b) => a - b);

  let nextMin = boundaries.find((m) => m > nowMin);
  let addDays = 0;
  if (nextMin === undefined) {
    nextMin = boundaries[0];
    addDays = 1;
  }

  const next = new Date(date);
  next.setDate(next.getDate() + addDays);
  next.setHours(Math.floor(nextMin / 60), nextMin % 60, 0, 0);

  // If exactly on a boundary, move to the following boundary.
  if (next.getTime() <= date.getTime()) {
    const idx = boundaries.indexOf(nextMin);
    const following = boundaries[(idx + 1) % boundaries.length];
    next.setDate(date.getDate() + (following <= nextMin ? 1 : 0));
    next.setHours(Math.floor(following / 60), following % 60, 0, 0);
  }

  return next.getTime();
}

function getNextBoundaryMode(date = new Date()) {
  const next = new Date(getNextBoundaryMs(date));
  return blockModeForMinute(next.getHours() * 60 + next.getMinutes());
}

function _boundaryCandidates(date) {
  const out = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset += 1) {
    for (const block of TIME_BLOCKS) {
      const d = new Date(date);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(Math.floor(block.startMin / 60), block.startMin % 60, 0, 0);
      out.push({ boundaryMs: d.getTime(), boundaryMinute: block.startMin });
    }
  }
  return out;
}

/**
 * Return the active 20-minute music blend around the nearest schedule boundary.
 * Window is [-10m, +10m): 80/20 -> 60/40 -> 40/60 -> 20/80.
 */
function getMusicBlendState(date = new Date()) {
  const nowMs = date.getTime();
  const halfMs = MUSIC_BLEND_HALF_MIN * 60 * 1000;

  let nearest = null;
  for (const candidate of _boundaryCandidates(date)) {
    const deltaMs = nowMs - candidate.boundaryMs;
    if (deltaMs < -halfMs || deltaMs >= halfMs) continue;
    if (!nearest || Math.abs(deltaMs) < Math.abs(nearest.deltaMs)) {
      nearest = { ...candidate, deltaMs };
    }
  }
  if (!nearest) return null;

  const offsetMin = nearest.deltaMs / 60000;
  const stageIndex = MUSIC_BLEND_STAGES.findIndex(
    (stage) => offsetMin >= stage.startOffsetMin && offsetMin < stage.endOffsetMin,
  );
  if (stageIndex < 0) return null;

  const stage = MUSIC_BLEND_STAGES[stageIndex];
  return {
    active: true,
    boundaryMs: nearest.boundaryMs,
    boundaryMinute: nearest.boundaryMinute,
    offsetMin,
    stageIndex,
    fromMode: blockModeForMinute(nearest.boundaryMinute - 1),
    toMode: blockModeForMinute(nearest.boundaryMinute),
    oldPct: stage.oldPct,
    newPct: stage.newPct,
    stageStartOffsetMin: stage.startOffsetMin,
    stageEndOffsetMin: stage.endOffsetMin,
  };
}

/**
 * Return the next future start of a music-blend window. This is intentionally
 * future-only so a user who explicitly selects a manual mode while a blend is
 * already active is not immediately expired by an already-passed start time.
 */
function getNextMusicBlendStartMs(date = new Date()) {
  const nowMs = date.getTime();
  let boundaryMs = getNextBoundaryMs(date);
  let startMs = boundaryMs - MUSIC_BLEND_HALF_MIN * 60 * 1000;

  if (startMs <= nowMs) {
    boundaryMs = getNextBoundaryMs(new Date(boundaryMs + 1));
    startMs = boundaryMs - MUSIC_BLEND_HALF_MIN * 60 * 1000;
  }
  return startMs;
}

module.exports = {
  TIME_BLOCKS,
  MUSIC_BLEND_WINDOW_MIN,
  MUSIC_BLEND_HALF_MIN,
  MUSIC_BLEND_STAGES,
  blockModeForMinute,
  blockModeForDate,
  getNextBoundaryMs,
  getNextBoundaryMode,
  getMusicBlendState,
  getNextMusicBlendStartMs,
};