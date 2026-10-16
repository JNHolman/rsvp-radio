"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES, ambientTarget, approachAmbient } = require("../../intelligence/ambient-light");

test("permanent rich colors retain low-brightness ambience", () => {
  assert.deepEqual(PALETTES.day.accents, ["#D9A441", "#C77943", "#D97965", "#C86480", "#B777A4"]);
  assert.deepEqual(PALETTES.night.accents, ["#315BB5", "#72318D", "#3967BE", "#CF6A5C", "#2C359C", "#A31E8B"]);
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

test("night ambience reaches distinct blue and warm colors within every half-hour", () => {
  const slot = 11 * 60 * 1000;
  // Even a poorly-timed 30-minute observation must not sit in one pink family.
  for (let start = 0; start < PALETTES.night.accents.length; start++) {
    const samples = Array.from({ length: 4 }, (_, i) =>
      ambientTarget("night", (start + i + 6 * 1000) * slot).xy[0]);
    assert.ok(Math.max(...samples) - Math.min(...samples) > 0.15,
      "night colors should cover visibly different families, start index " + start);
  }
});

test("daytime ambient algorithm retains its approved palette and behavior", () => {
  const now = Date.UTC(2026, 9, 16, 16, 35);
  const target = ambientTarget("day", now);
  assert.ok(target.xy[0] > 0.25 && target.xy[1] > 0.2);
});
