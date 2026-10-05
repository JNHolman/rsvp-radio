"use strict";

const blendPolicy = require("./blend-policy");

/**
 * Pick the genre source for the NEXT video clip boundary.
 * Video never changes source mid-clip.
 */
function chooseNextVideoMode({
  currentMode,
  blendState,
  pendingMode,
  automationEnabled,
  manualActive,
  randomFn = Math.random,
}) {
  if (!automationEnabled || manualActive) return currentMode || "";
  if (blendState && blendState.active) {
    return blendPolicy.chooseMode(blendState, randomFn) || currentMode || "";
  }
  return pendingMode || currentMode || "";
}

module.exports = { chooseNextVideoMode };
