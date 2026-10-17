"use strict";

// One Hue globe. Pick visibly different rich colors at irregular intervals,
// give each color time to settle, then let the bridge handle a slow fade.
// Continuous tiny color changes made the lamp look stuck on one shade.
const MIN_HOLD_MS = 20 * 60 * 1000;
const HOLD_SPREAD_MINUTES = 101; // 20 through 120 minutes between changes
const FADE_MS = 180000; // Hue v1 /ambient limit: three minutes
const MIN_HUE_DISTANCE = 50; // degrees; reject look-alike adjacent colors

const PALETTES = Object.freeze({
  day: {
    base: "#E49B42",
    accents: ["#D9A441", "#C77943", "#D97965", "#C86480", "#B777A4"],
    brightness: 114,
  },
  night: {
    base: "#6A1C9A",
    accents: ["#A51791", "#8424A8", "#4E2395", "#A82370", "#922A65", "#D56A61", "#4141A3", "#3045C5"],
    brightness: 76,
  },
});

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
  const [r, g, b] = rgb(hex);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi === lo) return 0;
  const delta = hi - lo;
  const h = hi === r ? (g - b) / delta : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}
function hueDistance(a, b) {
  const diff = Math.abs(hue(a) - hue(b));
  return Math.min(diff, 360 - diff);
}
function rgbToXy(color) {
  const [r, g, b] = color.map(v => {
    const s = Math.max(0, Math.min(255, v)) / 255;
    return s > 0.04045 ? ((s + 0.055) / 1.055) ** 2.4 : s / 12.92;
  });
  const x = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const z = r * 0.000088 + g * 0.072310 + b * 0.986039;
  const sum = x + y + z;
  return [+(x / sum).toFixed(4), +(y / sum).toFixed(4)];
}

// The seed is stable across restarts and the schedule never drifts because
// it depends on wall time, not setTimeout intervals.
function weekAnchor(nowMs) {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - day.getDay());
  return day.getTime();
}
function chooseNext(colors, previous, beforePrevious, seed) {
  const viable = colors.filter(c => previous === null || hueDistance(c, previous) >= MIN_HUE_DISTANCE);
  // Avoid bouncing between two colors when other distinct shades exist.
  const fresh = viable.filter(c => c !== beforePrevious);
  const choices = fresh.length ? fresh : viable.length ? viable : colors.filter(c => c !== previous);
  return choices[seed % choices.length];
}
function ambientTarget(phase, nowMs, previousColor = null, beforePreviousColor = null) {
  if (!Object.hasOwn(PALETTES, phase)) throw new RangeError("invalid_ambient_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_ambient_time");
  const pal = PALETTES[phase];
  const colors = [pal.base, ...pal.accents];
  const week = weekAnchor(nowMs);
  const phaseSalt = phase === "day" ? 391 : 547;
  const seed = Math.floor(week / 86400000);
  const nextWeek = new Date(week);
  nextWeek.setDate(nextWeek.getDate() + 7);
  let start = week;
  for (let index = 0; index < 600; index++) {
    const holdMs = MIN_HOLD_MS + (hash(seed + index, phaseSalt + 19) % HOLD_SPREAD_MINUTES) * 60000;
    const nextAt = start + holdMs;
    if (nowMs < nextAt || nextAt >= nextWeek.getTime()) {
      const choice = chooseNext(colors, previousColor, beforePreviousColor, hash(seed + index, phaseSalt));
      return {
        phase,
        xy: rgbToXy(rgb(choice)),
        bri: pal.brightness,
        key: `${phase}:${start}`,
        color: choice,
        durMs: FADE_MS,
        nextChangeAt: Math.min(nextAt, nextWeek.getTime()),
      };
    }
    start = nextAt;
  }
  throw new Error("ambient_schedule_exhausted");
}

// Compatibility helper for legacy callers; normal ambience uses the full destination with a Hue fade.
function approachAmbient(previous, desired, maxXyStep = 0.026, maxBriStep = 6) {
  if (!previous) return desired;
  const dx = desired.xy[0] - previous.xy[0];
  const dy = desired.xy[1] - previous.xy[1];
  const distance = Math.hypot(dx, dy);
  const scale = distance > maxXyStep ? maxXyStep / distance : 1;
  const briDelta = Math.max(-maxBriStep, Math.min(maxBriStep, desired.bri - previous.bri));
  return {
    phase: desired.phase,
    xy: [+(previous.xy[0] + dx * scale).toFixed(4), +(previous.xy[1] + dy * scale).toFixed(4)],
    bri: previous.bri + briDelta,
  };
}

module.exports = { PALETTES, ambientTarget, approachAmbient, rgbToXy, hueDistance };
