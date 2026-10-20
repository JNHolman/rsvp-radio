"use strict";

// SAFE, offline Hue/artwork contact sheet. This does not contact the Hue
// Bridge, request a service restart, control a browser or modify the TV art.
// Run on the Pi; it embeds the existing approved local stills into one HTML
// file in /tmp for side-by-side visual approval.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { lightingTarget } = require("../intelligence/lighting-cadence");

const ART_DIR = path.join(__dirname, "../public/assets/bg");
const OUT = path.join(os.tmpdir(), "rsvp-hue-spectrum-review.html");
const ART = Object.freeze({
  day: "rsvp_day_art.webp",
  night: "rsvp_night_art.webp",
});

function escapeHtml(raw) {
  return String(raw).replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function samples(phase, count = 30, now = Date.now()) {
  const results = [];
  let at = now;
  for (let i = 0; i < count; i++) {
    const color = lightingTarget("auto", phase, at);
    results.push({
      color: color.color,
      family: color.family,
      duration: color.durationMinutes,
    });
    at = color.nextChangeAt + 1;
  }
  return results;
}

function renderReview({ day, night, dayImage, nightImage }) {
  const sections = [["day", day, dayImage], ["night", night, nightImage]];
  const content = sections.map(([phase, colors, data]) => {
    const title = phase === "day" ? "Day · sunlit waterfront" : "Night · illuminated waterfront";
    const image = data ? `<img class="art" alt="${title}" src="data:image/webp;base64,${data}">`
      : '<p class="missing">Approved artwork missing: review color swatches on the Pi instead.</p>';
    const chips = colors.map((entry, index) =>
      `<div class="chip"><div class="swatch" style="background:${escapeHtml(entry.color)}"></div>
       <span>${index + 1} · ${escapeHtml(entry.family)}</span>
       <small>${escapeHtml(entry.color)} · ${entry.duration} min</small></div>`).join("");
    return `<section><h2>${title}</h2>${image}<p class="note">
      Sample of 30 real AUTO destinations and irregular hold lengths; display order is for review,
      not a new loop. The bulb shows one shade at a time.</p><div class="chips">${chips}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>RSVP Hue Spectrum · Artwork Review</title>
    <style>
      :root{color-scheme:dark;font:16px system-ui,Arial,sans-serif}
      body{margin:0;background:#11151d;color:#f5f6f8;padding:25px}
      header,main{max-width:1100px;margin:auto}h1{font-size:25px}
      p{color:#c4cbd6;line-height:1.5}section{margin:28px 0 46px}
      h2{font-size:19px}.art{display:block;width:100%;max-height:500px;object-fit:contain;
      object-position:center;border-radius:14px;background:#090a13}
      .note{font-size:13px}.chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px}
      .chip{background:#1e2530;border:1px solid #37414f;padding:9px;border-radius:12px;min-width:0}
      .swatch{height:60px;border-radius:8px;margin-bottom:8px}
      span,small{display:block;overflow-wrap:anywhere}span{font-size:12px}
      small{font-size:11px;color:#c4cbd6;margin-top:5px}
      .missing{border:1px dashed #5d6979;padding:20px;border-radius:12px}
    </style></head><body><header><h1>RSVP Radio · Hue dynamic spectrum</h1>
    <p>Compare these generated colors with the approved day/night artwork.
    No Hue commands are sent. Reject families that visually clash before deployment.</p>
    </header><main>${content}</main></body></html>`;
}

function imageData(filename) {
  const location = path.join(ART_DIR, filename);
  return fs.existsSync(location) ? fs.readFileSync(location).toString("base64") : null;
}

function main() {
  const html = renderReview({
    day: samples("day"),
    night: samples("night"),
    dayImage: imageData(ART.day),
    nightImage: imageData(ART.night),
  });
  fs.writeFileSync(OUT, html, { mode: 0o600 });
  console.log("Saved offline artwork/color review to " + OUT);
  console.log("No Hue commands, service restarts or artwork changes were made.");
}

if (require.main === module) main();
module.exports = { samples, renderReview, ART, OUT };
