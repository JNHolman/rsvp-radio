"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES, rgbToXy } = require("../../intelligence/ambient-light");
const { swatches, colorToPayload } = require("../../scripts/sample-hue-colors");

test("sampler enumerates current Auto anchor colors once, day then night", () => {
  const all = swatches();
  const expected = Object.entries(PALETTES).flatMap(([phase, palette]) =>
    palette.accents.map(hex => ({ phase, hex, bri: palette.brightness })));
  assert.equal(all.length, 11);
  assert.deepEqual(all.map(({ phase, hex, bri }) => ({ phase, hex, bri })), expected);
  assert.ok(all.every(sample => sample.hex !== undefined));
});

test("sampler maps colors to Hue xy without weakening raw palette swatches", () => {
  for (const s of swatches()) {
    const values = [1, 3, 5].map(i => parseInt(s.hex.slice(i, i + 2), 16));
    assert.deepEqual(colorToPayload(s), {
      xy: rgbToXy(values), bri: PALETTES[s.phase].brightness, durMs: 1000,
    });
  }
});
