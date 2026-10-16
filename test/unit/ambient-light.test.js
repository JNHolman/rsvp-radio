"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PALETTES, SLOT_MS, ambientTarget, approachAmbient } = require("../../intelligence/ambient-light");

test("daylight Auto balances artwork sky blue and gold with warm supporting colors", () => {
  const p = PALETTES.day;
  assert.deepEqual(p.accents, ["#287EC2", "#D69A37", "#B96A38", "#D47B65", "#B96C91"]);
  assert.equal(p.sequence.length, 20);
  assert.deepEqual(p.accents.map((_, i) => p.sequence.filter(n => n === i).length), [7, 7, 3, 2, 1]);
  assert.equal(p.brightness, 114);
  const blue = ambientTarget("day", 0.5 * SLOT_MS).xy;
  const gold = ambientTarget("day", 6.5 * SLOT_MS).xy;
  assert.ok(blue[0] < 0.23, "blue must be unmistakably blue: " + blue);
  assert.ok(gold[0] > 0.43, "gold must be unmistakably warm: " + gold);
});

test("nighttime Auto is blue/violet led, with limited magenta and salmon", () => {
  const p = PALETTES.night;
  assert.deepEqual(p.accents, ["#264CC0", "#352B91", "#6625A9", "#B52D8B", "#D36A61", "#3576C8"]);
  assert.equal(p.sequence.length, 20);
  assert.equal(p.sequence.filter(n => n === 3).length, 1);
  assert.equal(p.sequence.filter(n => n === 4).length, 1);
  assert.ok(p.sequence.filter(n => ![3, 4].includes(n)).length >= 18);
  assert.equal(p.brightness, 76);
});

test("both solar palettes have valid colors, with day brighter than night", () => {
  const now = Date.UTC(2026, 9, 16, 20);
  const day = ambientTarget("day", now), night = ambientTarget("night", now);
  assert.notDeepEqual(day.xy, night.xy);
  assert.ok(day.bri > night.bri);
  for (const t of [day, night]) {
    assert.ok(t.xy.every(n => n > 0 && n < 1));
    assert.ok(t.bri >= 1 && t.bri <= 254);
  }
});

test("hue gradients avoid near-white/neutral crossfades, including physical approach steps", () => {
  for (const phase of ["day", "night"]) {
    const n = PALETTES[phase].sequence.length;
    let previous = null;
    let closest = Infinity;
    for (let t = 0; t < n * SLOT_MS; t += 30000) {
      const desired = ambientTarget(phase, t);
      const actual = approachAmbient(previous, desired);
      for (const pos of [desired.xy, actual.xy]) {
        const distance = Math.hypot(pos[0] - 0.3127, pos[1] - 0.329);
        closest = Math.min(distance, closest);
        assert.ok(distance > 0.1, phase + " crossfade washed out near white: " + pos);
      }
      if (previous) assert.ok(Math.hypot(previous.xy[0] - actual.xy[0], previous.xy[1] - actual.xy[1]) <= 0.027);
      previous = actual;
    }
    assert.ok(closest > 0.10);
  }
});

test("palette movement is smooth through all slot boundaries", () => {
  for (const phase of ["day", "night"]) {
    for (let slot = 1; slot <= PALETTES[phase].sequence.length; slot++) {
      const a = ambientTarget(phase, slot * SLOT_MS - 1), b = ambientTarget(phase, slot * SLOT_MS + 1);
      assert.ok(Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) < 0.001);
    }
    const xy = new Set(Array.from({ length: 50 }, (_, i) => ambientTarget(phase, SLOT_MS * 201 + i * 60000).xy.join(",")));
    assert.ok(xy.size > 8, phase + " must move over time");
  }
});

test("sunrise and sunset still cap each incremental transition", () => {
  const day = ambientTarget("day", 1e9);
  const night = ambientTarget("night", 1e9);
  const step = approachAmbient(day, night);
  assert.ok(Math.hypot(step.xy[0] - day.xy[0], step.xy[1] - day.xy[1]) <= 0.027);
  assert.ok(Math.abs(step.bri - day.bri) <= 6);
  assert.deepEqual(approachAmbient(null, night), night);
  assert.throws(() => ambientTarget("unknown", 1000), /invalid_ambient_phase/);
});
