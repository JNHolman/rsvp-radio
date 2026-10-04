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


test("blend window spans five minutes before and after a boundary", () => {
  const pre = timeblocks.blendWindowForMinute(11 * 60 + 57);
  assert.equal(pre.outgoingMode, "lofi");
  assert.equal(pre.incomingMode, "wrap");
  assert.equal(pre.phase, "pre");

  const post = timeblocks.blendWindowForMinute(12 * 60 + 3);
  assert.equal(post.outgoingMode, "lofi");
  assert.equal(post.incomingMode, "wrap");
  assert.equal(post.phase, "post");

  assert.equal(timeblocks.blendWindowForMinute(11 * 60 + 54), null);
  assert.equal(timeblocks.blendWindowForMinute(12 * 60 + 5), null);
});

test("blend window handles overnight boundary correctly", () => {
  const pre = timeblocks.blendWindowForMinute(3 * 60 + 58);
  assert.equal(pre.outgoingMode, "rnb");
  assert.equal(pre.incomingMode, "lofi");

  const post = timeblocks.blendWindowForMinute(4 * 60 + 2);
  assert.equal(post.outgoingMode, "rnb");
  assert.equal(post.incomingMode, "lofi");
});
