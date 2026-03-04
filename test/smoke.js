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
  assert("has event", typeof body.event === "string");
  assert("has mode", typeof body.mode === "string");
  assert("has bass", typeof body.bass === "number");
  assert("has energy", typeof body.energy === "number");
  assert("has updatedAt", typeof body.updatedAt === "number");
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
