"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createReactiveLighting } = require("../../hue/reactive-lighting");

test("reactive Hue brightness preserves scene color and only lifts brightness", () => {
  const r = createReactiveLighting({ minIntervalMs: 1000, range: 40 });
  r.setBaseBrightness(140);
  const plan = r.plan({ bass: 1, energy: 0.5, nowMs: 1000 });
  assert.equal(plan.kind, "apply");
  assert.ok(plan.brightness > 140 && plan.brightness <= 180);
});

test("reactive Hue updates are suppressed during a long scene transition", () => {
  const r = createReactiveLighting({ minIntervalMs: 1000, range: 40 });
  r.setBaseBrightness(140);
  r.onSceneTransition(1000, 20 * 60 * 1000);
  const plan = r.plan({ bass: 1, energy: 1, nowMs: 5000 });
  assert.deepEqual(plan, { kind: "hold", reason: "scene_transition" });
});

test("reactive Hue path rate-limits group writes", () => {
  const r = createReactiveLighting({ minIntervalMs: 2000, range: 40 });
  r.setBaseBrightness(140);
  assert.equal(r.plan({ bass: 1, energy: 1, nowMs: 1000 }).kind, "apply");
  assert.equal(r.plan({ bass: 0.2, energy: 0.2, nowMs: 1500 }).reason, "rate_limited");
});

test("zero energy decays brightness back toward the scene baseline", () => {
  const r = createReactiveLighting({ minIntervalMs: 1, range: 40 });
  r.setBaseBrightness(140);
  let now = 1;
  const high = r.plan({ bass: 1, energy: 1, nowMs: now++ });
  assert.equal(high.kind, "apply");
  let last = high.brightness;
  for (let i = 0; i < 20; i += 1) {
    const p = r.plan({ bass: 0, energy: 0, nowMs: now++ });
    if (p.kind === "apply") last = p.brightness;
  }
  assert.ok(last <= high.brightness);
  assert.ok(last >= 140);
});

test("reactive Hue does nothing while lights are off", () => {
  const r = createReactiveLighting();
  r.setBaseBrightness(140);
  r.onPower(false);
  assert.deepEqual(r.plan({ bass: 1, energy: 1, nowMs: 1000 }), { kind: "hold", reason: "power_off" });
});

test("exact silence returns reactive brightness to the active scene baseline", () => {
  const r = createReactiveLighting({ minIntervalMs: 1800, range: 36 });
  r.setBaseBrightness(120);
  const raised = r.plan({ bass: 1, energy: 1, nowMs: 2000 });
  assert.equal(raised.kind, "apply");
  assert.ok(raised.brightness > 120);

  const quiet = r.plan({ bass: 0, energy: 0, nowMs: 4000 });
  assert.equal(quiet.kind, "apply");
  assert.equal(quiet.brightness, 120);
});