"use strict";

/**
 * Standalone lighting preview for the approved solar TV artwork.
 *
 * Reads the existing read-only artwork preview on :3001 and sends only
 * ambient color/brightness to the TEST Hue adapter on :5006. No Plex,
 * RSVP server, power, or manual scene commands are made.
 *
 * Safety: refuses to send anything while production Hue port :5005 is open,
 * and checks again before every write. Stop rsvp-hue temporarily to test;
 * restart it afterward. Ctrl+C ends this preview.
 */

const net = require("node:net");
const { ambientTarget, approachAmbient } = require("../intelligence/ambient-light");

const PRODUCTION_HUE_PORT = 5005;
const TEST_HUE = "http://127.0.0.1:5006";
const PREVIEW_SOLAR = "http://127.0.0.1:3001/api/solar-state";
const INTERVAL_MS = 30000;
const FIRST_FADE_MS = 180000;
const CONTINUOUS_FADE_MS = 35000;

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let finished = false;
    function finish(open) {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(open);
    }
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

async function jsonGet(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response.json();
}

function choosePreviewCommand(phase, nowMs, state) {
  const desired = ambientTarget(phase, nowMs);
  const first = !state.last;
  const next = approachAmbient(state.last, desired);
  return {
    next,
    payload: {
      xy: next.xy,
      bri: next.bri,
      durMs: first ? FIRST_FADE_MS : CONTINUOUS_FADE_MS,
    },
    holdUntil: first ? nowMs + FIRST_FADE_MS : 0,
  };
}

async function tick(state) {
  // Check FIRST and on every tick: never fight the production Hue controller.
  if (await portOpen(PRODUCTION_HUE_PORT)) {
    throw new Error("Production Hue is listening on :5005; refusing to compete with it.");
  }
  if (Date.now() < state.holdUntil) return;

  const [bridge, solar] = await Promise.all([
    jsonGet(TEST_HUE + "/health"),
    jsonGet(PREVIEW_SOLAR),
  ]);
  if (!bridge.ok || !bridge.bridgeReachable) throw new Error("Test Hue bridge is not ready on :5006");
  if (solar.phase !== "day" && solar.phase !== "night") throw new Error("No valid TV preview phase");

  const chosen = choosePreviewCommand(solar.phase, Date.now(), state);
  // A final guard protects against production restarting during the GETs.
  if (await portOpen(PRODUCTION_HUE_PORT)) throw new Error("Production Hue restarted; exiting test.");
  const response = await fetch(TEST_HUE + "/ambient", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(chosen.payload),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Test Hue command rejected: HTTP " + response.status);

  state.last = chosen.next;
  state.holdUntil = chosen.holdUntil;
  console.log(`[hue-preview] ${solar.phase} palette · gentle ${chosen.payload.durMs / 1000}s fade · ${new Date().toLocaleTimeString()}`);
}

async function main() {
  const state = { last: null, holdUntil: 0 };
  let running = true;
  const end = () => {
    running = false;
    console.log("\n[hue-preview] Stopped. Restore production lighting with: sudo systemctl start rsvp-hue");
    process.exit(0);
  };
  process.once("SIGINT", end);
  process.once("SIGTERM", end);

  console.log("[hue-preview] TV preview :3001 -> test Hue :5006");
  console.log("[hue-preview] Production Hue :5005 must be stopped. Ctrl+C to finish.");
  console.log("[hue-preview] Switch day/night at http://rsvp-radio.local:3001/preview-controls");
  while (running) {
    try {
      await tick(state);
    } catch (err) {
      console.error("[hue-preview] " + err.message);
      console.error("[hue-preview] No further Hue commands. Restore with: sudo systemctl start rsvp-hue");
      process.exitCode = 1;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error("[hue-preview] " + err.message);
    process.exitCode = 1;
  });
}

module.exports = { choosePreviewCommand, portOpen };
