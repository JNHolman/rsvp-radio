"use strict";

/**
 * A scheduled blend may reclaim a prior manual automation stop, but never a stop
 * that the operator issued after the current blend had already begun.
 */
function shouldReclaimForBlend({ manualStop, stoppedAt, blendState, blendHalfMin = 10 }) {
  if (!manualStop || !blendState?.active) return false;
  const stopMs = Number(stoppedAt) || 0;
  const blendStartMs = Number(blendState.boundaryMs) - Number(blendHalfMin) * 60 * 1000;
  return stopMs > 0 && stopMs < blendStartMs;
}

module.exports = { shouldReclaimForBlend };