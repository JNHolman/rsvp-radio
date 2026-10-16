"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectExternalHueEdit } = require("../../hue/ownership");

const expected = { xy: [0.21, 0.17], bri: 76, writtenAt: 10000 };
const hue = { xy: [0.21, 0.17], bri: 76, colormode: "xy" };

test("native Hue app brightness-only changes yield control", () => {
  assert.equal(detectExternalHueEdit({ ...hue, bri: 30 }, expected, 12000), true);
  assert.equal(detectExternalHueEdit({ ...hue, bri: 125 }, expected, 12000), true);
});

test("native Hue app color and white-temperature changes yield control", () => {
  assert.equal(detectExternalHueEdit({ ...hue, xy: [0.45, 0.3] }, expected, 12000), true);
  assert.equal(detectExternalHueEdit({ ...hue, colormode: "ct" }, expected, 12000), true);
});

test("Hue reports RSVP's own color and reactive brightness targets as controlled", () => {
  const recentlyReactive = { xy: [0.21, 0.17], bri: 83, writtenAt: 10000 };
  assert.equal(detectExternalHueEdit({ ...hue, bri: 83 }, recentlyReactive, 12000), false);
  assert.equal(detectExternalHueEdit({ ...hue, bri: 84 }, recentlyReactive, 12000), false);
  assert.equal(detectExternalHueEdit({ ...hue, bri: 81 }, recentlyReactive, 12000), false);
});

test("ignore incomplete or very recent Hue group values during fades", () => {
  assert.equal(detectExternalHueEdit({ ...hue, bri: 0 }, expected, 11000), false);
  assert.equal(detectExternalHueEdit({ ...hue, xy: [0.5, 0.5] }, expected, 11500), false);
  assert.equal(detectExternalHueEdit({ xy: null, bri: 76 }, expected, 12000), false);
  assert.equal(detectExternalHueEdit(null, expected, 12000), false);
  assert.equal(detectExternalHueEdit(hue, null, 12000), false);
});

test("no false takeover before RSVP writes a valid tracked target", () => {
  assert.equal(detectExternalHueEdit(hue, { xy: null, bri: null, writtenAt: 0 }, 12000), false);
});
