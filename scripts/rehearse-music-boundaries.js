"use strict";

/**
 * RSVP Radio: OFFLINE, read-only, no-media-command handoff rehearsal.
 *
 * Uses the proposed draft source pools and the actual music-transition module.
 * There are NO Plex imports, network requests, playback commands or file writes.
 * This proves source-choice continuity and schedule wiring only, not audio/BPM fit.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createMusicTransition } = require("../intelligence/music-transition");

const MODE_ORDER = Object.freeze(["rnb", "lofi", "lounge", "rap", "rnb"]);
const BOUNDARIES = Object.freeze([
  { at: "04:00", before: "rnb", after: "lofi" },
  { at: "10:00", before: "lofi", after: "lounge" },
  { at: "17:00", before: "lounge", after: "rap" },
  { at: "23:00", before: "rap", after: "rnb" },
]);
const DEFAULT_POOLS = path.join(__dirname, "../config/music-pools-20261025.proposed.env");

function parseDraftPools(text) {
  const pools = {};
  for (const mode of ["lofi", "lounge", "rap", "rnb"]) {
    const name = "MUSIC_POOL_" + mode.toUpperCase();
    const rows = String(text).split(/\r?\n/).filter(line => line.startsWith(name + "="));
    if (rows.length !== 1) throw new Error("missing_or_repeated_pool_" + mode);
    const raw = rows[0].slice(name.length + 1).trim();
    if (!/^"[^"]+"$/.test(raw)) throw new Error("invalid_pool_value_" + mode);
    pools[mode] = [...new Set(raw.slice(1, -1).split("|").map(s => s.trim()).filter(Boolean))];
    if (!pools[mode].length) throw new Error("empty_pool_" + mode);
  }
  return pools;
}

// Seeded, reproducible, deterministic. Not a production play-order policy.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function runBoundary(boundary, pools, { count = 18, seed = 1836 } = {}) {
  if (!boundary || !pools?.[boundary.before]?.length || !pools?.[boundary.after]?.length) {
    throw new Error("boundary_source_missing");
  }
  const random = seededRandom(seed);
  const transition = createMusicTransition({ random });
  transition.observeBlock(boundary.before);
  const warmup = transition.chooseForTrack("before-boundary");
  if (warmup.mode !== boundary.before ||
      !transition.confirmPrepared("before-boundary", boundary.before)) {
    throw new Error("warmup_failed");
  }
  transition.observeBlock(boundary.after);
  if (transition.chooseForTrack("before-boundary").reason !== "already_prepared") {
    throw new Error("boundary_queued_duplicate_for_current_song");
  }
  const sequence = [];
  for (let i = 0; i < count; i++) {
    const playingKey = "synthetic-track-" + i;
    const choice = transition.chooseForTrack(playingKey);
    if (i === 0 && choice.mode !== boundary.before) {
      throw new Error("forced_genre_jump_at_" + boundary.at);
    }
    if (!pools[choice.mode]?.length) throw new Error("missing_source_" + choice.mode);
    // Test a real source name from the proposed Plex pool while remaining
    // entirely off-air. No track is selected and no queue is touched.
    const sourceList = pools[choice.mode];
    const sourceIndex = Math.floor(random() * sourceList.length);
    const pool = sourceList[sourceIndex];
    if (!transition.confirmPrepared(playingKey, choice.mode)) {
      throw new Error("handoff_not_recorded");
    }
    if (transition.chooseForTrack(playingKey).reason !== "already_prepared") {
      throw new Error("duplicate_scheduled_handoff");
    }
    sequence.push({
      slot: i + 1, fromPool: pool, mode: choice.mode,
      incomingPct: choice.incomingPct,
    });
  }
  return {
    boundary: boundary.at,
    oldMode: boundary.before, newMode: boundary.after,
    sourcesBefore: pools[boundary.before].length,
    sourcesAfter: pools[boundary.after].length,
    sequence,
  };
}

function rehearse(pools, options = {}) {
  return BOUNDARIES.map((boundary, i) =>
    runBoundary(boundary, pools, { ...options, seed: (options.seed || 1836) + i * 101 }),
  );
}

if (require.main === module) {
  try {
    const pools = parseDraftPools(fs.readFileSync(DEFAULT_POOLS, "utf8"));
    console.log("RSVP MUSIC HANDOFF REHEARSAL — OFFLINE; NO PLEX OR PLAYER COMMANDS");
    for (const result of rehearse(pools)) {
      console.log("\n" + result.boundary + ": " + result.oldMode + " → " + result.newMode +
        " (available sources " + result.sourcesBefore + " → " + result.sourcesAfter + ")");
      console.log(result.sequence.map(x =>
        String(x.slot).padStart(2) + ". " + x.mode.padEnd(6) +
        " | " + x.fromPool + " | target preference " + x.incomingPct + "%",
      ).join("\n"));
    }
    console.log("\nSIMULATION ONLY — no audio compatibility claims; no production changes.");
  } catch (err) {
    console.error("REHEARSAL STOPPED:", err.message);
    process.exitCode = 1;
  }
}

module.exports = { parseDraftPools, runBoundary, rehearse, seededRandom, BOUNDARIES };
