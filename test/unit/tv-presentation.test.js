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
  assert.match(html, /<script src="\/app\/title-fit\.js"><\/script>/);
  assert.doesNotMatch(css, /\.tTitle\.title-very-long\s*\{/);
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

test("daylight uses exactly three directional washes with no leftover radial halos", () => {
  const directional = css.match(/background:\s*linear-gradient\(to right,/g) || [];
  assert.equal(directional.length, 3);
  assert.doesNotMatch(css, /radial-gradient\(/);
  for (const selector of [
    ".stage.art-phase-day:not(.videoMode) .header .brand::before",
    ".stage.art-phase-day:not(.videoMode) .nowCard::before",
    ".stage.art-phase-day:not(.videoMode) .upNext::before",
  ]) {
    const start = css.indexOf(selector + " {");
    assert.ok(start > -1, selector + " exists");
    const rule = css.slice(start, css.indexOf("}", start));
    assert.match(rule, /background:\s*linear-gradient\(to right,/);
    assert.match(rule, /mask-image:\s*linear-gradient\(to bottom,/);
  }
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.upNext\s+\.nextFeatured\s+\.nextMeta\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(css, /(?:\.ui::before|\.ui::after)\s*\{/);
  assert.doesNotMatch(html, /<div class="(?:vignette|topFade|bottomFade)">/);
});

test("station identity is gold RSVP and white RADIO in both header and drawer", () => {
  assert.match(css, /\.header\s+\.brand\s*\{[^}]*color:\s*#F6EFE5;/s);
  assert.match(css, /\.header\s+\.brand\s+\.rsvp\s*\{\s*color:\s*var\(--rsvp-gold\);/s);
  assert.match(css, /\.drawerHead\s+\.drawerWordmark\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.drawerHead\s+\.drawerWordmark\s*\{[^}]*font-size:\s*clamp\(19px, 1\.45vw, 28px\)/s);
  assert.match(css, /\.drawerHead\s+\.drawerWordmark\s+\.rsvp\s*\{\s*color:\s*var\(--rsvp-gold\);/s);
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.header\s+\.brand\s*\{[^}]*color:\s*#F6EFE5;/s);
});

test("couch readability: bold artist and cover rounding are unmissable", () => {
  assert.match(css, /\.nowCard\s+\.tTitle\s*\{[^}]*font-weight:\s*800;/s);
  assert.match(css, /\.nextTitle\s*\{[^}]*font-weight:\s*800;/s);
  assert.match(css, /\.nextArtist\s*\{[^}]*font-weight:\s*700;/s);
  assert.match(css, /\.nowCard\s+\.cover\s*\{[^}]*border-radius:\s*16px;/s);
  assert.match(css, /\.nextCover\s*\{[^}]*border-radius:\s*10px;/s);
  assert.match(css, /\.upNext\s+\.signature\s*\{[^}]*border-radius:\s*10px;/s);
});

test("weather and temperature come BEFORE the time, with the clock anchored right", () => {
  assert.ok(html.indexOf('id="weatherTemp"') < html.indexOf('id="localClock"'));
  assert.ok(html.indexOf('id="weatherCondition"') < html.indexOf('id="localClock"'));
  assert.match(css, /\.weatherWidget\s+\.weatherTemp\s*\{[^}]*font-size:\s*clamp\(21px, 1\.9vw, 38px\)/s);
  assert.match(css, /\.weatherWidget\s+\.localClock\s*\{[^}]*font-size:\s*clamp\(24px, 2\.15vw, 43px\)/s);
});

test("when idle only music interface hides, logo and weather remain available", () => {
  assert.match(css, /\.stage\.radio-idle\s+\.upNext\s*\{/);
  assert.doesNotMatch(css, /\.stage\.radio-idle\s+\.header\s+\.(?:brand|weatherWidget)/);
  assert.match(html, /class="stage radio-idle"/);
});
