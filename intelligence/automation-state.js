"use strict";

/**
 * intelligence/automation-state.js
 *
 * Runtime ownership state for RSVP Radio programming.
 *
 * A manual stop suppresses automatic lane steering for the remainder of the
 * current block. The next scheduled blend automatically reclaims control.
 */

function createAutomationState() {
  return {
    enabled: true,
    manualStop: false,
    stoppedAt: 0,
    stoppedMode: null,
    resumedAt: 0,
    resumeReason: "boot",
  };
}

function stopAutomation(state, mode, now = Date.now()) {
  state.enabled = false;
  state.manualStop = true;
  state.stoppedAt = now;
  state.stoppedMode = mode || null;
  return state;
}

function startAutomation(state, reason = "manual", now = Date.now()) {
  state.enabled = true;
  state.manualStop = false;
  state.resumedAt = now;
  state.resumeReason = reason;
  state.stoppedMode = null;
  return state;
}

function resumeForBlend(state, blend, now = Date.now()) {
  if (!state.manualStop || !blend) return false;
  startAutomation(state, "scheduled_blend", now);
  return true;
}

function snapshot(state) {
  return {
    enabled: Boolean(state.enabled),
    manualStop: Boolean(state.manualStop),
    stoppedAt: Number(state.stoppedAt) || 0,
    stoppedMode: state.stoppedMode || null,
    resumedAt: Number(state.resumedAt) || 0,
    resumeReason: state.resumeReason || "",
  };
}

module.exports = {
  createAutomationState,
  stopAutomation,
  startAutomation,
  resumeForBlend,
  snapshot,
};
