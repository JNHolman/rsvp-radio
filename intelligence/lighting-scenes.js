"use strict";

// RSVP Radio V3: six distinct club environments, chosen independently of music.
// One Hue globe uses day/night variations of the same club identity.
// Outdoor Govee lighting is not part of this controller.
const { rgbToXy } = require("./ambient-light");

const SCENES = Object.freeze({
  "yin-yang-cafe": {
    name: "Yin Yang Café", collection: "The Listening Room", minutes: 19, brightness: 70,
    day: ["#365A49", "#80956B", "#C49450", "#B65E4B"],
    night: ["#155B5B", "#4F8870", "#B88645", "#69465D"],
  },
  "40-40-club": {
    name: "40/40 Club", collection: "Lounge", minutes: 12, brightness: 94,
    day: ["#20477D", "#688BBE", "#D6AF70", "#B5BAC4"],
    night: ["#182F76", "#386DD1", "#A1ADD0", "#D7A64C"],
  },
  "republic-gardens": {
    name: "Republic Gardens", collection: "Lounge", minutes: 12, brightness: 88,
    day: ["#167756", "#66B68D", "#C57D48", "#AE5478"],
    night: ["#08796D", "#18ADA3", "#B7A042", "#8541A2"],
  },
  "the-tunnel": {
    name: "The Tunnel", collection: "Rap", minutes: 7, brightness: 102,
    day: ["#185CD0", "#22B5CD", "#D52B9F", "#F37C45"],
    night: ["#213BDB", "#00AFC8", "#E126AD", "#7833BF"],
  },
  "club-crucial": {
    name: "Club Crucial", collection: "Rap", minutes: 7, brightness: 102,
    day: ["#B53D30", "#F07922", "#D0A03A", "#38566C"],
    night: ["#C02C2D", "#F26123", "#8C5330", "#28657D"],
  },
  "boom-boom-room": {
    name: "Boom Boom Room", collection: "R&B", minutes: 15, brightness: 82,
    day: ["#87263F", "#BB3D4E", "#E0B275", "#64425B"],
    night: ["#70152C", "#B42445", "#D59D57", "#1C3154"],
  },
});

const ids = Object.freeze(Object.keys(SCENES));
function hasScene(id) { return Object.hasOwn(SCENES, id); }
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function lerp(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function sceneTarget(id, phase, nowMs) {
  if (!hasScene(id)) throw new RangeError("invalid_club_scene");
  if (phase !== "day" && phase !== "night") throw new RangeError("invalid_solar_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_scene_time");
  const scene = SCENES[id];
  const colors = scene[phase];
  const position = nowMs / (scene.minutes * 60000);
  const slot = Math.floor(position);
  const progress = smoothstep(position - slot);
  // A deliberate sequence, not random near-identical picks. Every club
  // visits each color family once before cycling, with gentle eased motion.
  const from = rgb(colors[((slot % colors.length) + colors.length) % colors.length]);
  const to = rgb(colors[(((slot + 1) % colors.length) + colors.length) % colors.length]);
  const xy = rgbToXy(lerp(from, to, progress));
  const bri = Math.round(scene.brightness + 2 * Math.sin(nowMs / 310000));
  return { phase, xy, bri };
}

module.exports = { SCENES, ids, hasScene, sceneTarget };
