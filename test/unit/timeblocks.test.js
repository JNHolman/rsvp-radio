const test = require("node:test");
const assert = require("node:assert/strict");
const timeblocks = require("../../shared/timeblocks");

test("time block schedule maps expected modes", () => {
  assert.equal(timeblocks.blockModeForMinute(4 * 60), "lofi");
  assert.equal(timeblocks.blockModeForMinute(11 * 60 + 59), "lofi");
  assert.equal(timeblocks.blockModeForMinute(12 * 60), "wrap");
  assert.equal(timeblocks.blockModeForMinute(17 * 60), "rap");
  assert.equal(timeblocks.blockModeForMinute(23 * 60), "rnb");
  assert.equal(timeblocks.blockModeForMinute(3 * 60 + 59), "rnb");
});

test("pre-fade window triggers 5 minutes before each boundary", () => {
  assert.equal(timeblocks.shouldTriggerBoundary(11 * 60 + 55, 12 * 60), true);
  assert.equal(timeblocks.shouldTriggerBoundary(11 * 60 + 56, 12 * 60), false);
  assert.equal(timeblocks.shouldTriggerBoundary(22 * 60 + 55, 23 * 60), true);
  assert.equal(timeblocks.shouldTriggerBoundary(23 * 60 + 55, 4 * 60), false);
  assert.equal(timeblocks.shouldTriggerBoundary(3 * 60 + 55, 4 * 60), true);
});
