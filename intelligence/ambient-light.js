"use strict";

// One Hue globe: slow color drift, not an obvious light show. The TV's
// sunrise/civil-dusk solar phase determines the palette.
const SLOT_MS = 11 * 60 * 1000;
// Owner-approved direction: rich, saturated colors with no pale almost-white
// accents. Retain the established low brightness and gentle 11-minute timing.
// Day/night TV artwork stays unchanged.
const PALETTES = Object.freeze({
  day: {
    base: "#E49B42",
    accents: ["#D9A441", "#C77943", "#D97965", "#C86480", "#B777A4"],
    brightness: 114,
    strength: 0.56,
  },
  night: {
    base: "#6A1C9A",
    // Pure cool night ambience: saturated cobalt, jade, sapphire, teal,
    // violet and ocean blue. Pink/salmon belong to selectable club scenes,
    // not the always-running Auto palette.
    // Neighboring hues avoid achromatic/white-looking crossfades.
    accents: ["#2261D1", "#0B988F", "#1B3EA9", "#107B82", "#5932B3", "#137AB8"],
    brightness: 76,
    strength: 0.92,
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
function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function smoothstep(t) { return t * t * (3 - 2 * t); }
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
  const position = nowMs / SLOT_MS;
  const slot = Math.floor(position);
  const progress = smoothstep(position - slot);
  const base = rgb(pal.base);
  // Preserve daytime's established random-but-smooth drift. At night,
  // deliberately alternate distinct color families rather than randomly
  // repeating magentas. Each leg still eases across eleven minutes.
  const fromIndex = phase === "night" ? slot % pal.accents.length : hash(slot, 391) % pal.accents.length;
  const toIndex = phase === "night" ? (slot + 1) % pal.accents.length : hash(slot + 1, 391) % pal.accents.length;
  const accent = mix(rgb(pal.accents[fromIndex]), rgb(pal.accents[toIndex]), progress);
  // Keep only a trace of the artwork's violet base at night to preserve
  // each saturated blue/teal destination without pulling it toward pink.
  const depth = pal.strength + (phase === "night" ? 0.008 : 0.025) * Math.sin(nowMs / 240000);
  const brightness = Math.round(pal.brightness + 2 * Math.sin(nowMs / 310000) + 1.5 * Math.sin(nowMs / 170000));
  return { phase, xy: rgbToXy(mix(base, accent, depth)), bri: brightness };
}

// A 30-second tick cannot abruptly jump from one palette to another.
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

module.exports = { PALETTES, ambientTarget, approachAmbient, rgbToXy };
