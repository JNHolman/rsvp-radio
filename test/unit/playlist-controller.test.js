"use strict";

const test   = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");

const tb = require("../../shared/timeblocks");
const playlistCtl = require("../../intelligence/playlist-controller");

// ── Timeblock helpers ─────────────────────────────────────────────────────────

test("getNextBoundaryMs returns a future timestamp", () => {
  const now = new Date();
  const next = tb.getNextBoundaryMs(now);
  assert.ok(next > now.getTime(), "next boundary must be in the future");
});

test("getNextBoundaryMs is at most 24h away", () => {
  const now = new Date();
  const next = tb.getNextBoundaryMs(now);
  const delta = next - now.getTime();
  assert.ok(delta <= 24 * 60 * 60 * 1000, "next boundary must be within 24h");
});

test("getNextBoundaryMode at 03:30 (rnb block) returns lofi (4 AM boundary)", () => {
  const probe = new Date();
  probe.setHours(3, 30, 0, 0);
  assert.equal(tb.getNextBoundaryMode(probe), "lofi");
});

test("getNextBoundaryMode at 09:30 (lofi block) returns lounge (10 AM boundary)", () => {
  const probe = new Date();
  probe.setHours(9, 30, 0, 0);
  assert.equal(tb.getNextBoundaryMode(probe), "lounge");
});

test("getNextBoundaryMode at 22:30 (rap block) returns rnb (11 PM boundary)", () => {
  const probe = new Date();
  probe.setHours(22, 30, 0, 0);
  assert.equal(tb.getNextBoundaryMode(probe), "rnb");
});

test("getNextBoundaryMs at 03:30 lands on today's 04:00", () => {
  const probe = new Date();
  probe.setHours(3, 30, 0, 0);
  const next = new Date(tb.getNextBoundaryMs(probe));
  assert.equal(next.getHours(),   4);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getDate(),    probe.getDate());
});

test("getNextBoundaryMs at 23:59 wraps to tomorrow's 04:00", () => {
  const probe = new Date();
  probe.setHours(23, 59, 0, 0);
  const next = new Date(tb.getNextBoundaryMs(probe));
  assert.equal(next.getHours(),   4);
  assert.equal(next.getMinutes(), 0);
  // Date should be tomorrow's day.
  const tomorrow = new Date(probe);
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(next.getDate(),    tomorrow.getDate());
});

// ── Playlist controller ───────────────────────────────────────────────────────

test("playlistKeyForMode returns configured ratingKey", () => {
  const cfg = { PLAYLIST_LOFI: "999", PLAYLIST_LOUNGE: "", PLAYLIST_RAP: "111", PLAYLIST_RNB: "" };
  assert.equal(playlistCtl.playlistKeyForMode("lofi", cfg), "999");
  assert.equal(playlistCtl.playlistKeyForMode("rap",  cfg), "111");
});

test("playlistKeyForMode returns empty string when not configured", () => {
  const cfg = { PLAYLIST_LOFI: "", PLAYLIST_LOUNGE: "", PLAYLIST_RAP: "", PLAYLIST_RNB: "" };
  assert.equal(playlistCtl.playlistKeyForMode("lofi", cfg), "");
  assert.equal(playlistCtl.playlistKeyForMode("rnb",  cfg), "");
});

test("playlistKeyForMode returns empty string for unknown mode", () => {
  const cfg = { PLAYLIST_LOFI: "999" };
  assert.equal(playlistCtl.playlistKeyForMode("notreal", cfg), "");
});

test("playPlaylist returns not_configured when ratingKey is empty", async () => {
  const result = await playlistCtl.playPlaylist({
    playlistRatingKey: "",
    plexBase:  "http://x",
    plexToken: "t",
    clientId:  "c",
    fetchWithTimeout: async () => ({ ok: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_configured");
});

test("playPlaylist returns missing_credentials when token absent", async () => {
  const result = await playlistCtl.playPlaylist({
    playlistRatingKey: "123",
    plexBase:  "http://x",
    plexToken: "",
    clientId:  "c",
    fetchWithTimeout: async () => ({ ok: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_credentials");
});

test("playPlaylist issues fetch with playMedia URL on success", async () => {
  let capturedUrl = "";
  const result = await playlistCtl.playPlaylist({
    playlistRatingKey: "12345",
    plexBase:  "http://plex.local:32400",
    plexToken: "tok",
    clientId:  "client-uuid",
    fetchWithTimeout: async (url) => { capturedUrl = url; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.match(capturedUrl, /\/player\/playback\/playMedia\?/);
  assert.match(capturedUrl, /X-Plex-Target-Client-Identifier=client-uuid/);
  assert.match(capturedUrl, /X-Plex-Token=tok/);
  assert.match(capturedUrl, /key=%2Fplaylists%2F12345%2Fitems/);
  assert.match(capturedUrl, /repeat=2/, "playMedia enables repeat-all for the playlist queue");
});

test("playPlaylist returns plex_http_<status> on non-ok response", async () => {
  const result = await playlistCtl.playPlaylist({
    playlistRatingKey: "12345",
    plexBase:  "http://plex.local:32400",
    plexToken: "tok",
    clientId:  "client-uuid",
    fetchWithTimeout: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "plex_http_503");
});

test("playPlaylist catches fetch errors", async () => {
  const result = await playlistCtl.playPlaylist({
    playlistRatingKey: "12345",
    plexBase:  "http://plex.local:32400",
    plexToken: "tok",
    clientId:  "client-uuid",
    fetchWithTimeout: async () => { throw new Error("boom"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "boom");
});