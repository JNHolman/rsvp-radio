"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("audio analyzer telemetry remains but no server path sends Hue music signals", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../server.js"), "utf8");
  assert.match(source, /app\.post\("\/features"/);
  assert.match(source, /lastFeatures = \{ bass, energy, updatedAt: now \}/);
  assert.doesNotMatch(source, /_relayFeaturesToLights\(/);
  assert.doesNotMatch(source, /_forwardToLights\("signal"/);
  assert.match(source, /_forwardToLights\("ambient"/);
});

test("legacy Hue signal endpoint has no bridge writes or music reactive behavior", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../hue-adapter.js"), "utf8");
  const start = source.indexOf("async function applyReactiveSignal(_body)");
  const end = source.indexOf("async function handler(req, res)", start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /applied: false/);
  assert.match(handler, /reactivity_removed/);
  assert.doesNotMatch(handler, /hueRequest\(/);
  assert.match(source, /if \(url\.pathname === "\/signal"\)/);
});

test("music-independent hue retains physical power and app override protection", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../server.js"), "utf8");
  const region = source.slice(source.indexOf("async function _syncScheduledLights()"),
    source.indexOf("async function _forwardToLights(", source.indexOf("async function _syncScheduledLights()")));
  assert.match(region, /!physical\.on \|\| _externalHueHold/);
  assert.match(region, /lightingCadence\.lightingTarget\(/);
  assert.match(region, /_solarClock\.phase\(\)/);
});
