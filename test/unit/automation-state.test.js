const test = require("node:test");
const assert = require("node:assert/strict");
const automation = require("../../intelligence/automation-state");

test("manual stop disables automation for the current block", () => {
  const state = automation.createAutomationState();
  automation.stopAutomation(state, "rap", 1000);

  assert.equal(state.enabled, false);
  assert.equal(state.manualStop, true);
  assert.equal(state.stoppedMode, "rap");
  assert.equal(state.stoppedAt, 1000);
});

test("next scheduled blend automatically reclaims automation", () => {
  const state = automation.createAutomationState();
  automation.stopAutomation(state, "rap", 1000);

  const resumed = automation.resumeForBlend(state, {
    outgoingMode: "rap",
    incomingMode: "rnb",
  }, 2000);

  assert.equal(resumed, true);
  assert.equal(state.enabled, true);
  assert.equal(state.manualStop, false);
  assert.equal(state.resumeReason, "scheduled_blend");
  assert.equal(state.resumedAt, 2000);
});

test("no blend means manual stop remains in force", () => {
  const state = automation.createAutomationState();
  automation.stopAutomation(state, "rap", 1000);

  assert.equal(automation.resumeForBlend(state, null, 2000), false);
  assert.equal(state.enabled, false);
  assert.equal(state.manualStop, true);
});

test("manual start resumes immediately", () => {
  const state = automation.createAutomationState();
  automation.stopAutomation(state, "rnb", 1000);
  automation.startAutomation(state, "manual", 1500);

  assert.equal(state.enabled, true);
  assert.equal(state.manualStop, false);
  assert.equal(state.resumeReason, "manual");
});
