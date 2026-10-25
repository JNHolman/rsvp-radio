"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMusicTransition } = require("../../intelligence/music-transition");

test("time boundary does not force an incoming song or interrupt the current one", () => {
  const engine = createMusicTransition({ random: () => 0 });
  engine.observeBlock("lounge");
  assert.equal(engine.chooseForTrack("100").mode, "lounge");
  assert.equal(engine.confirmPrepared("100", "lounge"), true);
  engine.observeBlock("rap");
  const next = engine.chooseForTrack("101");
  assert.equal(next.mode, "lounge");
  assert.equal(next.incomingPct, 0);
  assert.equal(engine.snapshot().transition.prepared, 0);
});

test("scheduled change progresses by confirmed songs, not by wall-clock polling", () => {
  const engine = createMusicTransition({ random: () => 0 });
  engine.observeBlock("lofi");
  assert.equal(engine.chooseForTrack("1").mode, "lofi");
  engine.confirmPrepared("1", "lofi");
  engine.observeBlock("lounge");
  assert.equal(engine.chooseForTrack("2").mode, "lofi");
  assert.equal(engine.chooseForTrack("2").mode, "lofi");
  assert.equal(engine.snapshot().transition.prepared, 0);
  engine.confirmPrepared("2", "lofi");
  assert.ok(engine.snapshot().transition.incomingPct > 0);
  assert.equal(engine.chooseForTrack("3").mode, "lounge");
  engine.confirmPrepared("3", "lounge");
  assert.equal(engine.snapshot().transition.prepared, 2);
  assert.equal(engine.snapshot().source, "lounge");
});

test("a failed or stale preparation does not advance blending", () => {
  const engine = createMusicTransition({ random: () => 0.95 });
  engine.observeBlock("rap");
  engine.chooseForTrack("1");
  engine.confirmPrepared("1", "rap");
  engine.observeBlock("rnb");
  const proposed = engine.chooseForTrack("2");
  assert.equal(engine.confirmPrepared("2", "rnb"), false);
  assert.equal(engine.snapshot().transition.prepared, 0);
  assert.equal(engine.isPending("2", proposed.mode), true);
  engine.observeBlock("lofi"); // a newer boundary invalidates stale queue work
  assert.equal(engine.isPending("2", proposed.mode), false);
});

test("manual reset preserves the explicitly chosen source on return to schedule", () => {
  const engine = createMusicTransition();
  engine.observeBlock("rap");
  engine.reset("rnb");
  engine.observeBlock("lofi");
  assert.equal(engine.chooseForTrack("77").mode, "rnb");
  assert.equal(engine.snapshot().transition.toMode, "lofi");
});

test("skip steering takes priority and is only advanced after queue success", () => {
  const engine = createMusicTransition({ random: () => 0.999 });
  engine.observeBlock("lofi");
  engine.chooseForTrack("a");
  engine.confirmPrepared("a", "lofi");
  engine.observeBlock("lounge");
  const next = engine.chooseForTrack("b", { steeringMode: "rap" });
  assert.equal(next.mode, "rap");
  assert.equal(next.reason, "skip_steering");
  assert.equal(engine.confirmPrepared("b", "rap"), true);
  assert.equal(engine.snapshot().source, "rap");
  assert.equal(engine.snapshot().transition.prepared, 1);
});

test("same track cannot be prepared twice and empty mode never creates a decision", () => {
  const engine = createMusicTransition();
  assert.equal(engine.chooseForTrack("1").mode, "");
  engine.observeBlock("rnb");
  engine.chooseForTrack("1");
  engine.confirmPrepared("1", "rnb");
  assert.equal(engine.chooseForTrack("1").reason, "already_prepared");
});

test("pausing automation cancels a pending pick without losing the prior source", () => {
  const engine = createMusicTransition({ random: () => 0 });
  engine.observeBlock("lounge");
  engine.chooseForTrack("1");
  engine.confirmPrepared("1", "lounge");
  engine.chooseForTrack("2");
  engine.cancelPending();
  assert.equal(engine.isPending("2", "lounge"), false);
  engine.observeBlock("rap");
  assert.equal(engine.snapshot().transition.fromMode, "lounge");
  assert.equal(engine.chooseForTrack("3").mode, "lounge");
});
