"use strict";

// Single-bulb artwork-matched Auto. Color proportions are anchor-slot weights,
// not simultaneous multicolor output. Hue fades between each anchor slowly.
const SLOT_MS = 11 * 60 * 1000;
const PALETTES = Object.freeze({
  day: {
    // Bright blue sky/water, golden sunlight, copper, coral and dusty rose.
    accents: ["#287EC2", "#D69A37", "#B96A38", "#D47B65", "#B96C91"],
    // 35% blue, 35% gold, 15% copper, 10% coral, 5% rose.
    sequence: [0, 0, 0, 4, 3, 2, 1, 1, 1, 1, 2, 3, 0, 0, 0, 2, 1, 1, 1, 0],
    brightness: 114,
    minSaturation: 0.68,
  },
  night: {
    // Indigo/violet waterfront, blue highlights, rare magenta and salmon.
    accents: ["#264CC0", "#352B91", "#6625A9", "#B52D8B", "#D36A61", "#3576C8"],
    // 90% blue/violet anchors; 5% magenta and 5% salmon.
    sequence: [1, 0, 5, 2, 1, 0, 5, 2, 1, 0, 5, 2, 1, 0, 5, 2, 1, 3, 4, 2],
    brightness: 76,
    minSaturation: 0.74,
  },
});
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function smoothstep(t) { return t * t * (3 - 2 * t); }
function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), gap = max - min;
  let h = 0;
  if (gap) {
    if (max === r) h = 60 * (((g - b) / gap) % 6);
    else if (max === g) h = 60 * ((b - r) / gap + 2);
    else h = 60 * ((r - g) / gap + 4);
  }
  return { h: (h + 360) % 360, s: max ? gap / max : 0, v: max };
}
function hsvToRgb({ h, s, v }) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const channels = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] : h < 240 ? [0, x, c] :
      h < 300 ? [x, 0, c] : [c, 0, x];
  return channels.map(component => (component + m) * 255);
}
function vividTransition(fromHex, toHex, t, minSaturation) {
  const a = rgbToHsv(rgb(fromHex)), b = rgbToHsv(rgb(toHex));
  let dh = ((b.h - a.h + 540) % 360) - 180;
  // Do not move blue <-> amber through pale-looking green/white. The
  // violet/red/orange side of the wheel matches the artwork instead.
  if (a.h >= 170 && a.h <= 275 && b.h <= 65) dh = b.h + 360 - a.h;
  if (a.h <= 65 && b.h >= 170 && b.h <= 275) dh = b.h - 360 - a.h;
  return hsvToRgb({
    h: a.h + dh * t,
    s: Math.max(minSaturation, a.s + (b.s - a.s) * t),
    v: a.v + (b.v - a.v) * t,
  });
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
function ambientTarget(phase, nowMs) {
  if (!Object.hasOwn(PALETTES, phase)) throw new RangeError("invalid_ambient_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_ambient_time");
  const pal = PALETTES[phase];
  const position = nowMs / SLOT_MS, slot = Math.floor(position);
  const progress = smoothstep(position - slot);
  const count = pal.sequence.length;
  const fromIndex = pal.sequence[((slot % count) + count) % count];
  const toIndex = pal.sequence[(((slot + 1) % count) + count) % count];
  const color = vividTransition(pal.accents[fromIndex], pal.accents[toIndex], progress, pal.minSaturation);
  const bri = Math.round(pal.brightness + 2 * Math.sin(nowMs / 310000) + 1.5 * Math.sin(nowMs / 170000));
  return { phase, xy: rgbToXy(color), bri };
}
function approachAmbient(previous, desired, maxXyStep = 0.026, maxBriStep = 6) {
  if (!previous) return desired;
  const dx = desired.xy[0] - previous.xy[0], dy = desired.xy[1] - previous.xy[1];
  const distance = Math.hypot(dx, dy);
  const scale = distance > maxXyStep ? maxXyStep / distance : 1;
  const briDelta = Math.max(-maxBriStep, Math.min(maxBriStep, desired.bri - previous.bri));
  return { phase: desired.phase,
    xy: [+(previous.xy[0] + dx * scale).toFixed(4), +(previous.xy[1] + dy * scale).toFixed(4)],
    bri: previous.bri + briDelta };
}
module.exports = { PALETTES, SLOT_MS, ambientTarget, approachAmbient, rgbToXy, vividTransition };
