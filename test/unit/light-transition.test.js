const test = require("node:test");
const assert = require("node:assert/strict");
const { planLightSync } = require("../../intelligence/light-transition");

function blend(offsetMin) {
  const boundaryMs = new Date(2026, 9, 4, 12, 0, 0, 0).getTime();
  return {
    active: true,
    boundaryMs,
    offsetMin,
    fromMode: "lofi",
    toMode: "wrap",
  };
}

test("lights start a full 20-minute transition at -10m", () => {
  const b = blend(-10);
  const p = planLightSync({
    nowMs: b.boundaryMs - 10 * 60 * 1000,
    scheduledMode: "lofi", blendState: b,
    lastScheduledMode: "lofi", lightsScene: "lofi", lastBlendKey: "",
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "transition");
  assert.equal(p.fromMode, "lofi");
  assert.equal(p.toMode, "wrap");
  assert.equal(p.durMs, 20 * 60 * 1000);
});


test("light blend starts from the room's actual seeded/manual scene", () => {
  const b = blend(-10);
  const p = planLightSync({
    nowMs: b.boundaryMs - 10 * 60 * 1000,
    scheduledMode: "lofi", blendState: b,
    lastScheduledMode: "lofi", lightsScene: "rap", lastBlendKey: "",
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "transition");
  assert.equal(p.fromMode, "rap");
  assert.equal(p.toMode, "wrap");
});

test("late pre-boundary detection still finishes at +10m", () => {
  const b = blend(-4);
  const p = planLightSync({
    nowMs: b.boundaryMs - 4 * 60 * 1000,
    scheduledMode: "lofi", blendState: b,
    lastScheduledMode: "lofi", lightsScene: "lofi", lastBlendKey: "",
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "transition");
  assert.equal(p.durMs, 14 * 60 * 1000);
});

test("exact boundary does not force incoming scene and cut fade in half", () => {
  const b = blend(0);
  const key = `lofi>wrap@${b.boundaryMs}`;
  const p = planLightSync({
    nowMs: b.boundaryMs,
    scheduledMode: "wrap", blendState: b,
    lastScheduledMode: "lofi", lightsScene: "wrap", lastBlendKey: key,
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "hold");
});

test("post-boundary restart resumes the remaining Hue fade", () => {
  const b = blend(3);
  const p = planLightSync({
    nowMs: b.boundaryMs + 3 * 60 * 1000,
    scheduledMode: "wrap", blendState: b,
    lastScheduledMode: "wrap", lightsScene: "wrap", lastBlendKey: "",
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "transition");
  assert.equal(p.toMode, "wrap");
  assert.equal(p.durMs, 7 * 60 * 1000);
});

test("successful post-boundary Hue fade is not reissued", () => {
  const b = blend(3);
  const key = `lofi>wrap@${b.boundaryMs}`;
  const p = planLightSync({
    nowMs: b.boundaryMs + 3 * 60 * 1000,
    scheduledMode: "wrap", blendState: b,
    lastScheduledMode: "wrap", lightsScene: "wrap", lastBlendKey: key,
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "hold");
});

test("lights-off state defers transition without marking it sent", () => {
  const b = blend(-8);
  const p = planLightSync({
    nowMs: b.boundaryMs - 8 * 60 * 1000,
    scheduledMode: "lofi", blendState: b,
    lastScheduledMode: "lofi", lightsScene: "lofi", lastBlendKey: "",
    lightsEnabled: false, blendHalfMin: 10,
  });
  assert.equal(p.kind, "defer");
  assert.equal(p.scene, "wrap");
});

test("after +10m the scheduler finalizes the incoming scene", () => {
  const p = planLightSync({
    nowMs: new Date(2026, 9, 4, 12, 10, 0, 0).getTime(),
    scheduledMode: "wrap", blendState: null,
    lastScheduledMode: "lofi", lightsScene: "wrap", lastBlendKey: "lofi>wrap@x",
    lightsEnabled: true, blendHalfMin: 10,
  });
  assert.equal(p.kind, "mode");
  assert.equal(p.mode, "wrap");
});

test("overnight rnb -> lofi blend drives lights toward lofi", () => {
  const timeblocks = require("../../shared/timeblocks");
  const now = new Date(2026, 9, 4, 3, 57, 0, 0);
  const b = timeblocks.getMusicBlendState(now);
  assert.ok(b);
  assert.equal(b.fromMode, "rnb");
  assert.equal(b.toMode, "lofi");

  const p = planLightSync({
    nowMs: now.getTime(),
    scheduledMode: "rnb",
    blendState: b,
    lastScheduledMode: "rnb",
    lightsScene: "rnb",
    lastBlendKey: "",
    lightsEnabled: true,
    blendHalfMin: timeblocks.MUSIC_BLEND_HALF_MIN,
  });
  assert.equal(p.kind, "transition");
  assert.equal(p.fromMode, "rnb");
  assert.equal(p.toMode, "lofi");
  assert.equal(p.durMs, 13 * 60 * 1000);
});
