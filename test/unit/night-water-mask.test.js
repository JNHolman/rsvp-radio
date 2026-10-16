"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.resolve(__dirname, "../../public");
const css = fs.readFileSync(path.join(publicDir, "tv-refined.css"), "utf8");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

test("day and night use the shared eight-second ripple with night-only waterfront confinement", () => {
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\) \.artFx,\s*\.stage\.art-phase-night:not\(\.videoMode\) \.artFx/);
  assert.match(css, /\.stage\.art-phase-day \.artFx \{--rsvp-water-image:url\("\/assets\/bg\/rsvp_day_art\.webp"\);\}/);
  assert.match(css, /\.stage\.art-phase-night \.artFx \{--rsvp-water-image:url\("\/assets\/bg\/rsvp_night_art\.webp"\);\}/);
  assert.match(css, /\.stage\.art-phase-night\s+\.artFx::before\s*\{[^}]*mask-image:radial-gradient\(/s);
  assert.match(css, /\.artFx::before\s*\{[^}]*mask-image:linear-gradient\(/s);
  assert.match(css, /animation:rsvp-ripple-drift 8s ease-in-out infinite alternate/);
  assert.match(css, /@keyframes rsvp-ripple-drift\s*\{\s*from \{[^}]*opacity:\.34;\}\s*to \{[^}]*opacity:\.55;\}/);
  assert.match(html, /\/tv-refined\.css\?v=[^\"]+/);
});
