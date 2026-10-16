"use strict";

/**
 * One-off, 15-second-per-color swatch preview for the real Hue globe.
 *
 * Shows the current rich day/night palette, 15 seconds per color.
 * --rich remains accepted as an alias for compatibility with earlier tests.
 * This manual sampler never changes the saved production palette.
 *
 * Safety: only sends to the TEST Hue adapter on 5006; refuses to run if
 * production Hue adapter is listening on 5005, before and during the demo.
 * The invoking shell must stop rsvp-hue and guarantee its restoration.
 */
const { PALETTES, rgbToXy } = require("../intelligence/ambient-light");
const { portOpen } = require("./preview-hue");

const TEST_HUE_URL = "http://127.0.0.1:5006";
const PRODUCTION_HUE_PORT = 5005;
const HOLD_MS = 15000;
const TRANSITION_MS = 1000;

function swatches() {
  return ["day", "night"].flatMap(phase => {
    const p = PALETTES[phase];
    // V3 Auto has anchor colors and weighted time slots; it has no
    // permanent "base" color. Preview each distinct anchor exactly once.
    return p.accents.map((hex, i) => ({
      phase, label: "color " + (i + 1), hex, bri: p.brightness,
    }));
  });
}

function colorToPayload(sample) {
  if (!/^#[0-9a-fA-F]{6}$/.test(sample.hex)) throw new Error("invalid_color");
  const rgb = [1, 3, 5].map(index => parseInt(sample.hex.slice(index, index + 2), 16));
  return { xy: rgbToXy(rgb), bri: sample.bri, durMs: TRANSITION_MS };
}

async function checkProduction() {
  if (await portOpen(PRODUCTION_HUE_PORT)) {
    throw new Error("Production Hue :5005 is running; no test colors were sent. Stop rsvp-hue for the demo.");
  }
}

async function showColor(sample) {
  await checkProduction();
  const response = await fetch(TEST_HUE_URL + "/ambient", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(colorToPayload(sample)),
    signal: AbortSignal.timeout(6000),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error("Hue rejected " + sample.hex + " (HTTP " + response.status + ")");
  }
}

async function main() {
  await checkProduction();
  const health = await fetch(TEST_HUE_URL + "/health", { signal: AbortSignal.timeout(5000) });
  if (!health.ok || !(await health.json()).bridgeReachable) {
    throw new Error("Test Hue adapter on :5006 cannot reach the bridge");
  }
  const colors = swatches();
  console.log("[hue-swatches] Showing " + colors.length + " current rich day/night palette swatches, 15 seconds each.");
  console.log("[hue-swatches] Raw colors appear stronger than the normal slow ambient blends.");
  let stopped = false;
  const end = () => { stopped = true; };
  process.once("SIGINT", end);
  process.once("SIGTERM", end);
  for (const [index, sample] of colors.entries()) {
    if (stopped) break;
    await showColor(sample);
    console.log("[hue-swatches] " + (index + 1) + "/" + colors.length +
      " " + sample.phase.toUpperCase() + " " + sample.label + " " + sample.hex +
      " — hold 15 seconds");
    await new Promise(resolve => setTimeout(resolve, HOLD_MS));
  }
  console.log("[hue-swatches] Finished. Production Hue restoration is handled by the shell wrapper.");
}

if (require.main === module) {
  main().catch(error => {
    console.error("[hue-swatches] " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { swatches, colorToPayload };
