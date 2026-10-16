"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.resolve(__dirname, "../../public/tv-refined.css"), "utf8");
const html = fs.readFileSync(path.resolve(__dirname, "../../public/index.html"), "utf8");

test("day and night both render the animated lower waterfront, at approved 8-second speed", () => {
  assert.match(css, /\.stage\.art-phase-day:not\(\.videoMode\)\s+\.artFx,/);
  assert.match(css, /\.stage\.art-phase-night:not\(\.videoMode\)\s+\.artFx/);
  assert.match(css, /animation:\s*rsvp-ripple-drift\s+8s\s+ease-in-out\s+infinite\s+alternate/);
  assert.match(css, /\.stage\.art-phase-night\s+\.artFx\s*\{\s*--rsvp-water-image:url\("\/assets\/bg\/rsvp_night_art.webp"\)/);
});

test("night mask reaches lower water but excludes the lower-left cloud mist", () => {
  const block = css.match(/\.stage\.art-phase-night\s+\.artFx::before\s*\{([^}]+)\}/s);
  assert.ok(block, "night-only mask is present");
  const gradients = [...block[1].matchAll(/(?:-webkit-)?mask-image:\s*radial-gradient\(ellipse\s+(\d+)%\s+(\d+)%\s+at\s+(\d+)%\s+(\d+)%/g)];
  assert.equal(gradients.length, 2, "both Chromium and standard masks match");
  for (const [, radiusX, radiusY, centerX, centerY] of gradients) {
    assert.ok(Number(centerX) - Number(radiusX) >= 35, "left mist stays outside the animated mask");
    const maskCenterYinViewport = 66 + Number(centerY) * 0.34;
    const maskBottomYinViewport = maskCenterYinViewport + Number(radiusY) * 0.34;
    assert.ok(maskCenterYinViewport > 80, "mask is centered on actual lower water");
    assert.ok(maskBottomYinViewport >= 99, "mask reaches near the bottom of the waterfront");
  }
  assert.match(css, /\.artFx::after\s*\{[^}]*display:none;/);
  assert.match(html, /\/tv-refined\.css\?v=night-water-mask-21/);
});
