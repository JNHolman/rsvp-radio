"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PALETTES } = require("../../intelligence/ambient-light");
const { SCENES, ids } = require("../../intelligence/lighting-scenes");
const { lightingTarget, HOLD_BANDS } = require("../../intelligence/lighting-cadence");

const START = Date.UTC(2026, 9, 17, 12);
const CONTEXTS = ["auto", ...ids];

test("both solar palettes and all six club scenes have rich destinations", () => {
  assert.equal(ids.length, 6);
  for (const context of CONTEXTS) {
    for (const phase of ["day", "night"]) {
      const palette = context === "auto" ? PALETTES[phase].accents : SCENES[context][phase];
      assert.ok(palette.length >= 5, context + " " + phase);
      for (const color of palette) {
        const values = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
        const high = Math.max(...values), low = Math.min(...values);
        assert.ok(high - low >= 50, context + " " + phase + " washed-out swatch " + color);
      }
    }
  }
  assert.ok(PALETTES.night.accents.includes("#D36A61"), "retain salmon in Auto night");
});

test("same selection and timestamp produce the same color across restarts", () => {
  for (const context of CONTEXTS) {
    for (const phase of ["day", "night"]) {
      const selectedAt = context === "auto" ? null : START - 180000;
      const a = lightingTarget(context, phase, START, selectedAt);
      const b = lightingTarget(context, phase, START, selectedAt);
      assert.deepEqual(a, b);
      assert.equal(a.durMs, 180000);
      assert.ok(a.xy.every(n => n > 0 && n < 1));
      assert.ok(a.bri >= 1 && a.bri <= 254);
      const later = lightingTarget(context, phase, Math.min(START + 30000, a.nextChangeAt - 1000), selectedAt);
      assert.equal(a.key, later.key, context + " must hold rather than constantly rewrite");
    }
  }
});

test("all fourteen day-night contexts vary independently across hold lengths and colors", () => {
  assert.deepEqual(HOLD_BANDS, [[20, 40], [50, 80], [90, 120]]);
  for (const context of CONTEXTS) {
    for (const phase of ["day", "night"]) {
      const selectedAt = context === "auto" ? null : START - 180000;
      const seenColors = new Set(), durations = new Set(), bands = new Set();
      const names = [];
      let now = START, previous = null;
      for (let i = 0; i < 95; i++) {
        const chosen = lightingTarget(context, phase, now, selectedAt);
        assert.ok(chosen.nextChangeAt > now, context + " next event must be future");
        if (previous) {
          assert.notEqual(chosen.key, previous.key);
          assert.notEqual(chosen.color, previous.color,
            context + " " + phase + " should never visibly repeat the exact same color");
        }
        seenColors.add(chosen.color);
        names.push(chosen.color);
        const startMs = Number(chosen.key.slice(chosen.key.lastIndexOf(":") + 1));
        const duration = (chosen.nextChangeAt - startMs) / 60000;
        assert.ok(HOLD_BANDS.some(([min, max]) => duration >= min && duration <= max),
          context + " " + phase + " duration is not in any band: " + duration);
        bands.add(HOLD_BANDS.findIndex(([min, max]) => duration >= min && duration <= max));
        durations.add(duration);
        previous = chosen;
        now = chosen.nextChangeAt + 1;
      }
      assert.ok(seenColors.size >= 4, context + " " + phase + " visits too few colors");
      assert.deepEqual([...bands].sort(), [0, 1, 2],
        context + " " + phase + " must experience short, medium and long holds");
      assert.ok(durations.size >= 20, context + " " + phase + " hold times repeat too often");
      // Old code locked Auto day into blue/rose/gold for extended periods.
      let repeatedThree = 0;
      for (let i = 3; i < names.length; i++) {
        if (names[i] === names[i - 3]) repeatedThree++;
      }
      assert.ok(repeatedThree < 40, context + " " + phase + " fell into a 3-color cycle");
    }
  }
});

test("color and hold times survive process-level reload from the same source", () => {
  const p = require.resolve("../../intelligence/lighting-cadence");
  const current = require(p).lightingTarget("auto", "night", START + 400000);
  delete require.cache[p];
  const restored = require(p).lightingTarget("auto", "night", START + 400000);
  assert.deepEqual(restored, current);
});

test("live AUTO destinations span dynamic color families without ABAB backtracking", () => {
  for (const phase of ["day", "night"]) {
    let at = START;
    const colors = new Set(), families = new Set(), recent = [];
    const durations = new Set();
    for (let i = 0; i < 120; i++) {
      const chosen = lightingTarget("auto", phase, at);
      const beginning = Number(chosen.key.slice(chosen.key.lastIndexOf(":") + 1));
      const duration = (chosen.nextChangeAt - beginning) / 60000;
      assert.ok(HOLD_BANDS.some(([lo, hi]) => duration >= lo && duration <= hi));
      assert.equal(chosen.durMs, 180000);
      assert.match(chosen.color, /^#[0-9A-F]{6}$/);
      assert.ok(chosen.family, "dynamic AUTO colors must identify their family");
      if (recent.length) assert.notEqual(chosen.family, recent.at(-1));
      if (recent.length > 1) assert.notEqual(chosen.family, recent.at(-2));
      colors.add(chosen.color);
      families.add(chosen.family);
      durations.add(duration);
      recent.push(chosen.family);
      at = chosen.nextChangeAt + 1;
    }
    assert.ok(colors.size >= 100, phase + " should vary generated shades");
    assert.ok(families.size >= 9, phase + " should draw broadly across the spectrum");
    assert.ok(durations.size >= 20, phase + " should retain varied hold lengths");
  }
});

test("manual selection and solar phase overrides change context without waiting for a hold", () => {
  const before = lightingTarget("auto", "day", START);
  const after = lightingTarget("auto", "night", START);
  assert.notEqual(before.key, after.key);
  const club = lightingTarget("boom-boom-room", "night", START, START);
  assert.notEqual(club.key, after.key);
  const second = lightingTarget("club-crucial", "night", START, START);
  assert.notEqual(club.key, second.key);
  assert.throws(() => lightingTarget("not-a-club", "night", START), /invalid_lighting_selection/);
  assert.throws(() => lightingTarget("auto", "sunset", START), /invalid_solar_phase/);
});

test("server respects Hue ownership and sends only one color write per selected hold", () => {
  const server = fs.readFileSync(path.join(__dirname, "../../server.js"), "utf8");
  const slice = server.slice(server.indexOf("async function _syncScheduledLights()"),
    server.indexOf("async function _forwardToLights(", server.indexOf("async function _syncScheduledLights()")));
  assert.match(slice, /_readHuePower\(\)/);
  assert.match(slice, /!physical\.on \|\| _externalHueHold/);
  assert.match(slice, /lightingCadence\.lightingTarget\(/);
  assert.match(slice, /_ambientLast\?\.key === desired\.key/);
  assert.doesNotMatch(slice, /ambientLight\.approachAmbient\(/);
  assert.match(slice, /durMs: desired\.durMs/);
  assert.match(server, /_solarClock\.phase\(\)/);
});
