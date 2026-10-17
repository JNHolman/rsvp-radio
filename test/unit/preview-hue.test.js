"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { choosePreviewCommand } = require("../../scripts/preview-hue");

test("preview sends one three-minute fade on its first color", () => {
  const state = { last: null, previousColor: null };
  const c = choosePreviewCommand("night", 2000000000, state);
  assert.equal(c.payload.durMs, 180000);
  assert.deepEqual(c.payload.xy, c.next.xy);
  assert.equal(c.payload.bri, c.next.bri);
});

test("preview makes no repeated Hue calls while the same color is held", () => {
  const now = Date.UTC(2026, 9, 17, 11);
  const first = choosePreviewCommand("night", now, { last: null, previousColor: null });
  const later = choosePreviewCommand("night", Math.min(now + 60000, first.next.nextChangeAt - 1000), {
    last: first.next, previousColor: null,
  });
  assert.equal(later.next.key, first.next.key);
  assert.equal(later.payload, null);
});

test("solar change and new selection fade fully without abrupt Hue commands", () => {
  const now = Date.UTC(2026, 9, 17, 13);
  const day = choosePreviewCommand("day", now, { last: null, previousColor: null });
  const night = choosePreviewCommand("night", now, { last: day.next, previousColor: null });
  assert.ok(night.payload);
  assert.notEqual(night.next.color, day.next.color);
  assert.equal(night.payload.durMs, 180000);
});
