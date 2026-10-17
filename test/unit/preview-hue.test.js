"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { choosePreviewCommand } = require("../../scripts/preview-hue");

test("preview sends a single three-minute fade on first contact", () => {
  const now = Date.UTC(2026, 9, 17, 19);
  const c = choosePreviewCommand("night", now, { last: null });
  assert.equal(c.payload.durMs, 180000);
  assert.deepEqual(c.payload.xy, c.next.xy);
});

test("preview does not interrupt a held color", () => {
  const now = Date.UTC(2026, 9, 17, 19);
  const first = choosePreviewCommand("night", now, { last: null });
  const later = choosePreviewCommand("night", Math.min(now + 30000, first.next.nextChangeAt - 1000), { last: first.next });
  assert.equal(later.next.key, first.next.key);
  assert.equal(later.payload, null);
});

test("changing solar phase triggers a new gentle fade", () => {
  const now = Date.UTC(2026, 9, 17, 19);
  const day = choosePreviewCommand("day", now, { last: null });
  const night = choosePreviewCommand("night", now, { last: day.next });
  assert.notEqual(night.next.key, day.next.key);
  assert.equal(night.payload.durMs, 180000);
});
