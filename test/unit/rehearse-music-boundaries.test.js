"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseDraftPools, runBoundary, rehearse, BOUNDARIES,
} = require("../../scripts/rehearse-music-boundaries");

const file = path.join(__dirname, "../../config/music-pools-20261025.proposed.env");
const pools = parseDraftPools(fs.readFileSync(file, "utf8"));

test("proposed 12-playlist file provides four usable sources without modifying production", () => {
  assert.deepEqual(Object.keys(pools), ["lofi", "lounge", "rap", "rnb"]);
  const sources = new Set(Object.values(pools).flat());
  assert.equal(sources.size, 12);
});

test("all four boundaries retain the current song and initially prefer the preceding block", () => {
  for (const boundary of BOUNDARIES) {
    const result = runBoundary(boundary, pools);
    assert.equal(result.boundary, boundary.at);
    assert.equal(result.sequence.length, 18);
    assert.equal(result.sequence[0].mode, boundary.before);
    assert.equal(result.sequence[0].incomingPct, 0);
    assert.ok(result.sequence.every(row => pools[row.mode].includes(row.fromPool)));
  }
});

test("the incoming block gains preference over successive confirmed track opportunities", () => {
  for (const result of rehearse(pools)) {
    const last = result.sequence.at(-1);
    assert.ok(last.incomingPct > 70, "blend stalled: " + result.boundary);
    assert.ok(result.sequence.some(row => row.mode === result.newMode),
      "new mode never selected: " + result.boundary);
    assert.ok(result.sequence.some(row => row.mode === result.oldMode),
      "old mode never preserved: " + result.boundary);
  }
});

test("rehearsal is deterministic and rejects missing pool assignments", () => {
  assert.deepEqual(rehearse(pools), rehearse(pools));
  assert.throws(() => parseDraftPools("MUSIC_POOL_RAP=\"\""), /missing_or_repeated_pool_/);
  const broken = { ...pools, lounge: [] };
  assert.throws(() => runBoundary(BOUNDARIES[1], broken), /boundary_source_missing/);
});
