"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { choosePreviewCommand } = require("../../scripts/preview-hue");

test("preview starts with an unobtrusive three-minute entry fade", () => {
  const c = choosePreviewCommand("night", 2000000000, { last: null, holdUntil: 0 });
  assert.equal(c.payload.durMs, 180000);
  assert.equal(c.holdUntil, 2000180000);
  assert.deepEqual(c.payload.xy, c.next.xy);
  assert.equal(c.payload.bri, c.next.bri);
});

test("preview colors evolve quietly and cap movement on solar phase changes", () => {
  const start = choosePreviewCommand("day", 2000000000, { last: null, holdUntil: 0 });
  const next = choosePreviewCommand("night", 2000030000, { last: start.next, holdUntil: 0 });
  assert.equal(next.payload.durMs, 35000);
  assert.ok(Math.hypot(
    start.next.xy[0] - next.next.xy[0],
    start.next.xy[1] - next.next.xy[1],
  ) <= 0.027);
  assert.ok(Math.abs(start.next.bri - next.next.bri) <= 6);
});
