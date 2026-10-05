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

test("20-minute handoff begins exactly 10 minutes before every boundary", () => {
  const probes = [
    [new Date(2026, 9, 4, 3, 50, 0, 0), "rnb", "lofi"],
    [new Date(2026, 9, 4, 11, 50, 0, 0), "lofi", "wrap"],
    [new Date(2026, 9, 4, 16, 50, 0, 0), "wrap", "rap"],
    [new Date(2026, 9, 4, 22, 50, 0, 0), "rap", "rnb"],
  ];
  for (const [date, fromMode, toMode] of probes) {
    const blend = timeblocks.getMusicBlendState(date);
    assert.ok(blend);
    assert.equal(blend.fromMode, fromMode);
    assert.equal(blend.toMode, toMode);
    assert.equal(blend.offsetMin, -10);
  }
});

test("music blend is 20 minutes centered on noon boundary", () => {
  const before = new Date(2026, 9, 4, 11, 49, 59, 999);
  const start  = new Date(2026, 9, 4, 11, 50, 0, 0);
  const end    = new Date(2026, 9, 4, 12, 10, 0, 0);

  assert.equal(timeblocks.getMusicBlendState(before), null);
  assert.ok(timeblocks.getMusicBlendState(start));
  assert.equal(timeblocks.getMusicBlendState(end), null);
});

test("music blend stages progress 80/20 -> 60/40 -> 40/60 -> 20/80", () => {
  const probes = [
    [new Date(2026, 9, 4, 11, 50, 0, 0), 80, 20, "lofi", "wrap", 0],
    [new Date(2026, 9, 4, 11, 55, 0, 0), 60, 40, "lofi", "wrap", 1],
    [new Date(2026, 9, 4, 12,  0, 0, 0), 40, 60, "lofi", "wrap", 2],
    [new Date(2026, 9, 4, 12,  5, 0, 0), 20, 80, "lofi", "wrap", 3],
  ];

  for (const [date, oldPct, newPct, fromMode, toMode, stageIndex] of probes) {
    const blend = timeblocks.getMusicBlendState(date);
    assert.ok(blend);
    assert.equal(blend.oldPct, oldPct);
    assert.equal(blend.newPct, newPct);
    assert.equal(blend.fromMode, fromMode);
    assert.equal(blend.toMode, toMode);
    assert.equal(blend.stageIndex, stageIndex);
  }
});

test("music blend handles overnight rnb -> lofi boundary", () => {
  const blend = timeblocks.getMusicBlendState(new Date(2026, 9, 4, 3, 57, 0, 0));
  assert.ok(blend);
  assert.equal(blend.fromMode, "rnb");
  assert.equal(blend.toMode, "lofi");
  assert.equal(blend.oldPct, 60);
  assert.equal(blend.newPct, 40);
});

test("next music blend start is future-only", () => {
  const before = new Date(2026, 9, 4, 11, 0, 0, 0);
  const startBeforeNoon = new Date(timeblocks.getNextMusicBlendStartMs(before));
  assert.equal(startBeforeNoon.getHours(), 11);
  assert.equal(startBeforeNoon.getMinutes(), 50);

  // Already inside the noon blend: an explicit manual selection should survive
  // this active blend and expire at the next one (16:50 for the 17:00 boundary).
  const inside = new Date(2026, 9, 4, 11, 55, 0, 0);
  const next = new Date(timeblocks.getNextMusicBlendStartMs(inside));
  assert.equal(next.getHours(), 16);
  assert.equal(next.getMinutes(), 50);
});