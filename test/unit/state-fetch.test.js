"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchState } = require("../../public/app/state-fetch");

test("fetchState returns a valid RSVP state", async () => {
  const state = { media: { type: "video", playerState: "playing" } };
  const result = await fetchState(async () => ({
    ok: true,
    json: async () => state,
  }), "/state", 1000);

  assert.deepEqual(result, { ok: true, state });
});

test("fetchState treats HTTP failures as unavailable state", async () => {
  const result = await fetchState(async () => ({ ok: false, status: 503 }), "/state", 1000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_503");
});

test("fetchState treats network and timeout errors as unavailable state", async () => {
  const result = await fetchState(async () => { throw new Error("timeout"); }, "/state", 1000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "request_failed");
  assert.equal(result.error, "timeout");
});

test("fetchState treats malformed JSON as unavailable state", async () => {
  const result = await fetchState(async () => ({
    ok: true,
    json: async () => { throw new Error("invalid json"); },
  }), "/state", 1000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "request_failed");
});

test("fetchState rejects successful responses without the state media object", async () => {
  const result = await fetchState(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  }), "/state", 1000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_state");
});
