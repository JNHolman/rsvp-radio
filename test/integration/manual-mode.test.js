"use strict";

/**
 * Integration coverage for manual mode override.
 * Verifies POST /mode/:mode sets server-owned override, /state reflects it
 * with source="manual" and a manualExpiresAt > now. Then POST /mode/clear
 * returns source to "timeblock".
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

test("POST /mode/:mode sets manual override visible in /state", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    const r = await fetch(`${server.baseUrl}/mode/rnb`, { method: "POST" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.mode, "rnb");
    assert.ok(body.expiresAt > Date.now(), "expiresAt must be in the future");

    // Wait for poll to register override (server triggers immediate poll).
    await new Promise((resolve) => setTimeout(resolve, 250));

    const stateRes = await fetch(`${server.baseUrl}/state`);
    const state = await stateRes.json();
    assert.equal(state.mode.current, "rnb",   "mode.current should reflect manual override");
    assert.equal(state.mode.source,  "manual","mode.source should be 'manual'");
    assert.ok(state.mode.manualExpiresAt > Date.now(), "manualExpiresAt should be in the future");
  } finally {
    await server.stop();
  }
});

test("POST /mode/:mode rejects invalid modes", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    const r = await fetch(`${server.baseUrl}/mode/notreal`, { method: "POST" });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_mode");
  } finally {
    await server.stop();
  }
});

test("POST /mode/clear returns source to timeblock", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    // Set override first
    await fetch(`${server.baseUrl}/mode/lofi`, { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Clear it
    const r = await fetch(`${server.baseUrl}/mode/clear`, { method: "POST" });
    assert.equal(r.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const stateRes = await fetch(`${server.baseUrl}/state`);
    const state = await stateRes.json();
    assert.equal(state.mode.source, "timeblock", "mode.source should return to 'timeblock' after clear");
    assert.equal(state.mode.manualExpiresAt, 0, "manualExpiresAt should reset to 0");
  } finally {
    await server.stop();
  }
});

test("POST /admin/force-timeblock-sync returns current timeblock mode", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/force-timeblock-sync`, { method: "POST" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(["lofi", "wrap", "rap", "rnb"].includes(body.mode), "mode should be one of the four genres");
  } finally {
    await server.stop();
  }
});