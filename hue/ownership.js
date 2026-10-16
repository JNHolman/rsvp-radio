"use strict";

// Hue v1 group /action reports the commanded XY and brightness targets.
// Track RSVP's most recently ACKNOWLEDGED targets; do not mistake an ongoing
// Hue fade or RSVP's own music-reactive brightness writes for native app edits.
// The physical power-off check lives in readPhysicalPower() regardless.
function detectExternalHueEdit(action, last, nowMs = Date.now()) {
  if (!action || !last || !Number.isFinite(last.writtenAt)) return false;
  if (!Number.isFinite(nowMs) || nowMs - last.writtenAt <= 1500) return false;

  const xy = action.xy;
  const expectedXy = last.xy;
  const changedColorMode = typeof action.colormode === "string" &&
    action.colormode !== "xy" && Array.isArray(expectedXy);
  const changedColor = Array.isArray(expectedXy) &&
    Array.isArray(xy) && xy.length === 2 && xy.every(Number.isFinite) &&
    Math.hypot(xy[0] - expectedXy[0], xy[1] - expectedXy[1]) > 0.045;

  // A native Hue brightness-only adjustment must also yield control. Tolerate
  // 2 brightness steps of Hue rounding/reporting discrepancy.
  const changedBrightness = Number.isFinite(last.bri) &&
    Number.isFinite(action.bri) &&
    Math.abs(action.bri - last.bri) > 2;
  return !!(changedColorMode || changedColor || changedBrightness);
}

module.exports = { detectExternalHueEdit };
