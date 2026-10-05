const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseNextVideoMode } = require("../../intelligence/video-blend-policy");

const blend = { active:true, fromMode:"lofi", toMode:"lounge", oldPct:60, newPct:40 };

test("video uses weighted old/new choice only at a clip boundary", () => {
  assert.equal(chooseNextVideoMode({
    currentMode:"lofi", blendState:blend, pendingMode:"lounge",
    automationEnabled:true, manualActive:false, randomFn:() => 0.20,
  }), "lofi");
  assert.equal(chooseNextVideoMode({
    currentMode:"lofi", blendState:blend, pendingMode:"lounge",
    automationEnabled:true, manualActive:false, randomFn:() => 0.80,
  }), "lounge");
});

test("hard-boundary pending mode cannot override an active weighted blend", () => {
  assert.equal(chooseNextVideoMode({
    currentMode:"lofi", blendState:blend, pendingMode:"lounge",
    automationEnabled:true, manualActive:false, randomFn:() => 0.10,
  }), "lofi");
});

test("outside blend, pending canonical mode wins at next clip boundary", () => {
  assert.equal(chooseNextVideoMode({
    currentMode:"lofi", blendState:null, pendingMode:"lounge",
    automationEnabled:true, manualActive:false,
  }), "lounge");
});

test("manual or stopped automation suppresses automatic video switching", () => {
  assert.equal(chooseNextVideoMode({
    currentMode:"rap", blendState:blend, pendingMode:"lounge",
    automationEnabled:false, manualActive:false, randomFn:() => 0.99,
  }), "rap");
  assert.equal(chooseNextVideoMode({
    currentMode:"rap", blendState:blend, pendingMode:"lounge",
    automationEnabled:true, manualActive:true, randomFn:() => 0.99,
  }), "rap");
});

test("overnight rnb -> lofi uses the same weighted clip-boundary policy", () => {
  const timeblocks = require("../../shared/timeblocks");
  const b = timeblocks.getMusicBlendState(new Date(2026, 9, 4, 3, 57, 0, 0));
  assert.ok(b);
  assert.equal(b.fromMode, "rnb");
  assert.equal(b.toMode, "lofi");
  assert.equal(b.oldPct, 60);
  assert.equal(b.newPct, 40);

  assert.equal(chooseNextVideoMode({
    currentMode: "rnb", blendState: b, pendingMode: "lofi",
    automationEnabled: true, manualActive: false, randomFn: () => 0.30,
  }), "rnb");
  assert.equal(chooseNextVideoMode({
    currentMode: "rnb", blendState: b, pendingMode: "lofi",
    automationEnabled: true, manualActive: false, randomFn: () => 0.80,
  }), "lofi");
});