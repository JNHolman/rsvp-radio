"use strict";

// Artwork-coordinated color *families*, not a short list of fixed HEX swatches.
// Hue moves freely within each family so the same room never cycles among a
// handful of preset colors. We preserve the TV art's waterfront/sunlight
// character by filtering harsh lime, muddy neutrals and near-white pastels.
//
// Every output is deterministic from the caller's event seed. There are no
// background timers, bridge calls, disk writes or music dependencies.

const AUTO_FAMILIES = Object.freeze({
  day: Object.freeze([
    { id: "waterfront-blue", from: 201, to: 229 },
    { id: "lagoon-cyan",    from: 183, to: 200 },
    { id: "teal",           from: 163, to: 182 },
    { id: "jade",           from: 131, to: 157 },
    { id: "sunlit-gold",    from: 40,  to: 53 },
    { id: "tangerine",      from: 22,  to: 39 },
    { id: "coral",          from: 3,   to: 20 },
    { id: "garnet",         from: 341, to: 359 },
    { id: "orchid",         from: 298, to: 329 },
    { id: "amethyst",       from: 267, to: 297 },
    { id: "electric-violet",from: 235, to: 265 },
  ].map(Object.freeze)),
  night: Object.freeze([
    { id: "reflected-blue", from: 207, to: 236 },
    { id: "midnight-indigo",from: 239, to: 267 },
    { id: "royal-violet",   from: 270, to: 300 },
    { id: "deep-orchid",    from: 303, to: 330 },
    { id: "garnet",         from: 336, to: 359 },
    { id: "ember",          from: 3,   to: 22 },
    { id: "antique-amber",  from: 27,  to: 46 },
    { id: "jewel-jade",     from: 134, to: 159 },
    { id: "deep-teal",      from: 163, to: 188 },
    { id: "lagoon-cyan",    from: 190, to: 206 },
  ].map(Object.freeze)),
});

function mix32(seed, salt) {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function angleDistance(first, second) {
  const diff = Math.abs(first - second) % 360;
  return Math.min(diff, 360 - diff);
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  const group = Math.floor(h / 60) % 6;
  const channels = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x],
  ][group];
  return "#" + channels.map(n => Math.round((n + m) * 255)
    .toString(16).padStart(2, "0")).join("").toUpperCase();
}

function autoSpectrumColor(phase, random, history = []) {
  const families = AUTO_FAMILIES[phase];
  if (!families) throw new RangeError("invalid_solar_phase");
  if (!Number.isInteger(random) || random < 0 || random > 0xffffffff) {
    throw new RangeError("invalid_color_seed");
  }
  const recent = history.slice(-8);
  const previous = recent[recent.length - 1];
  // Never A→B→A, even for shades with different exact HEX codes.
  const lastTwo = new Set(recent.slice(-2).map(entry => entry.family));
  const candidates = families
    .filter(family => !lastTwo.has(family.id))
    .map((family, index) => {
      const h = family.from + mix32(random, index + 31) % (family.to - family.from + 1);
      const distance = Number.isFinite(previous?.hueDegrees)
        ? angleDistance(h, previous.hueDegrees) : 180;
      const seen = recent.filter(entry => entry.family === family.id).length;
      return { family, h, distance, seen };
    });
  // With 10–11 families, we can avoid almost indistinguishable successive
  // hues without recreating the former strict three-swatch rotation.
  const contrasting = candidates.filter(option => option.distance >= 52);
  const options = contrasting.length >= 3 ? contrasting : candidates;
  const weights = options.map(option =>
    Math.max(1, 4 + (option.distance >= 100 ? 2 : 0) -
      2 * option.seen + (option.seen === 0 ? 2 : 0)));
  const total = weights.reduce((sum, n) => sum + n, 0);
  let pick = mix32(random, 97) % total;
  let chosen = options[options.length - 1];
  for (let i = 0; i < options.length; i++) {
    if (pick < weights[i]) { chosen = options[i]; break; }
    pick -= weights[i];
  }

  const saturation = phase === "day"
    ? (79 + mix32(random, 109) % 17) / 100
    : (84 + mix32(random, 109) % 15) / 100;
  const value = phase === "day"
    ? (86 + mix32(random, 137) % 15) / 100
    : (79 + mix32(random, 137) % 20) / 100;

  return {
    color: hsvToHex(chosen.h, saturation, value),
    family: chosen.family.id,
    hueDegrees: chosen.h,
    saturation,
  };
}

module.exports = { AUTO_FAMILIES, autoSpectrumColor, angleDistance, hsvToHex };
