"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const blendPolicy = require("../../intelligence/blend-policy");

const base = {
  active: true,
  fromMode: "lofi",
  toMode: "lounge",
};

test("chooseMode honors 80/20 threshold", () => {
  const state = { ...base, oldPct: 80, newPct: 20 };
  assert.equal(blendPolicy.chooseMode(state, () => 0.79), "lofi");
  assert.equal(blendPolicy.chooseMode(state, () => 0.80), "lounge");
});

test("chooseMode honors 60/40 threshold", () => {
  const state = { ...base, oldPct: 60, newPct: 40 };
  assert.equal(blendPolicy.chooseMode(state, () => 0.59), "lofi");
  assert.equal(blendPolicy.chooseMode(state, () => 0.60), "lounge");
});

test("chooseMode honors 40/60 threshold", () => {
  const state = { ...base, oldPct: 40, newPct: 60 };
  assert.equal(blendPolicy.chooseMode(state, () => 0.39), "lofi");
  assert.equal(blendPolicy.chooseMode(state, () => 0.40), "lounge");
});

test("chooseMode honors 20/80 threshold", () => {
  const state = { ...base, oldPct: 20, newPct: 80 };
  assert.equal(blendPolicy.chooseMode(state, () => 0.19), "lofi");
  assert.equal(blendPolicy.chooseMode(state, () => 0.20), "lounge");
});

test("chooseMode returns empty for inactive or malformed state", () => {
  assert.equal(blendPolicy.chooseMode(null, () => 0), "");
  assert.equal(blendPolicy.chooseMode({ ...base, active: false, oldPct: 80, newPct: 20 }, () => 0), "");
  assert.equal(blendPolicy.chooseMode({ ...base, oldPct: -1, newPct: 0 }, () => 0), "");
});