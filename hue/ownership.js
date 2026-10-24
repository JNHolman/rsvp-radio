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

// The Hue v1 group-reported XY can differ from the requested XY after a
// three-minute bridge fade. A single mismatch must not permanently hold Auto.
// Calibrate from two stable post-fade bridge observations, then recognize a
// genuine app color change only after two consecutive different observations.
const STABLE_XY_EPSILON = 0.012;
const EXTERNAL_XY_DELTA = 0.045;
const xyDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const validXy = xy => Array.isArray(xy) && xy.length === 2 && xy.every(Number.isFinite);

function createSettledHueObserver() {
  let lastWrite = null;
  let candidate = null;
  let settled = null;
  let suspected = null;

  function clear() {
    lastWrite = null;
    candidate = settled = suspected = null;
  }

  function recordWrite(command, nowMs = Date.now()) {
    lastWrite = updateAutomatedWrite(lastWrite, command, nowMs);
    candidate = settled = suspected = null;
    return lastWrite;
  }

  function inspect(action, nowMs = Date.now()) {
    if (!lastWrite || !action) return { external: false };
    if (!Number.isFinite(nowMs) || nowMs - lastWrite.writtenAt <= 1500 ||
        (Number.isFinite(lastWrite.fadeUntilMs) &&
          nowMs < lastWrite.fadeUntilMs + FADE_SETTLE_MS)) {
      return { external: false };
    }

    // Changing color temperature/mode or brightness is distinguishable
    // without calibrating XY. Preserve intentional Hue-app intervention.
    if (detectExternalHueEdit({ ...action, xy: null }, lastWrite, nowMs)) {
      return { external: true, reason: "mode_or_brightness" };
    }
    if (!validXy(action.xy)) return { external: false };

    if (!settled) {
      if (candidate && xyDistance(candidate, action.xy) <= STABLE_XY_EPSILON) {
        settled = [...action.xy];
        return {
          external: false,
          settled: true,
          requestedXyDelta: validXy(lastWrite.xy)
            ? xyDistance(settled, lastWrite.xy) : null,
        };
      }
      candidate = [...action.xy];
      return { external: false };
    }

    if (xyDistance(settled, action.xy) <= EXTERNAL_XY_DELTA) {
      suspected = null;
      return { external: false };
    }
    if (suspected && xyDistance(suspected, action.xy) <= STABLE_XY_EPSILON) {
      return { external: true, reason: "confirmed_color_change" };
    }
    suspected = [...action.xy];
    return { external: false };
  }

  return { clear, recordWrite, inspect };
}

module.exports = {
  detectExternalHueEdit, updateAutomatedWrite, createSettledHueObserver,
  FADE_SETTLE_MS, STABLE_XY_EPSILON, EXTERNAL_XY_DELTA,
};
