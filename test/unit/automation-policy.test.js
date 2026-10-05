const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldReclaimForBlend } = require("../../intelligence/automation-policy");

const boundaryMs = new Date(2026, 9, 4, 12, 0, 0, 0).getTime();
const blendState = { active:true, boundaryMs };
const startMs = boundaryMs - 10 * 60 * 1000;

test("a stop from before the current blend is reclaimed at the blend window", () => {
  assert.equal(shouldReclaimForBlend({
    manualStop:true, stoppedAt:startMs - 60_000, blendState, blendHalfMin:10,
  }), true);
});

test("a stop issued during the active blend survives that blend", () => {
  assert.equal(shouldReclaimForBlend({
    manualStop:true, stoppedAt:startMs + 60_000, blendState, blendHalfMin:10,
  }), false);
});

test("a stop issued exactly at blend start is explicit current-blend intent", () => {
  assert.equal(shouldReclaimForBlend({
    manualStop:true, stoppedAt:startMs, blendState, blendHalfMin:10,
  }), false);
});

test("no manual stop or no active blend never reclaims", () => {
  assert.equal(shouldReclaimForBlend({manualStop:false, stoppedAt:startMs-1, blendState, blendHalfMin:10}), false);
  assert.equal(shouldReclaimForBlend({manualStop:true, stoppedAt:startMs-1, blendState:null, blendHalfMin:10}), false);
});
