"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { browserSafeSourceUrl, authenticatedSourceUrl } = require("../../intelligence/plex-art");

const base = "http://127.0.0.1:32400";

test("browser-visible Plex art source never contains the Plex token", () => {
  const url = browserSafeSourceUrl("/library/metadata/1/thumb?X-Plex-Token=secret", base);
  assert.equal(url.includes("secret"), false);
  assert.equal(new URL(url).pathname, "/library/metadata/1/thumb");
});

test("art proxy adds its Plex token server-side", () => {
  const result = authenticatedSourceUrl("http://127.0.0.1:32400/library/metadata/1/thumb", base, "server-secret");
  assert.equal(result.ok, true);
  assert.equal(new URL(result.url).searchParams.get("X-Plex-Token"), "server-secret");
});

test("client-supplied Plex token is replaced, not trusted", () => {
  const result = authenticatedSourceUrl("http://127.0.0.1:32400/a?X-Plex-Token=attacker", base, "server-secret");
  assert.equal(new URL(result.url).searchParams.get("X-Plex-Token"), "server-secret");
});

test("art proxy rejects a different host", () => {
  const result = authenticatedSourceUrl("http://example.com/a.jpg", base, "server-secret");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden");
});