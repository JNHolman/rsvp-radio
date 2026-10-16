"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES } = require("../../intelligence/ambient-light");
const { swatches, colorToPayload, RICH_CANDIDATE } = require("../../scripts/sample-hue-colors");

test("richer trial leaves original 15 swatches and live palettes untouched", () => {
  const original = swatches();
  const rich = swatches({ rich: true });
  assert.equal(original.length, 15);
  assert.equal(rich.length, 14);
  assert.equal(PALETTES.day.base, "#F0A86F");
  assert.equal(PALETTES.night.base, "#8135B0");
  assert.equal(original[0].hex, "#F0A86F");
  assert.equal(rich[0].hex, "#E49B42");
  assert.notDeepEqual(original, rich);
});

test("richer trial includes daytime gold/copper/rose and the retained night salmon", () => {
  const rich = swatches({ rich: true });
  const day = rich.filter(s => s.phase === "day");
  const night = rich.filter(s => s.phase === "night");
  assert.deepEqual(day.map(s => s.hex),
    [RICH_CANDIDATE.day.base, ...RICH_CANDIDATE.day.accents]);
  assert.deepEqual(night.map(s => s.hex),
    [RICH_CANDIDATE.night.base, ...RICH_CANDIDATE.night.accents]);
  assert.ok(night.some(s => s.hex === "#D56A61"));
  assert.ok(rich.every(s => s.bri === PALETTES[s.phase].brightness));
  assert.ok(rich.every(s => {
    const payload = colorToPayload(s);
    return payload.durMs === 1000 && payload.bri === s.bri &&
      payload.xy.length === 2 && payload.xy.every(x => x > 0 && x < 1);
  }));
});
