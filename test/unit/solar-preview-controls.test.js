"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const background = fs.readFileSync(path.join(__dirname, "../../public/app/background.js"), "utf8");
const preview = fs.readFileSync(path.join(__dirname, "../../scripts/preview-solar.js"), "utf8");

async function desiredForPreview({ phase, staleArtFlag }) {
  const context = {
    document: {
      getElementById: () => ({}),
      querySelector: () => ({}),
    },
    window: { location: { port: "3001", search: "?art=" + staleArtFlag } },
    BG_DAY: "/assets/bg/day.mp4",
    BG_NIGHT: "/assets/bg/night.mp4",
    isDayTime: () => false,
    fetch: async () => ({ ok: true, json: async () => ({ phase }) }),
    console,
  };
  return vm.runInNewContext(background + "\n_desiredBackground()", context);
}

test("DAY button can switch to day despite stale ?art=night on viewer", async () => {
  assert.equal(await desiredForPreview({ phase: "day", staleArtFlag: "night" }), "/assets/bg/day.mp4");
});

test("NIGHT button can switch to night despite stale ?art=day on viewer", async () => {
  assert.equal(await desiredForPreview({ phase: "night", staleArtFlag: "day" }), "/assets/bg/night.mp4");
});

test("preview controls expose the phase selected by DAY / NIGHT / AUTO", () => {
  assert.match(preview, /phase:\s*forcedPhase\s*\|\|\s*result\.phase/);
  assert.match(preview, /forcedPhase\s*=\s*phase\s*===\s*"auto"\s*\?\s*null\s*:\s*phase/);
});
