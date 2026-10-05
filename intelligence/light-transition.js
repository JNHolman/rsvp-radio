"use strict";

/**
 * Pure scheduling policy for RSVP lighting handoffs.
 *
 * Music uses four weighted source-selection stages. Lights use the same
 * 20-minute window as one continuous color fade: start at -10m, finish +10m.
 * This planner deliberately holds through the schedule boundary so the server
 * cannot cut the fade in half by forcing the incoming scene at 0m.
 */
function planLightSync({
  nowMs,
  scheduledMode,
  blendState,
  lastScheduledMode,
  lightsScene,
  lastBlendKey,
  lightsEnabled,
  blendHalfMin = 10,
}) {
  if (blendState && blendState.active) {
    const key = `${blendState.fromMode}>${blendState.toMode}@${blendState.boundaryMs}`;

    if (lastBlendKey !== key) {
      const transitionEndMs = blendState.boundaryMs + blendHalfMin * 60 * 1000;
      const remainingMs = Math.max(1000, transitionEndMs - nowMs);
      return {
        kind: lightsEnabled ? "transition" : "defer",
        key,
        scene: blendState.toMode,
        // Transition from whatever Hue is showing now. The Hue service
        // should treat `from` as context only and fade the current physical
        // light state toward the destination scene for the remaining window.
        // This makes a late service start / server restart recover cleanly even
        // after the exact genre boundary.
        fromMode: lightsScene || blendState.fromMode,
        toMode: blendState.toMode,
        durMs: remainingMs,
      };
    }

    // We already handed this transition to Hue successfully. Do not keep
    // re-issuing it every 30 seconds and resetting the bridge's fade clock.
    return { kind: "hold", key: lastBlendKey, scene: lightsScene };
  }

  if (scheduledMode === lastScheduledMode && lightsScene === scheduledMode) {
    return { kind: "none", key: "", scene: lightsScene };
  }

  return { kind: "mode", key: "", scene: scheduledMode, mode: scheduledMode };
}

module.exports = { planLightSync };