"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistCatalog, parseMusicCatalog, parsePoolNames } = require("../../intelligence/playlist-catalog");

const xml = '<MediaContainer>' +
  '<Playlist ratingKey="5397" title="70s Funk Soul" playlistType="audio"/>' +
  '<Playlist ratingKey="6975" title="80s Hip Hip" playlistType="audio"/>' +
  '<Playlist ratingKey="7015" title="80s R&amp;B" playlistType="audio"/>' +
  '<Playlist ratingKey="7790" title="90s Reggae/Afrobeats" playlistType="audio"/>' +
  '<Playlist ratingKey="567" title="LOFI Videos" playlistType="video"/>' +
  '<Playlist ratingKey="565" title="RAP Videos" playlistType="video"/>' +
  '</MediaContainer>';

function make({ pools, response = xml, error = false, random = () => 0.1 } = {}) {
  const calls = [];
  const fetchWithTimeout = async (url, ms, opts) => {
    calls.push({ url, opts });
    if (error) return { ok: false, status: 503 };
    return { ok: true, text: async () => response };
  };
  return {
    calls,
    catalog: createPlaylistCatalog({
      plexBase: "http://127.0.0.1:32400",
      plexToken: "redacted",
      fetchWithTimeout,
      pools,
      random,
    }),
  };
}

test("discover music only; video cannot be an audio source", () => {
  assert.deepEqual(parseMusicCatalog(xml), [
    { id: "5397", name: "70s Funk Soul" },
    { id: "6975", name: "80s Hip Hip" },
    { id: "7015", name: "80s R&B" },
    { id: "7790", name: "90s Reggae/Afrobeats" },
  ]);
  assert.equal(parseMusicCatalog("<invalid xml"), null);
});
test("owner's playlists are case-insensitive exact names, not genre guesses", async () => {
  const { catalog } = make({ pools: { lounge: "70s Funk Soul|80s R&B" }, random: () => .75 });
  assert.deepEqual(await catalog.resolveMode("lounge"), {
    ok: true, playlistKey: "7015", name: "80s R&B", mode: "lounge",
  });
  assert.deepEqual(await catalog.resolveMode("lounge", { deterministic: true }), {
    ok: true, playlistKey: "5397", name: "70s Funk Soul", mode: "lounge",
  });
  assert.equal((await catalog.resolveMode("rap")).reason, "unassigned_mode_pool");
  assert.equal((await catalog.resolveMode("morning")).reason, "invalid_mode");
});
test("missing or renamed playlists never switch to something similarly named", async () => {
  const { catalog } = make({ pools: { rap: "90s Hip-Hop / Rap" } });
  assert.equal((await catalog.resolveMode("rap")).reason, "no_approved_playlists_available");
});
test("new playlist is discovered without new code after Plex updates registry", async () => {
  let latest = xml;
  const responses = [];
  const catalog = createPlaylistCatalog({
    plexBase: "http://plex:32400", plexToken: "tok",
    pools: { rap: "90s Hip-Hop / Rap" },
    fetchWithTimeout: async () => {
      responses.push(latest);
      return { ok: true, text: async () => latest };
    },
  });
  assert.equal((await catalog.resolveMode("rap")).ok, false);
  latest = xml.replace("</MediaContainer>",
    '<Playlist ratingKey="8000" title="90s Hip-Hop / Rap" playlistType="audio"/></MediaContainer>');
  await catalog.getMusicPlaylists({ force: true });
  const selected = await catalog.resolveMode("rap");
  assert.equal(selected.playlistKey, "8000");
  assert.equal(responses.length, 2);
});
test("old IDs and video IDs are not silently trusted for legacy lanes", async () => {
  const { catalog } = make({ pools: { rap: "80s Hip Hip" } });
  assert.equal((await catalog.resolveLane("186")).reason, "lane_not_in_music_registry");
  assert.equal((await catalog.resolveLane("565")).reason, "lane_not_in_music_registry");
  assert.equal((await catalog.resolveLane("6975")).ok, true);
});
test("bad Plex registry fails safely without invented fallback", async () => {
  const { catalog } = make({ pools: { lounge: "70s Funk Soul" }, error: true });
  assert.equal((await catalog.resolveMode("lounge")).reason, "registry_unavailable");
});
test("pool parsing deduplicates names without truncating spaces", () => {
  assert.deepEqual(parsePoolNames("70s Funk Soul| 80s R&B | 70s  Funk Soul"), ["70s Funk Soul", "80s R&B"]);
  assert.deepEqual(parsePoolNames(""), []);
});

test("overlapping approved Plex playlist bridges two clock blocks without inventing sources", async () => {
  const { catalog } = make({
    pools: {
      lounge: "70s Funk Soul|80s Hip Hip|80s R&B",
      rap: "80s Hip Hip|90s Reggae/Afrobeats",
    },
    random: () => 0.8,
  });
  // A fresh boundary only draws from the overlap, not a random 70s or R&B pool.
  const fromOld = await catalog.resolveMode("lounge", {
    bridgeFrom: "lounge", bridgeTo: "rap", bridgeStrength: 1,
  });
  const fromNew = await catalog.resolveMode("rap", {
    bridgeFrom: "lounge", bridgeTo: "rap", bridgeStrength: 1,
  });
  assert.equal(fromOld.playlistKey, "6975");
  assert.equal(fromNew.playlistKey, "6975");
});

test("a shared previously commanded playlist keeps continuity; an unrelated one is ignored", async () => {
  const { catalog } = make({
    pools: {
      lounge: "70s Funk Soul|80s Hip Hip|80s R&B",
      rap: "80s Hip Hip|90s Reggae/Afrobeats",
    },
    random: () => 0.1,
  });
  const keep = await catalog.resolveMode("rap", {
    bridgeFrom: "lounge", bridgeTo: "rap",
    bridgeStrength: 1, preferPlaylistKey: "6975",
  });
  assert.equal(keep.playlistKey, "6975");
  const unapproved = await catalog.resolveMode("rap", {
    bridgeFrom: "lounge", bridgeTo: "rap",
    bridgeStrength: 1, preferPlaylistKey: "5397",
  });
  assert.equal(unapproved.playlistKey, "6975"); // Only the shared pool remains.
});

test("bridge preference decays as existing music transition progresses", async () => {
  const { catalog } = make({
    pools: {
      lounge: "70s Funk Soul|80s Hip Hip|80s R&B",
      rap: "80s Hip Hip|90s Reggae/Afrobeats",
    },
    random: () => 0.9,
  });
  const early = await catalog.resolveMode("lounge", {
    bridgeFrom: "lounge", bridgeTo: "rap", bridgeStrength: 1,
  });
  assert.equal(early.playlistKey, "6975");
  const late = await catalog.resolveMode("lounge", {
    bridgeFrom: "lounge", bridgeTo: "rap", bridgeStrength: 0.1,
  });
  assert.equal(late.playlistKey, "7015"); // Wider daytime pool becomes available.
});

test("when adjacent blocks have no common source, retain the existing approved pool", async () => {
  const { catalog } = make({
    pools: { lofi: "70s Funk Soul", rap: "90s Reggae/Afrobeats" },
  });
  const result = await catalog.resolveMode("rap", {
    bridgeFrom: "lofi", bridgeTo: "rap", bridgeStrength: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.playlistKey, "7790");
  assert.equal((await catalog.resolveMode("rap", {
    bridgeFrom: "invalid-mode", bridgeTo: "rap", bridgeStrength: 1,
  })).playlistKey, "7790");
});
