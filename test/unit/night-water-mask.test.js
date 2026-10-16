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

test("night animation is restricted below the shoreline and above low mist", () => {
  const block = css.match(/\.stage\.art-phase-night\s+\.artFx::before\s*\{([^}]+)\}/s);
  assert.ok(block, "night-only mask is present");
  const gradients = [...block[1].matchAll(/(?:-webkit-)?mask-image:\s*radial-gradient\(ellipse\s+(\d+)%\s+(\d+)%\s+at\s+(\d+)%\s+(\d+)%/g)];
  assert.equal(gradients.length, 2, "WebKit and standard masks match");
  for (const [, radiusX, radiusY, centerX, centerY] of gradients) {
    // Layer occupies the bottom 34vh of the TV artwork.
    const topViewport = 66 + (Number(centerY) - Number(radiusY)) * .34;
    const bottomViewport = 66 + (Number(centerY) + Number(radiusY)) * .34;
    const leftViewport = Number(centerX) - Number(radiusX);
    const rightViewport = Number(centerX) + Number(radiusX);
    assert.ok(topViewport >= 77, "mask stays below the shoreline, away from trees and buildings");
    assert.ok(bottomViewport <= 91, "mask stays above the bottom purple fog");
    assert.ok(leftViewport >= 20, "mask leaves the lower-left purple clouds still");
    assert.ok(rightViewport <= 85, "mask leaves the right cloud bank still");
    assert.ok(Number(centerX) > 40 && Number(centerX) < 60, "mask centers on real water reflections");
  }
  assert.match(block[1], /--rsvp-ripple-start-opacity:\s*\.41;/);
  assert.match(block[1], /--rsvp-ripple-end-opacity:\s*\.61;/);
  assert.match(css, /@keyframes rsvp-ripple-drift\s*\{[\s\S]*opacity:var\(--rsvp-ripple-start-opacity,\.34\);[\s\S]*opacity:var\(--rsvp-ripple-end-opacity,\.55\);/);
  assert.match(css, /\.artFx::after\s*\{[^}]*display:none;/);
  assert.match(html, /\/tv-refined\.css\?v=night-reflections-only-23/);
});
