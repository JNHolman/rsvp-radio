"use strict";

// RSVP Radio V3: six distinct club environments, chosen independently of music.
// Each club has rich day/night color destinations across the spectrum; Hue holds then fades between them.
// Outdoor Govee lighting is not part of this controller.
const { rgbToXy, vividTransition } = require("./ambient-light");

const SCENES = Object.freeze({
  "yin-yang-cafe": {
    name: "Yin Yang Café", collection: "The Listening Room", minutes: 19, brightness: 70,
    day: ["#16806C", "#C68F35", "#713DA8", "#C95F51", "#305BC2", "#B5337C"],
    night: ["#0C796F", "#B98B32", "#6534AD", "#CB6156", "#264AC1", "#B3318C"],
  },
  "40-40-club": {
    name: "40/40 Club", collection: "Lounge", minutes: 12, brightness: 94,
    day: ["#20477D", "#B98B34", "#C96059", "#7135B0", "#218A93", "#C23E82"],
    night: ["#2046AF", "#BB9039", "#BE5359", "#692CAE", "#227D94", "#BC2D80"],
  },
  "republic-gardens": {
    name: "Republic Gardens", collection: "Lounge", minutes: 12, brightness: 88,
    day: ["#167756", "#C67D42", "#3844B8", "#B63589", "#2C85C2", "#C8554C"],
    night: ["#08796D", "#AF8735", "#3C39B3", "#B43188", "#2876BB", "#C55451"],
  },
  "the-tunnel": {
    name: "The Tunnel", collection: "Rap", minutes: 7, brightness: 102,
    day: ["#185CD0", "#149DB3", "#D52B9F", "#D16A3B", "#6734AF", "#BA3356"],
    night: ["#213BDB", "#119AB4", "#E126AD", "#D3653A", "#7833BF", "#B92C59"],
  },
  "club-crucial": {
    name: "Club Crucial", collection: "Rap", minutes: 7, brightness: 102,
    day: ["#B53D30", "#F07922", "#315BC0", "#198577", "#7834A6", "#C23A82"],
    night: ["#C02C2D", "#D36925", "#2C58C1", "#217F83", "#7239A7", "#B92C74"],
  },
  "boom-boom-room": {
    name: "Boom Boom Room", collection: "R&B", minutes: 15, brightness: 82,
    day: ["#87263F", "#D09239", "#2F53B6", "#287F87", "#7137A9", "#C76355"],
    night: ["#70152C", "#B98A37", "#2947B5", "#227D82", "#6B2BAB", "#C86256"],
  },
});

const ids = Object.freeze(Object.keys(SCENES));
function hasScene(id) { return Object.hasOwn(SCENES, id); }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function sceneTarget(id, phase, nowMs, startedAt = 0) {
  if (!hasScene(id)) throw new RangeError("invalid_club_scene");
  if (phase !== "day" && phase !== "night") throw new RangeError("invalid_solar_phase");
  if (!Number.isFinite(nowMs)) throw new RangeError("invalid_scene_time");
  const scene = SCENES[id];
  const colors = scene[phase];
  const position = Math.max(0, nowMs - startedAt) / (scene.minutes * 60000);
  const slot = Math.floor(position);
  const progress = smoothstep(position - slot);
  // A deliberate sequence, not random near-identical picks. Every club
  // visits each color family once before cycling, with gentle eased motion.
  const from = colors[((slot % colors.length) + colors.length) % colors.length];
  const to = colors[(((slot + 1) % colors.length) + colors.length) % colors.length];
  // Saturated hue-space interpolation avoids dirty gray/white midpoints.
  const xy = rgbToXy(vividTransition(from, to, progress, 0.7));
  const bri = Math.round(scene.brightness + 2 * Math.sin(nowMs / 310000));
  return { phase, xy, bri };
}

module.exports = { SCENES, ids, hasScene, sceneTarget };
