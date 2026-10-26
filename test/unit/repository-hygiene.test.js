"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repo, relative), "utf8");

test("every static stylesheet and browser script referenced by the UI exists", () => {
  for (const page of ["public/index.html", "public/admin.html"]) {
    const html = read(page);
    const assets = [
      ...html.matchAll(/<link[^>]+href="(\/[^"]+\.css(?:\?[^"]*)?)"/g),
      ...html.matchAll(/<script[^>]+src="(\/[^"]+\.js(?:\?[^"]*)?)"/g),
    ];
    assert.ok(assets.length >= 3, page + " has no assets");
    for (const match of assets) {
      const url = match[1].split("?")[0];
      if (url === "/runtime-config.js") continue; // Generated dynamically by Express.
      assert.ok(fs.existsSync(path.join(repo, "public", url)), page + " references missing " + url);
    }
  }
});

test("only the current solar/club lighting controller is loaded by production", () => {
  const server = read("server.js");
  assert.doesNotMatch(server, /lightTransition|planLightSync|_lastScheduledLightsMode|_lastLightBlendKey|_applyLightsScene/);
  // Current lighting uses irregular settled holds, not the legacy
  // continuously interpolated club/ambient target controllers.
  assert.match(server, /lightingCadence\.lightingTarget/);
  assert.match(server, /clubLights\.hasScene/);
  assert.match(server, /_ambientLast\?\.key === desired\.key/);
  assert.doesNotMatch(server, /clubLights\.sceneTarget\(|ambientLight\.ambientTarget\(/);
  const html = read("public/index.html");
  assert.match(html, /\/tv-refined\.css/);
  assert.doesNotMatch(html, /\/tv-overlay\.css/);
});

test("all six club controls are present without a separate browser-side Hue scheduler", () => {
  const html = read("public/index.html");
  const browser = read("public/app/main.js");
  assert.equal((html.match(/data-light-scene="/g) || []).length, 6);
  assert.match(browser, /setLightsAuto\(\)/);
  assert.doesNotMatch(browser, /setInterval\([^)]*setLights/);
});
