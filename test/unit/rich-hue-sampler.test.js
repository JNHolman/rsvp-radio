"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES } = require("../../intelligence/ambient-light");
const { swatches, colorToPayload } = require("../../scripts/sample-hue-colors");

test("swatches use the permanent artwork-matched palette, not an old base overlay", () => {
  const all = swatches();
  assert.equal(all.length, 11);
  assert.deepEqual(swatches({ rich: true }), all);
  assert.deepEqual(PALETTES.day.accents.slice(0, 2), ["#287EC2", "#D69A37"]);
  assert.equal(PALETTES.night.accents.length, 6);
  assert.equal(PALETTES.day.brightness, 114);
  assert.equal(PALETTES.night.brightness, 76);
});

test("both Auto palettes have vivid distinct colors and rare night salmon", () => {
  const all = swatches();
  const day = all.filter(s => s.phase === "day");
  const night = all.filter(s => s.phase === "night");
  assert.equal(day.length, 5);
  assert.equal(night.length, 6);
  assert.ok(night.some(s => s.hex === "#D36A61"));
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
