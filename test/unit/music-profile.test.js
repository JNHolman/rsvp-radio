"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMusicProfile, createMusicProfileReader } = require("../../intelligence/music-profile");

const record = (key = "77") =>
  '<MediaContainer size="1"><Track ratingKey="' + key + '" ' +
  'title="Play &amp; Dance" parentTitle="Album" grandparentTitle="Artist" ' +
  'year="1996" userRating="8">' +
  '<Genre tag="Hip-Hop/Rap"/><Mood tag="Celebratory"/><Mood tag="Swaggering"/>' +
  '</Track></MediaContainer>';

test("full Plex record preserves facts without guessing RSVP neighborhood, groove or energy", () => {
  const profile = parseMusicProfile(record());
  assert.equal(profile.ratingKey, "77");
  assert.equal(profile.title, "Play & Dance");
  assert.equal(profile.year, 1996);
  assert.deepEqual(profile.genre, ["Hip-Hop/Rap"]);
  assert.deepEqual(profile.mood, ["Celebratory", "Swaggering"]);
  assert.deepEqual(profile.style, []);
  assert.equal(profile.userRating, 8);
  assert.deepEqual(profile.programming, {
    neighborhoods: [], moodClass: null, energy: null, groove: null, cleanDirty: null,
  });
});

test("missing moods, style, year, and rating remain unknown rather than synthesized", () => {
  const result = parseMusicProfile(
    '<MediaContainer><Track ratingKey="57" title="Unclassified" grandparentTitle="Group" /></MediaContainer>',
  );
  assert.deepEqual(result.mood, []);
  assert.deepEqual(result.style, []);
  assert.equal(result.year, null);
  assert.equal(result.userRating, null);
  assert.equal(result.programming.energy, null);
  assert.equal(result.programming.cleanDirty, null);
  assert.equal(parseMusicProfile("<bad"), null);
});

test("profile reader GETs only full track metadata, caches, and reuses simultaneous request", async () => {
  const calls = [];
  const fetchWithTimeout = async (url, timeoutMs, options) => {
    const u = new URL(url);
    calls.push({ method: options?.method || "GET", path: u.pathname, token: u.searchParams.get("X-Plex-Token") });
    assert.equal(timeoutMs, 3000);
    return { ok: true, text: async () => record("77") };
  };
  const reader = createMusicProfileReader({
    plexBase: "http://localhost:32400", plexToken: "fake-token", fetchWithTimeout,
  });
  const [a,b] = await Promise.all([reader.get("77"), reader.get("77")]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const c = await reader.get("77");
  assert.equal(c.cached, true);
  assert.deepEqual(calls, [{
    method: "GET", path: "/library/metadata/77", token: "fake-token",
  }]);
});

test("profile reader rejects invalid track and mismatched response IDs without mutation", async () => {
  const calls = [];
  const reader = createMusicProfileReader({
    plexBase: "http://localhost:32400", plexToken: "fake-token",
    fetchWithTimeout: async (...args) => {
      calls.push(args);
      return { ok: true, text: async () => record("88") };
    },
  });
  assert.equal((await reader.get("../77")).reason, "invalid_track_id");
  assert.equal(calls.length, 0);
  assert.equal((await reader.get("77")).reason, "unreadable_track_metadata");
  assert.equal(calls.length, 1);
});