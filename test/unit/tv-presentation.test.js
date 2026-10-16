"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "../../public");
const css = fs.readFileSync(path.join(publicDir, "tv-refined.css"), "utf8");
const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const overlay = fs.readFileSync(path.join(publicDir, "app/tv-overlay.js"), "utf8");

// These assertions protect the approved 3001 preview, not an older abandoned
// TV concept. Do not change the visual design to satisfy stale coordinates.
test("couch layout keeps the song metadata right-aligned and three lines maximum", () => {
  assert.match(css, /\.nowCard\s*\{[^}]*right:\s*3vw;[^}]*width:\s*44vw;/s);
  assert.match(css, /\.nowCard\s+\.tTitle\s*\{[^}]*-webkit-line-clamp:\s*3;/s);
  assert.match(html, /<script src="\/app\/title-fit\.js"><\/script>/);
  assert.doesNotMatch(css, /\.tTitle\.title-very-long\s*\{/);
});

test("progress remains compact, below the track metadata", () => {
  assert.match(css, /\.nowCard\s+\.meta\s+\.nowExtras\s*\{[^}]*width:\s*52%;/s);
  assert.match(css, /\.progressTrack\s*\{[^}]*height:\s*4px;/s);
  assert.ok(html.indexOf('class="progressTrack"') < html.indexOf('class="progressTimes"'));
});

test("Up Next retains four sleeves and a matching signature square", () => {
  assert.match(overlay, /tracks\.slice\(1, 4\)/);
  assert.match(html, /aria-label="Next four songs"/);
  assert.match(css, /\.nextStripItem\s*\{[^}]*5\.1vw;/s);
  assert.match(css, /\.upNext\s*\{[^}]*bottom:\s*5\.2vh;/s);
  assert.match(css, /\.upNext\s+\.signature\s*\{[^}]*5\.1vw;/s);
});

test("approved water treatment has no added glow or legacy shading rectangles", () => {
  const uiShading = css.match(/\.ui::before\s*\{([\s\S]*?)\}/);
  assert.ok(uiShading, "edge-free ambient readability shading exists");
  assert.equal((uiShading[1].match(/radial-gradient\(/g) || []).length, 3);
  assert.match(css, /\.artFx::after\s*\{[^}]*display:none;/s);
  assert.match(css, /\.artFx::before\s*\{[^}]*mask-image:linear-gradient\(/s);
  // Approved night water excludes the baked-in lower-left purple mist.
  assert.match(css, /\.stage\.art-phase-night\s+\.artFx::before\s*\{[^}]*mask-image:radial-gradient\(/s);
  assert.match(css, /\.stage\.art-phase-night\s+\.ui::before\s*\{\s*opacity:\s*\.94;/);
  assert.doesNotMatch(html, /<div class="(?:vignette|topFade|bottomFade)">/);
});

test("RSVP remains gold and RADIO ivory in header and drawer", () => {
  assert.match(css, /\.header\s+\.brand\s*\{[^}]*color:\s*var\(--rsvp-ivory\);/s);
  assert.match(css, /\.header\s+\.brand\s+\.rsvp,\s*\.drawerHead\s+\.drawerWordmark\s+\.rsvp\s*\{[^}]*color:\s*var\(--rsvp-gold\);/s);
  assert.match(css, /\.drawerHead\s+\.drawerWordmark\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.drawerHead\s+\.drawerWordmark\s*\{[^}]*color:\s*var\(--rsvp-ivory\);/s);
});

test("approved typography and sleeve radii stay legible from the couch", () => {
  assert.match(css, /\.nowCard\s+\.tTitle\s*\{[^}]*font-weight:\s*790;/s);
  assert.match(css, /\.nextTitle\s*\{[^}]*font-weight:\s*750;/s);
  assert.match(css, /\.nowCard\s+\.cover\s*\{[^}]*border-radius:\s*14px;/s);
  assert.match(css, /\.nextCover\s*\{[^}]*border-radius:\s*9px;/s);
  assert.match(css, /\.upNext\s+\.signature\s*\{[^}]*border-radius:\s*9px;/s);
});

test("clock displays above the smaller temperature and weather line", () => {
  assert.match(html, /id="weatherTemp"/);
  assert.match(html, /id="weatherCondition"/);
  assert.match(html, /id="localClock"/);
  assert.match(css, /\.weatherWidget\s+\.localClock\s*\{[^}]*order:\s*0;[^}]*font-size:\s*clamp\(23px,2\.6vw,51px\)/s);
  assert.match(css, /\.weatherWidget\s+\.weatherSummary\s*\{[^}]*order:\s*1;/s);
  assert.match(css, /\.weatherWidget\s+\.weatherTemp\s*\{[^}]*font-weight:\s*630;/s);
});

test("idle hides only the music UI, leaving brand and weather available", () => {
  assert.match(css, /\.stage\.radio-idle\s+\.upNext\s*\{/);
  assert.doesNotMatch(css, /\.stage\.radio-idle\s+\.header\s+\.(?:brand|weatherWidget)/);
  assert.match(html, /class="stage radio-idle"/);
});
