/**
 * test/smoke.js
 * Basic smoke tests — confirms server is up and returning expected shape.
 * Run with: npm run test:smoke
 * Requires the server to already be running on PORT (default 3000).
 */

const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

async function testHealth() {
  console.log("\n[/health]");
  const r = await fetch(`${BASE}/health`);
  assert("status 200", r.status === 200, `got ${r.status}`);
  const body = await r.json();
  assert("ok is boolean", typeof body.ok === "boolean");
  assert("has mode", typeof body.mode === "string");
  assert("has updatedAt", typeof body.updatedAt === "number");
  assert("has staleMs", typeof body.staleMs === "number");
  assert("has assetsOk", typeof body.assetsOk === "boolean");
  assert("has assetsMissing", Array.isArray(body.assetsMissing));
}

async function testState() {
  console.log("\n[/state]");
  const r = await fetch(`${BASE}/state`);
  assert("status 200", r.status === 200, `got ${r.status}`);
  const body = await r.json();
  assert("has appState",       typeof body.appState === "string");
  assert("has media",          body.media && typeof body.media === "object");
  assert("has media.type",     typeof body.media?.type === "string");
  assert("has mode",           body.mode && typeof body.mode === "object");
  assert("has mode.current",   typeof body.mode?.current === "string");
  assert("has mode.source",    typeof body.mode?.source === "string");
  assert("has features.bass",  typeof body.features?.bass === "number");
  assert("has features.energy",typeof body.features?.energy === "number");
  assert("has updatedAt",      typeof body.updatedAt === "number");
  assert("has intelligence",   body.intelligence && typeof body.intelligence === "object");
  assert("has plexamp",        body.plexamp && typeof body.plexamp === "object");
  assert("has video",          body.video && typeof body.video === "object");
}

async function testArtReject() {
  console.log("\n[/art - security]");
  const r = await fetch(`${BASE}/art?url=http://evil.com/bad.jpg`);
  assert("rejects external host with 403", r.status === 403, `got ${r.status}`);
}

(async () => {
  console.log(`RSVP Radio smoke tests → ${BASE}`);
  try {
    await testHealth();
    await testState();
    await testArtReject();
  } catch (err) {
    console.error("\nFATAL:", err.message);
    console.error("Is the server running? Start it with: npm start");
    process.exit(1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
