"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parsePools, sharedSources, parseCatalog, parseItems, parseSample, inspect,
} = require("../../scripts/inspect-bridge-tracks");

test("real proposed pools have overlap at all four actual clock boundaries", () => {
  const pools = parsePools(fs.readFileSync(
    path.join(__dirname, "../../config/music-pools-20261025.proposed.env"), "utf8",
  ));
  assert.equal(sharedSources(pools, "rnb", "lofi").length, 5);
  assert.equal(sharedSources(pools, "lofi", "lounge").length, 6);
  assert.equal(sharedSources(pools, "lounge", "rap").length, 5);
  assert.deepEqual(sharedSources(pools, "rap", "rnb"), ["2000s R&B"]);
  assert.throws(() => parsePools("MUSIC_POOL_LOFI=missing"), /pool_missing_or_duplicate_/);
});

test("parses Plex metadata faithfully without guessing BPM, energy or groove", () => {
  const sample = parseSample('<MediaContainer><Track ratingKey="101" grandparentTitle="A &amp; B" title="Song X" year="2004">' +
    '<Genre tag="Rhythm &amp; Blues"/><Mood tag="Warm"/></Track></MediaContainer>', "101");
  assert.equal(sample.artist, "A & B");
  assert.deepEqual(sample.genres, ["Rhythm & Blues"]);
  assert.deepEqual(sample.moods, ["Warm"]);
  assert.deepEqual(sample.styles, []);
  assert.equal(sample.year, "2004");
  assert.equal(sample.energy, undefined);
  assert.throws(() => parseSample('<MediaContainer/>', "101"), /unreadable_track_metadata/);
});

test("rejects truncated playlist responses rather than generating misleading examples", () => {
  assert.deepEqual(parseItems('<MediaContainer totalSize="1"><Track ratingKey="101"/></MediaContainer>'), ["101"]);
  assert.throws(() => parseItems('<MediaContainer totalSize="4"><Track ratingKey="101"/></MediaContainer>'), /incomplete_playlist/);
  assert.throws(() => parseItems('<MediaContainer size="1"><Track ratingKey="abc"/></MediaContainer>'), /invalid_playlist_track_id/);
});

test("live sample report calls only GET-backed playlist and full-metadata endpoints", async () => {
  const pools = {
    lofi: ["Alpha", "Bravo"],
    lounge: ["Bravo", "Charlie"],
    rap: ["Charlie", "Delta"],
    rnb: ["Delta", "Alpha"],
  };
  const ids = { Alpha: "11", Bravo: "12", Charlie: "13", Delta: "14" };
  const registry = '<MediaContainer>' +
    Object.entries(ids).map(([name, id]) =>
      '<Playlist playlistType="audio" ratingKey="' + id + '" title="' + name + '"/>',
    ).join("") + '</MediaContainer>';
  const requests = [];
  const get = async (route, params) => {
    requests.push([route, params]);
    if (route === "/playlists") return registry;
    const itemMatch = /^\/playlists\/(\d+)\/items$/.exec(route);
    if (itemMatch) {
      assert.equal(params["X-Plex-Container-Size"], 5000);
      return '<MediaContainer totalSize="1"><Track ratingKey="' +
        (100 + Number(itemMatch[1])) + '"/></MediaContainer>';
    }
    const detailMatch = /^\/library\/metadata\/(\d+)$/.exec(route);
    if (detailMatch) return '<MediaContainer><Track ratingKey="' +
      detailMatch[1] + '" title="Known Song" grandparentTitle="Real Artist"/></MediaContainer>';
    throw new Error("unexpected_route");
  };
  const result = await inspect({ pools, get });
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(item => item.samples.length), [1, 1, 1, 1]);
  assert.equal(result[0].samples[0].playlist, "Alpha");
  assert.equal(result[3].samples[0].playlist, "Delta");
  assert.equal(requests.length, 9);
  assert.ok(requests.every(([route]) =>
    route === "/playlists" || route.startsWith("/playlists/") || route.startsWith("/library/metadata/")));
});

test("Plex catalog excludes video sources and rejects missing metadata", () => {
  const map = parseCatalog('<MediaContainer><Playlist ratingKey="12" title="A &amp; B" playlistType="audio"/>' +
    '<Playlist ratingKey="13" title="Videos" playlistType="video"/></MediaContainer>');
  assert.deepEqual(map.get("a & b"), { id: "12", name: "A & B" });
  assert.equal(map.has("videos"), false);
  assert.throws(() => parseCatalog("<not-plex/>"), /unreadable_plex_playlist_registry/);
});
