"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES } = require("../../intelligence/ambient-light");
const { swatches, colorToPayload } = require("../../scripts/sample-hue-colors");

test("richer color scheme is now the permanent palette, not a preview-only candidate", () => {
  const all = swatches();
  assert.equal(all.length, 14);
  assert.deepEqual(swatches({ rich: true }), all);
  assert.equal(PALETTES.day.base, "#E49B42");
  assert.equal(PALETTES.night.base, "#6A1C9A");
  assert.equal(PALETTES.day.strength, 0.56);
  assert.equal(PALETTES.night.strength, 0.56);
});

test("both palettes have rich colors, no nearly-white swatches, and retain salmon", () => {
  const all = swatches();
  const day = all.filter(s => s.phase === "day");
  const night = all.filter(s => s.phase === "night");
  assert.equal(day.length, 6);
  assert.equal(night.length, 8);
  assert.ok(night.some(s => s.hex === "#D56A61"));
  assert.ok(all.every(s => s.bri === PALETTES[s.phase].brightness));
  assert.ok(all.every(s => {
    const rgb = [1, 3, 5].map(i => parseInt(s.hex.slice(i, i + 2), 16));
    const saturationSpan = Math.max(...rgb) - Math.min(...rgb);
    const payload = colorToPayload(s);
    return saturationSpan >= 50 && payload.durMs === 1000 &&
      payload.bri === s.bri && payload.xy.length === 2 &&
      payload.xy.every(x => x > 0 && x < 1);
  }));
});
