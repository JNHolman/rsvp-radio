"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "../../public");
const css = fs.readFileSync(path.join(publicDir, "tv-refined.css"), "utf8");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const overlay = fs.readFileSync(path.join(publicDir, "app/tv-overlay.js"), "utf8");

test("couch TV layout keeps text to the right with permitted outer-record overlap", () => {
  assert.match(css, /\.nowCard\s*\{\s*left:\s*54vw;/);
  assert.match(css, /\.nowCard\s*\{[^}]*width:\s*42\.2vw;/s);
  assert.match(css, /\.nowCard\s+\.tTitle\s*\{[^}]*-webkit-line-clamp:\s*3;/s);
  assert.match(css, /\.tTitle\.title-long\s*\{/);
  assert.match(css, /\.tTitle\.title-very-long\s*\{/);
});

test("progress stays short/thick with elapsed and total below the bar", () => {
  assert.match(css, /\.nowCard\s+\.meta\s+\.nowExtras\s*\{[^}]*17\.4vw\)/s);
  assert.match(css, /\.progressTrack\s*\{[^}]*height:\s*6px;/s);
  assert.ok(html.indexOf('class="progressTrack"') < html.indexOf('class="progressTimes"'));
});

test("Up Next has four real sleeves, a raised queue and matching signature", () => {
  assert.match(overlay, /tracks\.slice\(1, 4\)/);
  assert.match(html, /aria-label="Next four songs"/);
  assert.match(css, /\.nextStripItem\s*\{[^}]*7\.6vw;/s);
  assert.match(css, /\.upNext\s*\{[^}]*bottom:\s*7vh;/s);
  assert.match(css, /\.upNext\s+\.signature\s*\{[^}]*7\.6vw;/s);
});

test("daytime titles and queue use feathered glow instead of text boxes or strokes", () => {
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.nowCard::before\s*\{[^}]*radial-gradient\(/s);
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.upNext::before\s*\{[^}]*radial-gradient\(/s);
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.header\s+\.brand,[^}]*-webkit-text-stroke:\s*0;/s);
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.upNext\s+\.nextFeatured\s+\.nextMeta\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /\.nowCard\s+\.tTitle\s*\{[^}]*font-weight:\s*800;/s);
  assert.match(css, /\.nextTitle\s*\{[^}]*font-weight:\s*800;/s);
  assert.match(css, /\.nextArtist\s*\{[^}]*font-weight:\s*700;/s);
  assert.match(css, /\.nowCard\s+\.cover\s*\{[^}]*border-radius:\s*9px;/s);
  assert.match(css, /\.nextCover\s*\{[^}]*border-radius:\s*6px;/s);
  assert.match(css, /\.upNext\s+\.signature\s*\{[^}]*border-radius:\s*6px;/s);
  assert.doesNotMatch(css, /background:\s*rgba\(12,10,30,\.80\)/);
  assert.doesNotMatch(css, /(?:\.ui::before|\.ui::after)\s*\{/);
  assert.doesNotMatch(html, /<div class="(?:vignette|topFade|bottomFade)">/);
});

test("when idle only music interface hides, logo and weather remain available", () => {
  assert.match(css, /\.stage\.radio-idle\s+\.upNext\s*\{/);
  assert.doesNotMatch(css, /\.stage\.radio-idle\s+\.header\s+\.(?:brand|weatherWidget)/);
  assert.match(html, /class="stage radio-idle"/);
});
