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
