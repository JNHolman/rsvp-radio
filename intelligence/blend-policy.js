"use strict";

/**
 * Weighted source selection for the RSVP music handoff.
 *
 * The timeblock module owns WHEN a stage is active and its percentages.
 * This module owns WHICH source should supply the next natural track.
 */
function chooseMode(blendState, randomFn = Math.random) {
  if (!blendState || !blendState.active) return "";

  const oldPct = Number(blendState.oldPct);
  const newPct = Number(blendState.newPct);
  if (!Number.isFinite(oldPct) || !Number.isFinite(newPct) || oldPct < 0 || newPct < 0 || oldPct + newPct <= 0) {
    return "";
  }

  let roll = Number(randomFn());
  if (!Number.isFinite(roll)) roll = 0.5;
  roll = Math.min(0.999999999, Math.max(0, roll));

  const oldShare = oldPct / (oldPct + newPct);
  return roll < oldShare ? blendState.fromMode : blendState.toMode;
}

module.exports = { chooseMode };