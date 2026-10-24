"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectExternalHueEdit, updateAutomatedWrite, createSettledHueObserver, FADE_SETTLE_MS } = require("../../hue/ownership");

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

test("RSVP's 180-second Hue fade is not misidentified as a phone app edit", () => {
  const start = 10000;
  const target = updateAutomatedWrite(null, {
    xy: [0.21, 0.17], bri: 76, transitiontime: 1800,
  }, start);
  assert.equal(target.fadeUntilMs, start + 180000);
  assert.deepEqual(target.xy, [0.21, 0.17]);
  const intermediate = { xy: [0.46, 0.40], bri: 109, colormode: "hs" };
  for (const ms of [30000, 60000, 90000, 120000, 150000, 180000, 184999]) {
    assert.equal(detectExternalHueEdit(intermediate, target, start + ms), false,
      "do not seize Hue during a legitimate fade at " + ms);
  }
  assert.equal(detectExternalHueEdit(intermediate, target, target.fadeUntilMs + FADE_SETTLE_MS), true,
    "genuine persistent mismatch still yields after fade settles");
});

test("reactive brightness writes during a fade cannot reset or shorten its grace period", () => {
  const start = 10000;
  const ambient = updateAutomatedWrite(null, {
    xy: [0.21, 0.17], bri: 76, transitiontime: 1800,
  }, start);
  const updated = updateAutomatedWrite(ambient, { bri: 81 }, start + 100000);
  assert.equal(updated.fadeUntilMs, ambient.fadeUntilMs);
  assert.deepEqual(updated.xy, ambient.xy);
  assert.equal(updated.bri, 81);
  assert.equal(detectExternalHueEdit({ xy: [0.39, 0.37], bri: 81, colormode: "xy" },
    updated, start + 110000), false);
});

test("native Hue changes after the fade remain detectable without a false lockout", () => {
  const target = updateAutomatedWrite(null, {
    xy: [0.21, 0.17], bri: 76, transitiontime: 1800,
  }, 10000);
  const settled = target.fadeUntilMs + FADE_SETTLE_MS + 1;
  assert.equal(detectExternalHueEdit(hue, target, settled), false);
  assert.equal(detectExternalHueEdit({ ...hue, bri: 130 }, target, settled), true);
  assert.equal(detectExternalHueEdit({ ...hue, colormode: "ct" }, target, settled), true);
  assert.equal(detectExternalHueEdit({ ...hue, xy: [0.44, 0.30] }, target, settled), true);
});

test("Hue adapter still honors physical power-off before any takeover detection", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const adapter = fs.readFileSync(path.join(__dirname, "../../hue-adapter.js"), "utf8");
  assert.match(adapter, /typeof on === "boolean" \? on : actionOn/);
  assert.match(adapter, /if \(isOn && ownership.external/);
  assert.match(adapter, /recordAutomatedWrite\(payload\)/);
});

test("October 23 regression: one 0.173 XY mismatch after a 180-second fade does not freeze Auto", () => {
  const tracker = createSettledHueObserver();
  const start = Date.parse("2026-10-24T00:13:00Z"); // Oct 23, 20:13 EDT
  tracker.recordWrite({ xy: [0.3655, 0.1522], bri: 76, transitiontime: 1800 }, start);
  const bridge = { xy: [0.1925, 0.1522], bri: 76, colormode: "xy" };
  assert.equal(tracker.inspect(bridge, start + 210000).external, false);
  const accepted = tracker.inspect(bridge, start + 240000);
  assert.equal(accepted.external, false);
  assert.equal(accepted.settled, true);
  assert.ok(Math.abs(accepted.requestedXyDelta - 0.173) < 0.0001);
  assert.equal(tracker.inspect(bridge, start + 270000).external, false);
});

test("actual Hue app color change after bridge settles still yields after confirmation", () => {
  const tracker = createSettledHueObserver(), start = 10000;
  tracker.recordWrite({ xy: [0.21, 0.17], bri: 76, transitiontime: 1800 }, start);
  const original = { xy: [0.20, 0.18], bri: 76, colormode: "xy" };
  tracker.inspect(original, start + 210000);
  tracker.inspect(original, start + 240000);
  const app = { ...original, xy: [0.45, 0.31] };
  assert.equal(tracker.inspect(app, start + 270000).external, false);
  assert.equal(tracker.inspect(app, start + 300000).reason, "confirmed_color_change");
});

test("late intermediate Hue readback does not cause takeover and next fade resets baseline", () => {
  const tracker = createSettledHueObserver(), start = 10000;
  const command = { xy: [0.21, 0.17], bri: 76, transitiontime: 1800 };
  tracker.recordWrite(command, start);
  const baseline = { xy: [0.21, 0.17], bri: 76, colormode: "xy" };
  tracker.inspect(baseline, start + 210000);
  tracker.inspect(baseline, start + 240000);
  assert.equal(tracker.inspect({ ...baseline, xy: [0.44, 0.30] }, start + 270000).external, false);
  assert.equal(tracker.inspect(baseline, start + 300000).external, false);
  tracker.recordWrite({ ...command, xy: [0.35, 0.20] }, start + 330000);
  assert.equal(tracker.inspect(baseline, start + 360000).external, false);
});

test("brightness and color temperature overrides still work", () => {
  for (const change of [
    { xy: [0.21, 0.17], bri: 130, colormode: "xy" },
    { xy: [0.21, 0.17], bri: 76, colormode: "ct" },
  ]) {
    const tracker = createSettledHueObserver(), start = 10000;
    tracker.recordWrite({ xy: [0.21, 0.17], bri: 76, transitiontime: 1800 }, start);
    assert.equal(tracker.inspect(change, start + 210000).external, true);
  }
});

test("explicit Auto release clears bridge calibration", () => {
  const fs = require("node:fs"), path = require("node:path");
  const adapter = fs.readFileSync(path.join(__dirname, "../../hue-adapter.js"), "utf8");
  assert.match(adapter, /hueObserver\.clear\(\)/);
  assert.match(adapter, /hueObserver\.recordWrite\(command\)/);
});
