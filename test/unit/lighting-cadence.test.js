"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PALETTES } = require("../../intelligence/ambient-light");
const { SCENES, ids } = require("../../intelligence/lighting-scenes");
const { lightingTarget, hueDistance } = require("../../intelligence/lighting-cadence");

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

test("color changes are irregular and meaningfully contrasting in all eight palettes", () => {
  for (const context of CONTEXTS) {
    for (const phase of ["day", "night"]) {
      const selectedAt = context === "auto" ? null : START - 180000;
      const colors = new Set(), durations = new Set();
      let now = START, previous = null;
      for (let i = 0; i < 95; i++) {
        const chosen = lightingTarget(context, phase, now, selectedAt);
        assert.ok(chosen.nextChangeAt > now, context + " next event must be in future");
        if (previous) {
          assert.notEqual(chosen.key, previous.key);
          assert.ok(hueDistance(chosen.color, previous.color) >= 60,
            context + " " + phase + " repeated similar color: " + previous.color + " → " + chosen.color);
        }
        colors.add(chosen.color);
        const startMs = Number(chosen.key.slice(chosen.key.lastIndexOf(":") + 1));
        const durationMin = (chosen.nextChangeAt - startMs) / 60000;
        assert.ok(durationMin >= 0 && durationMin <= 120);
        if (durationMin >= 20) durations.add(Math.round(durationMin));
        previous = chosen;
        now = chosen.nextChangeAt + 1;
      }
      assert.ok(colors.size >= 4, context + " " + phase + " needs broad colors");
      assert.ok(durations.size >= 12, context + " " + phase + " needs variable timing");
    }
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
