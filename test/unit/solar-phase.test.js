"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getSunTimes, getSolarPhase } = require("../../shared/solar-phase");

const LAT = 38.2527;
const LON = -85.7585;
const originalTz = process.env.TZ;
process.env.TZ = "America/Kentucky/Louisville";
test.after(() => { if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz; });

test("summer sunrise and civil dusk follow Louisville's daylight", () => {
  const { sunrise, dusk } = getSunTimes(new Date(2026, 5, 21, 12), LAT, LON);
  assert.equal(sunrise.getHours(), 6);
  assert.equal(dusk.getHours(), 21);
  assert.ok(dusk > sunrise);
});

test("winter sunrise and civil dusk follow Louisville's daylight", () => {
  const { sunrise, dusk } = getSunTimes(new Date(2026, 11, 21, 12), LAT, LON);
  assert.equal(sunrise.getHours(), 7);
  assert.equal(dusk.getHours(), 17);
  assert.ok(dusk > sunrise);
});

test("sunrise switches from night to day at the solar boundary", () => {
  const { sunrise } = getSunTimes(new Date(2026, 9, 15, 12), LAT, LON);
  assert.equal(getSolarPhase(new Date(sunrise.getTime() - 1000), LAT, LON).phase, "night");
  assert.equal(getSolarPhase(sunrise, LAT, LON).phase, "day");
});

test("civil dusk switches from day to night at the solar boundary", () => {
  const { dusk } = getSunTimes(new Date(2026, 9, 15, 12), LAT, LON);
  assert.equal(getSolarPhase(new Date(dusk.getTime() - 1000), LAT, LON).phase, "day");
  assert.equal(getSolarPhase(dusk, LAT, LON).phase, "night");
});

test("next transition after dusk is the following sunrise", () => {
  const now = new Date(2026, 9, 15, 23);
  const phase = getSolarPhase(now, LAT, LON);
  assert.equal(phase.phase, "night");
  assert.ok(phase.nextTransition > now);
  assert.equal(phase.nextTransition.getDate(), 16);
});

test("rejects invalid coordinates", () => {
  assert.throws(() => getSunTimes(new Date(), 91, 0), RangeError);
  assert.throws(() => getSunTimes(new Date(), 0, NaN), RangeError);
});
