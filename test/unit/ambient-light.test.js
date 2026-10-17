"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES, ambientTarget, approachAmbient, hueDistance } = require("../../intelligence/ambient-light");

test("rich day/night palettes stay saturated and include blue and salmon at night", () => {
  assert.deepEqual(PALETTES.day.accents, ["#D9A441", "#C77943", "#D97965", "#C86480", "#B777A4"]);
  assert.ok(PALETTES.night.accents.includes("#3045C5"));
  assert.ok(PALETTES.night.accents.includes("#D56A61"));
  assert.equal(PALETTES.day.brightness, 114);
  assert.equal(PALETTES.night.brightness, 76);
  for (const pal of Object.values(PALETTES)) {
    for (const hex of [pal.base, ...pal.accents]) {
      const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      assert.ok(Math.max(...rgb) - Math.min(...rgb) >= 50, hex + " must not look nearly white");
    }
  }
});

test("a selected color remains unchanged while its hold is active", () => {
  for (const phase of ["day", "night"]) {
    const now = Date.UTC(2026, 9, 17, 10);
    const first = ambientTarget(phase, now);
    const later = ambientTarget(phase, Math.min(now + 60000, first.nextChangeAt - 1000));
    assert.deepEqual(first.xy, later.xy);
    assert.equal(first.key, later.key);
    assert.equal(first.durMs, 180000);
  }
});

test("irregular holds produce contrasting colors instead of near-neighbor changes", () => {
  for (const phase of ["day", "night"]) {
    const colors = new Set();
    const intervals = new Set();
    let now = Date.UTC(2026, 9, 17, 12);
    let last = null;
    let beforeLast = null;
    for (let i = 0; i < 140; i++) {
      const next = ambientTarget(phase, now, last?.color || null, beforeLast?.color || null);
      assert.equal(next.phase, phase);
      assert.equal(next.durMs, 180000);
      assert.ok(next.xy.every(n => n > 0 && n < 1));
      assert.ok(next.bri > 0 && next.bri <= 254);
      if (last) {
        assert.notEqual(next.key, last.key);
        assert.ok(hueDistance(next.color, last.color) >= 50, `${phase}: ${last.color} -> ${next.color}`);
      }
      colors.add(next.color);
      const hold = (next.nextChangeAt - now) / 60000;
      assert.ok(hold >= 0 && hold <= 120);
      if (hold >= 20) intervals.add(Math.round(hold));
      beforeLast = last;
      last = next;
      now = next.nextChangeAt + 10;
    }
    assert.ok(colors.size >= 5, phase + " should visit several colors");
    assert.ok(intervals.size >= 15, phase + " should vary hold lengths");
  }
});

test("LOFI, Lounge, Rap and R&B all change between distinct colors", () => {
  for (const mode of ["lofi", "lounge", "rap", "rnb"]) {
    const colors = new Set();
    let now = Date.UTC(2026, 9, 17, 20);
    let previous = null;
    let older = null;
    for (let i = 0; i < 90; i++) {
      const next = ambientTarget(mode, now, previous?.color || null, older?.color || null);
      assert.equal(next.durMs, 180000);
      assert.ok(next.bri >= 1 && next.bri <= 254);
      if (previous) {
        assert.notEqual(next.key, previous.key);
        assert.ok(hueDistance(previous.color, next.color) >= 50,
          `${mode}: ${previous.color} -> ${next.color}`);
      }
      colors.add(next.color);
      older = previous;
      previous = next;
      now = next.nextChangeAt + 10;
    }
    assert.ok(colors.size >= 5, mode + " should visit at least five distinct colors");
  }
});

test("solar handoffs use slow Hue fades and retain a legacy step-capping helper", () => {
  const now = Date.UTC(2026, 9, 17, 17);
  const day = ambientTarget("day", now);
  const night = ambientTarget("night", now, day.color);
  assert.notEqual(day.key, night.key);
  assert.equal(night.durMs, 180000);
  const step = approachAmbient(day, night);
  assert.ok(Math.hypot(step.xy[0] - day.xy[0], step.xy[1] - day.xy[1]) <= 0.027);
  assert.ok(Math.abs(step.bri - day.bri) <= 6);
  assert.deepEqual(approachAmbient(null, night), night);
  assert.throws(() => ambientTarget("unknown", now), /invalid_ambient_phase/);
});
