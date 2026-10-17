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

function lightingTarget(selection, phase, nowMs, startedAt = null) {
  if (phase !== "day" && phase !== "night") throw new RangeError("invalid_solar_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_lighting_time");
  const auto = selection === "auto";
  if (!auto && !hasScene(selection)) throw new RangeError("invalid_lighting_selection");

  const palette = auto ? PALETTES[phase] : SCENES[selection];
  const colors = auto ? palette.accents : palette[phase];
  const brightness = palette.brightness;
  const stableOrigin = !auto && Number.isFinite(startedAt) && startedAt > 0
    ? startedAt : Math.floor(nowMs / WEEK_MS) * WEEK_MS;
  const generation = Math.floor((nowMs - stableOrigin) / WEEK_MS);
  const origin = stableOrigin + generation * WEEK_MS;
  const end = origin + WEEK_MS;
  const salt = (auto ? 313 : [...selection].reduce((n, letter) => n * 31 + letter.charCodeAt(0), 37)) +
    (phase === "day" ? 391 : 547);
  let start = origin;
  let previous = null, earlier = null;
  for (let index = 0; index < 600; index++) {
    const seed = hash(Math.floor(origin / 86400000) + index, salt);
    const color = nextColor(colors, previous, earlier, seed);
    const holdMinutes = MIN_HOLD_MINUTES +
      (hash(Math.floor(origin / 86400000) + index, salt + 19) % HOLD_SPREAD_MINUTES);
    const until = Math.min(end, start + holdMinutes * 60000);
    if (nowMs < until || until >= end) {
      return {
        phase, selection, color,
        xy: rgbToXy(rgb(color)),
        bri: brightness,
        durMs: FADE_MS,
        key: selection + ":" + phase + ":" + start,
        nextChangeAt: until,
      };
    }
    earlier = previous;
    previous = color;
    start = until;
  }
  throw new Error("hue_cadence_exhausted");
}

module.exports = {
  lightingTarget, hueDistance, MIN_HOLD_MINUTES, HOLD_SPREAD_MINUTES, FADE_MS,
};
