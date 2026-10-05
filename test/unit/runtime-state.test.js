const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore, normalize } = require("../../intelligence/runtime-state");

test("runtime state round-trips TV, manual control and Hue intent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-runtime-state-"));
  const store = createStore(path.join(dir, "runtime.json"));
  assert.equal(store.save({
    plexampPausedByRsvp: true,
    wasVideoMode: true,
    lightsEnabled: false,
    lightsScene: "rnb",
    manualMode: { mode: "rnb", expiresAt: Date.now() + 60000 },
    manualLights: { mode: "lounge", expiresAt: Date.now() + 45000 },
    automation: { enabled: false, manualStop: true, stoppedMode: "rap", stoppedAt: 99 },
    videoMode: {
      active: true,
      playlistKey: "123",
      playlistTitle: "Rap Videos",
      clips: [{ ratingKey: "10", title: "A" }, { ratingKey: "11", title: "B" }],
      index: 1,
      mode: "rap",
      startedAt: 99,
      paused: true,
    },
    videoResumeIndex: { "123": 1, "456": 3 },
  }), true);

  const loaded = store.load();
  assert.equal(loaded.plexampPausedByRsvp, true);
  assert.equal(loaded.lightsEnabled, false);
  assert.equal(loaded.lightsScene, "rnb");
  assert.equal(loaded.manualMode.mode, "rnb");
  assert.equal(loaded.manualLights.mode, "lounge");
  assert.equal(loaded.automation.manualStop, true);
  assert.equal(loaded.automation.enabled, false);
  assert.equal(loaded.videoMode.playlistKey, "123");
  assert.equal(loaded.videoMode.index, 1);
  assert.equal(loaded.videoMode.paused, true);
  assert.deepEqual(loaded.videoResumeIndex, { "123": 1, "456": 3 });
});

test("runtime state drops malformed persisted control/video data safely", () => {
  const n = normalize({
    plexampPausedByRsvp: "yes",
    lightsEnabled: true,
    lightsScene: "not-a-mode",
    seedMode: { mode: "bad", expiresAt: "never" },
    manualMode: { mode: "bad", expiresAt: "never" },
    manualLights: { mode: "bad", expiresAt: "never" },
    automation: { enabled: true, manualStop: true, stoppedMode: "bad", stoppedAt: -10 },
    videoMode: { active: true, playlistKey: "not-numeric", clips: [{ ratingKey: "x" }] },
    videoResumeIndex: { nope: -1, "42": 2 },
  });
  assert.equal(n.lightsScene, "");
  assert.equal(n.manualMode, null);
  assert.equal(n.manualLights, null);
  assert.deepEqual(n.automation, { enabled: false, manualStop: true, stoppedMode: null, stoppedAt: 0 });
  assert.equal(n.videoMode, null);
  assert.deepEqual(n.videoResumeIndex, { "42": 2 });
});

test("runtime state migrates legacy wrap mode to lounge", () => {
  const expiresAt = Date.now() + 60000;
  const n = normalize({
    lightsScene: "wrap",
    seedMode: { mode: "wrap", expiresAt },
    manualMode: { mode: "wrap", expiresAt },
    manualLights: { mode: "wrap", expiresAt },
    automation: { manualStop: true, stoppedMode: "wrap", stoppedAt: 1 },
  });
  assert.equal(n.version, 5);
  assert.equal(n.lightsScene, "lounge");
  assert.equal(n.seedMode.mode, "lounge");
  assert.equal(n.manualMode.mode, "lounge");
  assert.equal(n.manualLights.mode, "lounge");
  assert.equal(n.automation.stoppedMode, "lounge");
});
