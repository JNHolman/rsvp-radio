"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPlaylistCatalog, parsePoolNames, parseMusicCatalog } =
  require("../../intelligence/playlist-catalog");

const manifest = [
  ["5397", "70s Funk Soul", 446],
  ["6975", "80s Hip Hip", 99],
  ["7015", "80s R&B", 249],
  ["8603", "90s Hip Hop", 354],
  ["7794", "90s R&B", 420],
  ["9706", "2000s Hip Hop", 547],
  ["4979", "2000s R&B", 498],
  ["11265", "2010s Hip Hop", 438],
  ["11266", "2010s R&B", 251],
  ["11267", "2020s Hip Hip", 119],
  ["5542", "2020sR&B", 59],
  ["9707", "Reggae", 31],
];

const proposalFile = path.join(__dirname, "../../config/music-pools-20261025.proposed.env");
const proposed = fs.readFileSync(proposalFile, "utf8");
const pools = Object.fromEntries(
  ["lofi", "lounge", "rap", "rnb"].map(mode => {
    const key = "MUSIC_POOL_" + mode.toUpperCase();
    const line = proposed.split("\n").find(x => x.startsWith(key + "="));
    assert.ok(line, "missing " + key);
    const value = line.slice(key.length + 1).replace(/^"/, "").replace(/"$/, "");
    return [mode, value];
  }),
);
const xmlEsc = v => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const xml = "<MediaContainer>" + manifest.map(([id, title]) =>
  '<Playlist playlistType="audio" ratingKey="' + id + '" title="' + xmlEsc(title) + '"/>',
).join("") + "</MediaContainer>";

test("2026-10-25 read-only Plex inventory is represented exactly", () => {
  assert.equal(manifest.length, 12);
  assert.equal(manifest.reduce((sum, p) => sum + p[2], 0), 3511);
  assert.deepEqual(parseMusicCatalog(xml), manifest.map(([id, name]) => ({ id, name })));
});

test("all proposed pool names exactly match current Plex playlist names", () => {
  const all = new Set(manifest.map(row => row[1]));
  const used = new Set();
  for (const mode of ["lofi", "lounge", "rap", "rnb"]) {
    const names = parsePoolNames(pools[mode]);
    assert.ok(names.length > 0, "no source pool for " + mode);
    assert.equal(new Set(names).size, names.length, "duplicate sources in " + mode);
    for (const name of names) {
      assert.ok(all.has(name), "Plex source missing or misspelled: " + mode + "/" + name);
      used.add(name);
    }
  }
  assert.deepEqual([...used].sort(), [...all].sort());
});

test("every configured pool is resolvable against the actual 12-title registry", async () => {
  let fraction = 0;
  const catalog = createPlaylistCatalog({
    plexBase: "http://127.0.0.1:32400",
    plexToken: "fake-token",
    pools,
    random: () => fraction,
    fetchWithTimeout: async () => ({ ok: true, text: async () => xml }),
  });
  for (const mode of ["lofi", "lounge", "rap", "rnb"]) {
    const names = parsePoolNames(pools[mode]);
    for (let i = 0; i < names.length; i++) {
      fraction = (i + 0.01) / names.length;
      const pick = await catalog.resolveMode(mode);
      assert.equal(pick.ok, true, JSON.stringify(pick));
      assert.equal(pick.name, names[i]);
      assert.equal(pick.playlistKey, manifest.find(item => item[1] === names[i])[0]);
    }
  }
});
