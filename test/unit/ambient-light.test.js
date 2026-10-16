"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES, ambientTarget, approachAmbient } = require("../../intelligence/ambient-light");

test("permanent rich colors retain low-brightness ambience", () => {
  assert.deepEqual(PALETTES.day.accents, ["#D9A441", "#C77943", "#D97965", "#C86480", "#B777A4"]);
  assert.deepEqual(PALETTES.night.accents, ["#2261D1", "#0B988F", "#1B3EA9", "#107B82", "#5932B3", "#137AB8"]);
  assert.equal(PALETTES.day.brightness, 114);
  assert.equal(PALETTES.night.brightness, 76);
});

test("solar palettes are distinct and have restrained brightness", () => {
  const now = Date.UTC(2026, 9, 15, 20);
  const day = ambientTarget("day", now);
  const night = ambientTarget("night", now);
  assert.notDeepEqual(day.xy, night.xy);
  assert.ok(day.bri > night.bri);
  for (const t of [day, night]) {
    assert.ok(t.xy.every(n => n > 0 && n < 1));
    assert.ok(t.bri >= 1 && t.bri <= 254);
  }
});

test("palette movement is continuous at accent boundaries, without static colors", () => {
  const slot = 11 * 60 * 1000;
  for (const phase of ["day", "night"]) {
    const a = ambientTarget(phase, slot * 200 - 1);
    const b = ambientTarget(phase, slot * 200 + 1);
    assert.ok(Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) < 0.001);
    const xy = new Set(Array.from({ length: 50 }, (_, i) =>
      ambientTarget(phase, slot * 201 + i * 60000).xy.join(",")));
    assert.ok(xy.size > 8, phase + " must drift rather than hold one color");
  }
});

test("solar phase changes cannot cause sudden color or brightness jumps", () => {
  const day = ambientTarget("day", 1e9);
  const night = ambientTarget("night", 1e9);
  const step = approachAmbient(day, night);
  assert.ok(Math.hypot(step.xy[0] - day.xy[0], step.xy[1] - day.xy[1]) <= 0.027);
  assert.ok(Math.abs(step.bri - day.bri) <= 6);
  assert.deepEqual(approachAmbient(null, night), night);
  assert.throws(() => ambientTarget("unknown", 1000), /invalid_ambient_phase/);
});

test("night Auto never drifts into pink or washed-out white across the full cycle", () => {
  const slot = 11 * 60 * 1000;
  const origin = slot * 6000;
  // Check the middle of all fades, not merely the palette endpoints.
  for (let second = 0; second <= 6 * 11 * 60; second += 20) {
    const { xy } = ambientTarget("night", origin + second * 1000);
    assert.ok(xy[0] < 0.28, "pink/rose hue reappeared at second " + second + ": " + xy);
    assert.ok(Math.hypot(xy[0] - 0.3127, xy[1] - 0.329) > 0.12,
      "near-white chromaticity at second " + second + ": " + xy);
  }
});

test("night Auto visits contrasting cool color families throughout the cycle", () => {
  const slot = 11 * 60 * 1000;
  for (let start = 0; start < PALETTES.night.accents.length; start++) {
    const samples = Array.from({ length: 4 }, (_, i) =>
      ambientTarget("night", (start + i + 6000) * slot).xy[1]);
    assert.ok(Math.max(...samples) - Math.min(...samples) > 0.14,
      "night colors must vary between blue and teal, start " + start);
  }
});

test("daytime ambient algorithm retains its approved palette and behavior", () => {
  const now = Date.UTC(2026, 9, 16, 16, 35);
  const target = ambientTarget("day", now);
  assert.ok(target.xy[0] > 0.25 && target.xy[1] > 0.2);
});
