"use strict";

// Hue group /action can expose intermediate brightness/XY or an older
// colormode during a long bridge-driven fade. That is NOT proof of an app edit.
// Keep the last acknowledged RSVP targets, and observe the result only once
// the bridge has had time to finish its transition. Physical power-off still
// takes precedence immediately; it is checked by readPhysicalPower().

const FADE_SETTLE_MS = 5000;

function updateAutomatedWrite(previous, command, nowMs = Date.now()) {
  const prior = previous || {};
  const transitionDs = Number.isFinite(command?.transitiontime)
    ? Math.max(0, command.transitiontime) : 0;
  return {
    xy: Array.isArray(command?.xy) ? [...command.xy] : (prior.xy || null),
    bri: Number.isFinite(command?.bri) ? command.bri : (prior.bri ?? null),
    writtenAt: nowMs,
    // Reactive brightness messages must not shorten or prolong the main fade.
    fadeUntilMs: transitionDs > 0
      ? Math.max(prior.fadeUntilMs || 0, nowMs + transitionDs * 100)
      : (prior.fadeUntilMs || 0),
  };
}

function detectExternalHueEdit(action, last, nowMs = Date.now()) {
  if (!action || !last || !Number.isFinite(last.writtenAt)) return false;
  if (!Number.isFinite(nowMs) || nowMs - last.writtenAt <= 1500) return false;
  // The Hue bridge needs to settle after a successful 180s ambient fade.
  // Otherwise an intermediate target may be misclassified as manual control
  // on RSVP's next 30-second poll, freezing the lighting indefinitely.
  if (Number.isFinite(last.fadeUntilMs) &&
      nowMs < last.fadeUntilMs + FADE_SETTLE_MS) return false;

  const xy = action.xy;
  const expectedXy = last.xy;
  const changedColorMode = typeof action.colormode === "string" &&
    action.colormode !== "xy" && Array.isArray(expectedXy);
  const changedColor = Array.isArray(expectedXy) &&
    Array.isArray(xy) && xy.length === 2 && xy.every(Number.isFinite) &&
    Math.hypot(xy[0] - expectedXy[0], xy[1] - expectedXy[1]) > 0.045;

  // Still honor genuine Hue app brightness adjustments after a completed fade.
  const changedBrightness = Number.isFinite(last.bri) &&
    Number.isFinite(action.bri) &&
    Math.abs(action.bri - last.bri) > 2;
  return !!(changedColorMode || changedColor || changedBrightness);
}

module.exports = { detectExternalHueEdit, updateAutomatedWrite, FADE_SETTLE_MS };
