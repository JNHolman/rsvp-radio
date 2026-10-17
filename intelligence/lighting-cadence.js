"use strict";

// Shared, bridge-managed Hue color cadence for AUTO and every named club.
// A selected color stays untouched until the next irregular hold boundary.
// No browser timers, no power writes, no change to music or TV programming.
const { PALETTES, rgbToXy } = require("./ambient-light");
const { SCENES, hasScene } = require("./lighting-scenes");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_HOLD_MINUTES = 20;
const HOLD_SPREAD_MINUTES = 101; // 20–120 minutes, deterministic per week/scene
const FADE_MS = 180000; // adapter accepts at most 180000ms
const MIN_HUE_SEPARATION = 60; // distinguish blue from purple/pink, etc.

function hash(number, salt) {
  let x = (Math.imul(number ^ salt, 0x9e3779b1) + salt) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function hue(hex) {
  const [r, g, b] = rgb(hex).map(n => n / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  const delta = high - low;
  if (!delta) return 0;
  let angle = high === r ? ((g - b) / delta) % 6 :
    high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (angle * 60 + 360) % 360;
}
function hueDistance(a, b) {
  const diff = Math.abs(hue(a) - hue(b));
  return Math.min(diff, 360 - diff);
}
function nextColor(colors, previous, earlier, seed) {
  let choices = previous === null ? [...colors] :
    colors.filter(color => color !== previous && hueDistance(color, previous) >= MIN_HUE_SEPARATION);
  if (!choices.length && previous !== null) {
    const maximum = Math.max(...colors.filter(color => color !== previous).map(color => hueDistance(color, previous)));
    choices = colors.filter(color => color !== previous && hueDistance(color, previous) >= maximum);
  }
  const noBounce = choices.filter(color => color !== earlier);
  if (noBounce.length) choices = noBounce;
  return choices[seed % choices.length];
}

// Reconstruct each weekly color sequence deterministically, carrying the
// previous destination through the week boundary. A small cache avoids
// rebuilding elapsed weeks on every 30-second server safety tick.
const weekHistory = new Map();
const AUTO_ORIGIN_MS = Date.UTC(2026, 0, 1);

function runWeek(colors, salt, startOfWeek, before, earlier, nowMs = null) {
  const end = startOfWeek + WEEK_MS;
  let start = startOfWeek;
  let previous = before, older = earlier;
  for (let index = 0; index < 600; index++) {
    const dateSeed = Math.floor(startOfWeek / 86400000) + index;
    const color = nextColor(colors, previous, older, hash(dateSeed, salt));
    const holdMinutes = MIN_HOLD_MINUTES +
      (hash(dateSeed, salt + 19) % HOLD_SPREAD_MINUTES);
    const until = Math.min(end, start + holdMinutes * 60000);
    if (nowMs !== null && nowMs < until) {
      return { color, start, until };
    }
    older = previous;
    previous = color;
    start = until;
    if (until >= end) return { previous, older };
  }
  throw new Error("hue_cadence_exhausted");
}

function lightingTarget(selection, phase, nowMs, startedAt = null) {
  if (phase !== "day" && phase !== "night") throw new RangeError("invalid_solar_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_lighting_time");
  const auto = selection === "auto";
  if (!auto && !hasScene(selection)) throw new RangeError("invalid_lighting_selection");

  const palette = auto ? PALETTES[phase] : SCENES[selection];
  const colors = auto ? palette.accents : palette[phase];
  const stableOrigin = !auto && Number.isFinite(startedAt) && startedAt > 0
    ? startedAt : (nowMs >= AUTO_ORIGIN_MS ? AUTO_ORIGIN_MS : Math.floor(nowMs / WEEK_MS) * WEEK_MS);
  const generation = Math.floor((nowMs - stableOrigin) / WEEK_MS);
  const salt = (auto ? 313 : [...selection].reduce(
    (n, letter) => (Math.imul(n, 31) + letter.charCodeAt(0)) | 0, 37,
  )) + (phase === "day" ? 391 : 547);

  const historyKey = selection + ":" + phase + ":" + stableOrigin;
  if (!weekHistory.has(historyKey)) {
    weekHistory.set(historyKey, new Map([[0, { previous: null, older: null }]]));
  }
  const history = weekHistory.get(historyKey);
  if (!history.has(generation)) {
    let known = generation;
    while (known > 0 && !history.has(known)) known--;
    let carry = history.get(known);
    for (let g = known; g < generation; g++) {
      carry = runWeek(colors, salt, stableOrigin + g * WEEK_MS, carry.previous, carry.older);
      history.set(g + 1, carry);
    }
  }
  const carry = history.get(generation);
  const destination = runWeek(
    colors, salt, stableOrigin + generation * WEEK_MS, carry.previous, carry.older, nowMs,
  );
  if (!destination || !destination.color) throw new Error("invalid_hue_destination");
  return {
    phase, selection, color: destination.color,
    xy: rgbToXy(rgb(destination.color)),
    bri: palette.brightness,
    durMs: FADE_MS,
    key: selection + ":" + phase + ":" + destination.start,
    nextChangeAt: destination.until,
  };
}

module.exports = {
  lightingTarget, hueDistance, MIN_HOLD_MINUTES, HOLD_SPREAD_MINUTES, FADE_MS,
};
