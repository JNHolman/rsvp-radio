"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSolarClock } = require("../../shared/solar-clock");

test("Hue reads a cached phase and wakes at sunrise, not every 30 seconds", () => {
  const sunrise = Date.parse("2026-10-16T12:00:00Z");
  const dusk = Date.parse("2026-10-16T23:30:00Z");
  let timestamp = sunrise - 20 * 60000;
  let calculations = 0;
  let scheduled;
  const changed = [];
  const clock = createSolarClock({
    latitude: 38.25,
    longitude: -85.76,
    now: () => new Date(timestamp),
    getSolarPhase: () => {
      calculations++;
      const day = timestamp >= sunrise && timestamp < dusk;
      return {
        phase: day ? "day" : "night",
        sunrise: new Date(sunrise),
        dusk: new Date(dusk),
        nextTransition: new Date(day ? dusk : sunrise),
      };
    },
    setTimer: (fn, delay) => { scheduled = { fn, delay }; return 1; },
    clearTimer: () => { scheduled = null; },
    onPhaseChange: phase => changed.push(phase),
  });

  clock.start();
  assert.equal(clock.phase(), "night");
  assert.equal(scheduled.delay, 20 * 60000);
  for (let i = 0; i < 50; i++) clock.phase();
  assert.equal(calculations, 1, "30-second drift updates do not recalculate sun times");

  timestamp = sunrise;
  scheduled.fn();
  assert.equal(clock.phase(), "day");
  assert.deepEqual(changed, ["day"]);
  assert.equal(calculations, 2);
  assert.equal(scheduled.delay, 3600000, "hourly safety until next edge");
  clock.stop();
  assert.equal(scheduled, null);
});

test("hourly safety catches clock correction, without busy polling", () => {
  const dusk = Date.parse("2026-10-16T23:30:00Z");
  let timestamp = dusk - 3 * 3600000;
  let scheduled;
  let calculations = 0;
  const changed = [];
  const clock = createSolarClock({
    latitude: 38,
    longitude: -86,
    now: () => new Date(timestamp),
    getSolarPhase: () => {
      calculations++;
      const phase = timestamp < dusk ? "day" : "night";
      return { phase, nextTransition: new Date(timestamp < dusk ? dusk : dusk + 86400000) };
    },
    setTimer: (fn, delay) => { scheduled = { fn, delay }; return 10; },
    clearTimer: () => { scheduled = null; },
    onPhaseChange: phase => changed.push(phase),
  });
  clock.start();
  assert.equal(scheduled.delay, 3600000);
  timestamp = dusk + 2000; // Pi clock advances unexpectedly
  scheduled.fn();
  assert.equal(clock.phase(), "night");
  assert.deepEqual(changed, ["night"]);
  assert.equal(calculations, 2);
  clock.stop();
});

test("unavailable solar data retries without changing last confirmed phase", () => {
  let scheduled;
  let broken = false;
  const errors = [];
  const clock = createSolarClock({
    latitude: 38,
    longitude: -86,
    now: () => new Date("2026-10-16T10:00:00Z"),
    getSolarPhase: () => broken
      ? { phase: null, nextTransition: null }
      : { phase: "night", nextTransition: new Date("2026-10-16T11:00:00Z") },
    setTimer: (fn, delay) => { scheduled = { fn, delay }; return 9; },
    clearTimer: () => { scheduled = null; },
    onError: e => errors.push(e.message),
  });
  clock.start();
  broken = true;
  scheduled.fn();
  assert.equal(clock.phase(), "night");
  assert.equal(scheduled.delay, 60000);
  assert.deepEqual(errors, ["solar_phase_unavailable"]);
  clock.stop();
});

test("server uses cached solar phase inside Hue tick, not a solar calculation", () => {
  const server = fs.readFileSync(path.resolve(__dirname, "../../server.js"), "utf8");
  const tick = server.match(/async function _syncScheduledLights\(\)\s*\{([\s\S]*?)\n\}\n\nasync function _forwardToLights/);
  assert.ok(tick);
  assert.match(tick[1], /_solarClock\.phase\(\)/);
  assert.doesNotMatch(tick[1], /getSolarPhase\(/);
  assert.match(server, /_solarClock\.start\(\)/);
  assert.match(server, /_solarClock\.stop\(\)/);
  assert.match(server, /_lightsIntervalHandle = setInterval\(/);
});
