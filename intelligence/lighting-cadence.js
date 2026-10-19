"use strict";

// Artwork-matched Hue lighting: a single settled destination, held for a
// genuinely varied interval, followed by one quiet bridge-managed fade.
// Cryptographically mixed event choices are deterministic so a service
// restart cannot reshuffle the selected color or upcoming hold boundaries.
const { createHash } = require("node:crypto");
const { PALETTES, rgbToXy } = require("./ambient-light");
const { SCENES, hasScene } = require("./lighting-scenes");

const FADE_MS = 180000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_ORIGIN_MS = Date.UTC(2026, 0, 1);
const HOLD_BANDS = Object.freeze([
  Object.freeze([20, 40]),   // short, selected without a repeating rotation
  Object.freeze([50, 80]),   // medium
  Object.freeze([90, 120]),  // long
]);
const MAX_CACHED_SCHEDULES = 20;
const schedules = new Map();

function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function hue(hex) {
  const [r, g, b] = rgb(hex).map(n => n / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), gap = high - low;
  if (!gap) return 0;
  const angle = high === r ? ((g - b) / gap) % 6
    : high === g ? (b - r) / gap + 2 : (r - g) / gap + 4;
  return (angle * 60 + 360) % 360;
}
function hueDistance(a, b) {
  const difference = Math.abs(hue(a) - hue(b));
  return Math.min(difference, 360 - difference);
}

// SOFT preference for a clearly different hue. Unlike the old strict 60°
// exclusion and no-bounce rule, all other colors remain possible. Only an
// immediate exact repeat is excluded, because that would be an invisible
// transition. No enforced 3-color cycle or short/medium/long rotation.
function chooseColor(colors, previous, random) {
  const choices = colors.filter(color => color !== previous);
  if (!choices.length) return colors[0];
  const weighted = choices.map(color => {
    const distance = previous === null ? 90 : hueDistance(color, previous);
    return { color, weight: distance >= 75 ? 3 : distance >= 30 ? 2 : 1 };
  });
  const total = weighted.reduce((sum, option) => sum + option.weight, 0);
  let pick = random % total;
  for (const option of weighted) {
    if (pick < option.weight) return option.color;
    pick -= option.weight;
  }
  return weighted[weighted.length - 1].color;
}

function nextEntry(selection, phase, origin, index, start, colors, previous) {
  // Four independent 32-bit slices determine range, minutes and hue.
  // The event index never resets at week boundaries.
  const bytes = createHash("sha256")
    .update(`rsvp-hue-v4|${selection}|${phase}|${origin}|${index}`)
    .digest();
  const band = HOLD_BANDS[bytes.readUInt32BE(0) % HOLD_BANDS.length];
  const durationMinutes = band[0] + bytes.readUInt32BE(4) % (band[1] - band[0] + 1);
  const color = chooseColor(colors, previous, bytes.readUInt32BE(8));
  return { start, until: start + durationMinutes * 60000, color, durationMinutes };
}

function lightingTarget(selection, phase, nowMs, startedAt = null) {
  if (phase !== "day" && phase !== "night") throw new RangeError("invalid_solar_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_lighting_time");
  const auto = selection === "auto";
  if (!auto && !hasScene(selection)) throw new RangeError("invalid_lighting_selection");

  const palette = auto ? PALETTES[phase] : SCENES[selection];
  const colors = auto ? palette.accents : palette[phase];
  // Manual scene start is already persisted in runtime-state. Old manual
  // selections without a valid start get a fixed origin, not Date.now().
  const origin = !auto && Number.isFinite(startedAt) && startedAt > 0
    ? startedAt : (nowMs >= AUTO_ORIGIN_MS ? AUTO_ORIGIN_MS : Math.floor(nowMs / WEEK_MS) * WEEK_MS);
  const id = `${selection}:${phase}:${origin}`;
  let schedule = schedules.get(id);
  if (!schedule) {
    schedule = { entries: [], nextStart: origin };
    if (schedules.size >= MAX_CACHED_SCHEDULES) {
      schedules.delete(schedules.keys().next().value);
    }
    schedules.set(id, schedule);
  }

  // Usually no work after the first tick. Reconstructing from origin means
  // all choices survive restarts without a new clock or disk write.
  while (!schedule.entries.length || nowMs >= schedule.entries[schedule.entries.length - 1].until) {
    const last = schedule.entries[schedule.entries.length - 1];
    const entry = nextEntry(
      selection, phase, origin, schedule.entries.length,
      schedule.nextStart, colors, last?.color ?? null,
    );
    schedule.entries.push(entry);
    schedule.nextStart = entry.until;
  }

  // A test or preview may request an earlier timestamp after a later one.
  let left = 0, right = schedule.entries.length - 1;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (nowMs >= schedule.entries[middle].until) left = middle + 1;
    else right = middle;
  }
  const entry = schedule.entries[left];
  return {
    phase, selection, color: entry.color,
    xy: rgbToXy(rgb(entry.color)),
    bri: palette.brightness,
    durMs: FADE_MS,
    key: `${selection}:${phase}:${entry.start}`,
    nextChangeAt: entry.until,
    durationMinutes: entry.durationMinutes,
  };
}

module.exports = { lightingTarget, hueDistance, HOLD_BANDS, FADE_MS };
