const test = require("node:test");
const assert = require("node:assert/strict");
const steering = require("../../intelligence/steering");

test("lane config stays inside explicit curated modes", () => {
  const lanes = steering.parseLaneConfig(JSON.stringify({
    rap: ["RSVP RAP - Main", "RSVP RAP - Left"],
    rnb: ["RSVP RNB - Main"],
    junk: ["Should Not Exist"],
  }));

  assert.deepEqual(lanes.rap.map((x) => x.title), ["RSVP RAP - Main", "RSVP RAP - Left"]);
  assert.deepEqual(lanes.rnb.map((x) => x.title), ["RSVP RNB - Main"]);
  assert.equal(lanes.junk, undefined);
});

test("nextLane moves laterally and wraps without crossing mode", () => {
  const lanes = steering.normalizeLanes({
    rap: ["A", "B", "C"],
    rnb: ["X", "Y"],
  });

  assert.equal(steering.nextLane({ mode: "rap", currentTitle: "A", lanes }).title, "B");
  assert.equal(steering.nextLane({ mode: "rap", currentTitle: "C", lanes }).title, "A");
  assert.equal(steering.nextLane({ mode: "rnb", currentTitle: "X", lanes }).title, "Y");
});

test("unknown current lane starts at the curated anchor", () => {
  const lanes = steering.normalizeLanes({ rap: ["Anchor", "Side"] });
  assert.equal(steering.nextLane({ mode: "rap", currentTitle: null, lanes }).title, "Anchor");
});

test("steering requires consecutive skip threshold", () => {
  assert.equal(steering.shouldSteer({ consecutiveSkips: 1, threshold: 2 }), false);
  assert.equal(steering.shouldSteer({ consecutiveSkips: 2, threshold: 2 }), true);
});

test("clean play resets skip pressure and mode change resets lane", () => {
  const state = steering.createState();

  steering.noteSkip(state, { mode: "rap", laneTitle: "A" });
  steering.noteSkip(state, { mode: "rap", laneTitle: "A" });
  assert.equal(state.consecutiveSkips, 2);

  steering.notePlay(state, { mode: "rap", laneTitle: "A" });
  assert.equal(state.consecutiveSkips, 0);

  steering.noteSkip(state, { mode: "rap", laneTitle: "A" });
  steering.resetForMode(state, "rnb");
  assert.equal(state.mode, "rnb");
  assert.equal(state.currentLaneTitle, null);
  assert.equal(state.consecutiveSkips, 0);
});


test("same song cannot cast multiple lane-change votes", () => {
  const state = steering.createState();

  steering.noteSkip(state, { mode: "rap", ratingKey: "1", now: 1000, windowMs: 600000 });
  steering.noteSkip(state, { mode: "rap", ratingKey: "1", now: 2000, windowMs: 600000 });

  assert.equal(state.consecutiveSkips, 1);
});

test("two different songs inside the vote window trigger steering pressure", () => {
  const state = steering.createState();

  steering.noteSkip(state, { mode: "rap", ratingKey: "1", now: 1000, windowMs: 600000 });
  steering.noteSkip(state, { mode: "rap", ratingKey: "2", now: 2000, windowMs: 600000 });

  assert.equal(state.consecutiveSkips, 2);
  assert.equal(steering.shouldSteer({
    consecutiveSkips: state.consecutiveSkips,
    threshold: 2,
    lastSteeredAt: 0,
    now: 2000,
    minDwellMs: 900000,
  }), true);
});

test("old skip pressure expires outside the vote window", () => {
  const state = steering.createState();

  steering.noteSkip(state, { mode: "rnb", ratingKey: "1", now: 1000, windowMs: 600000 });
  steering.noteSkip(state, { mode: "rnb", ratingKey: "2", now: 700001, windowMs: 600000 });

  assert.equal(state.consecutiveSkips, 1);
});

test("minimum dwell prevents lane ping-pong after a recent steer", () => {
  assert.equal(steering.shouldSteer({
    consecutiveSkips: 2,
    threshold: 2,
    lastSteeredAt: 1000,
    now: 2000,
    minDwellMs: 900000,
  }), false);

  assert.equal(steering.shouldSteer({
    consecutiveSkips: 2,
    threshold: 2,
    lastSteeredAt: 1000,
    now: 901001,
    minDwellMs: 900000,
  }), true);
});


test("failed lanes are skipped when choosing the next curated lane", () => {
  const lanes = steering.normalizeLanes({
    rap: ["A", "B", "C"],
  });
  const state = steering.createState();
  state.currentLaneTitle = "A";
  steering.markLaneResult(state, "B", "failed");

  const next = steering.nextLane({
    mode: "rap",
    currentTitle: "A",
    lanes,
    laneStats: state.laneStats,
  });

  assert.equal(next.title, "C");
});

test("successful lane can recover from a prior failed mark", () => {
  const state = steering.createState();
  steering.markLaneResult(state, "B", "failed");
  steering.markLaneResult(state, "B", "play");
  steering.markLaneResult(state, "B", "play");

  assert.equal(state.laneStats.B.failedThisSession, false);
  assert.equal(state.laneStats.B.successfulRuns, 1);
});

test("new listening session clears temporary lane failures", () => {
  const state = steering.createState();
  steering.markLaneResult(state, "B", "failed");
  assert.equal(state.laneStats.B.failedThisSession, true);

  steering.resetLaneStatsForSession(state);
  assert.deepEqual(state.laneStats, {});
});
