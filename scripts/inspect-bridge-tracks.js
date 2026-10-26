"use strict";

/**
 * READ-ONLY, LIVE-PEX-DATA DJ transition preview.
 * Lists real song examples inside playlists shared across adjacent time blocks.
 * Never contacts Plexamp, never edits a queue/playlist/rating, never plays music.
 *
 * Run on Pi from /home/pi/rsvp-radio with the script in /tmp.
 * The proposed music pool file is a separate private input, not auto-enabled.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
require(path.join(root, "node_modules/dotenv"))
  .config({ path: path.join(root, ".env"), quiet: true });
const cfg = require(path.join(root, "config"));
const { XMLParser } = require(path.join(root, "node_modules/fast-xml-parser"));
const { decodeXmlEntities } = require(path.join(root, "intelligence/plex-parser"));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const attr = (v, k) => String(v?.["@_" + k] ?? "");
const dec = v => decodeXmlEntities(String(v || "")).trim();
const numeric = v => /^\d+$/.test(String(v || "")) ? String(v) : "";
const modeNames = ["lofi", "lounge", "rap", "rnb"];
const boundaries = [
  ["04:00", "rnb", "lofi"],
  ["10:00", "lofi", "lounge"],
  ["17:00", "lounge", "rap"],
  ["23:00", "rap", "rnb"],
];

function parsePools(text) {
  const pools = {};
  for (const mode of modeNames) {
    const key = "MUSIC_POOL_" + mode.toUpperCase();
    const matches = String(text).split(/\r?\n/).filter(line => line.startsWith(key + "="));
    if (matches.length !== 1) throw new Error("pool_missing_or_duplicate_" + mode);
    const value = matches[0].slice(key.length + 1).trim();
    if (!/^"[^"]+"$/.test(value)) throw new Error("invalid_pool_" + mode);
    pools[mode] = [...new Set(value.slice(1, -1).split("|").map(x => x.trim()).filter(Boolean))];
    if (!pools[mode].length) throw new Error("pool_empty_" + mode);
  }
  return pools;
}

function sharedSources(pools, from, to) {
  const next = new Set((pools[to] || []).map(x => x.toLowerCase()));
  return (pools[from] || []).filter(x => next.has(x.toLowerCase()));
}
function parseCatalog(xml) {
  const mc = parser.parse(xml)?.MediaContainer;
  if (!mc) throw new Error("unreadable_plex_playlist_registry");
  const out = new Map();
  for (const p of [...arr(mc.Playlist), ...arr(mc.Metadata)]) {
    if (attr(p, "playlistType") !== "audio") continue;
    const id = numeric(attr(p, "ratingKey"));
    const name = dec(attr(p, "title"));
    if (id && name) out.set(name.toLowerCase(), { id, name });
  }
  if (!out.size) throw new Error("no_live_audio_playlists");
  return out;
}
function parseItems(xml) {
  const mc = parser.parse(xml)?.MediaContainer;
  if (!mc) throw new Error("unreadable_playlist");
  const tracks = arr(mc.Track);
  const raw = attr(mc, "totalSize") || attr(mc, "size");
  if (!/^\d+$/.test(raw) || Number(raw) !== tracks.length || !tracks.length) {
    throw new Error("incomplete_playlist");
  }
  const ids = tracks.map(track => numeric(attr(track, "ratingKey")));
  if (ids.some(x => !x)) throw new Error("invalid_playlist_track_id");
  return ids;
}
function parseSample(xml, expectedId) {
  const mc = parser.parse(xml)?.MediaContainer;
  const t = arr(mc?.Track)[0] || arr(mc?.Metadata)[0];
  if (!t || numeric(attr(t, "ratingKey")) !== String(expectedId)) {
    throw new Error("unreadable_track_metadata");
  }
  const tags = kind => arr(t[kind]).map(x => dec(attr(x, "tag"))).filter(Boolean);
  const year = attr(t, "year");
  return {
    id: expectedId,
    artist: dec(attr(t, "grandparentTitle")) || "Artist unknown",
    title: dec(attr(t, "title")) || "Title unknown",
    year: /^\d{4}$/.test(year) ? year : "unknown",
    genres: tags("Genre"), moods: tags("Mood"), styles: tags("Style"),
  };
}

async function inspect({ pools, get }) {
  const catalog = parseCatalog(await get("/playlists"));
  const output = [];
  for (const [at, from, to] of boundaries) {
    const overlap = sharedSources(pools, from, to);
    const samples = [];
    for (const name of overlap) {
      const live = catalog.get(name.toLowerCase());
      if (!live) throw new Error("approved_shared_playlist_missing_in_plex:" + name);
      const ids = parseItems(await get("/playlists/" + live.id + "/items", {
        "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 5000,
      }));
      // Representative, deterministic playlist midpoint, NOT a claim of the
      // next song the live DJ will select.
      const id = ids[Math.floor(ids.length / 2)];
      const sample = parseSample(await get("/library/metadata/" + id), id);
      samples.push({ playlist: live.name, total: ids.length, ...sample });
    }
    output.push({ at, from, to, overlap, samples });
  }
  return output;
}

async function main() {
  const proposal = process.argv[2] || "/tmp/rsvp-music-pools.proposed.env";
  const pools = parsePools(fs.readFileSync(proposal, "utf8"));
  if (!cfg.PLEX_TOKEN) throw new Error("plex_token_missing");
  const base = String(cfg.PLEX_BASE).replace(/\/+$/, "");
  const get = async (endpoint, query = {}) => {
    const u = new URL(base + endpoint);
    u.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    const r = await fetch(u, { method: "GET", signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("plex_get_http_" + r.status + " on " + endpoint);
    return r.text();
  };
  console.log("RSVP REAL SOURCE BRIDGE EXAMPLES — GET ONLY, NO PLAYBACK COMMANDS");
  const output = await inspect({ pools, get });
  for (const item of output) {
    console.log("\n" + item.at + " " + item.from + " → " + item.to +
      " | " + item.overlap.length + " shared playlists");
    for (const s of item.samples) {
      console.log("  [" + s.playlist + ": " + s.total + " tracks] " +
        s.artist + " — " + s.title + " (" + s.year + ")");
      console.log("    Plex genre: " + (s.genres.join(", ") || "unknown") +
        "; mood: " + (s.moods.join(", ") || "unknown") +
        "; style: " + (s.styles.join(", ") || "unknown"));
    }
  }
  console.log("\nSamples are real Plex records, NOT predicted playback order.");
  console.log("Plex does not provide verified BPM/groove from these fields.");
  console.log("No files, queues, playlists, playback, TV or Hue were changed.");
}
if (require.main === module) main().catch(e => {
  console.error("READ-ONLY INSPECTION STOPPED: " + e.message);
  process.exitCode = 1;
});
module.exports = { parsePools, sharedSources, parseCatalog, parseItems, parseSample, inspect };
