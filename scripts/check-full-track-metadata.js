"use strict";

/**
 * Read-only spot check: do full Plex track metadata endpoints expose year,
 * style or mood that /playlists/{id}/items did not return?
 *
 * Two entries sampled per audio playlist (first and middle). Never edits
 * Plex ratings/tags, never issues a Plexamp command, never writes a manifest.
 * Run from /home/pi/rsvp-radio; script itself may reside in /tmp.
 */
const path = require("node:path");
const root = process.cwd();
require(path.join(root, "node_modules/dotenv"))
  .config({ path: path.join(root, ".env"), quiet: true });
const cfg = require(path.join(root, "config"));
const { XMLParser } = require(path.join(root, "node_modules/fast-xml-parser"));
const { decodeXmlEntities } = require(path.join(root, "intelligence/plex-parser"));

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false,
});
const asArray = x => x == null ? [] : Array.isArray(x) ? x : [x];
const attr = (obj, key) => String(obj?.["@_" + key] ?? "");
const id = x => /^\d+$/.test(String(x || "")) ? String(x) : "";
const decode = s => decodeXmlEntities(String(s || "")).trim();
const SERVER = String(cfg.PLEX_BASE || "").replace(/\/+$/, "");
const hasYear = value => /^(18|19|20|21)\d\d$/.test(String(value || ""));

function parseDetail(xml) {
  let mc;
  try { mc = parser.parse(xml)?.MediaContainer; } catch { return null; }
  const item = asArray(mc?.Track)[0] || asArray(mc?.Metadata)[0];
  if (!item) return null;
  const tags = key => asArray(item[key]).map(x => decode(attr(x, "tag"))).filter(Boolean);
  const year = attr(item, "year");
  const parentYear = attr(item, "parentYear");
  return {
    title: decode(attr(item, "title")),
    artist: decode(attr(item, "grandparentTitle")),
    year: hasYear(year) ? year : (hasYear(parentYear) ? parentYear : ""),
    originalDate: attr(item, "originallyAvailableAt"),
    genre: tags("Genre"),
    mood: tags("Mood"),
    style: tags("Style"),
    userRating: Number(attr(item, "userRating")) || 0,
  };
}

async function get(endpoint, params = {}) {
  if (!SERVER || !cfg.PLEX_TOKEN) throw new Error("Plex configuration missing");
  const url = new URL(SERVER + endpoint);
  url.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}
async function main() {
  console.log("RSVP FULL TRACK METADATA SPOT CHECK — READ ONLY");
  console.log("Checking two tracks from each audio playlist; this is not a catalog-wide claim.");
  const registry = parser.parse(await get("/playlists"))?.MediaContainer || {};
  const playlists = [...asArray(registry.Playlist), ...asArray(registry.Metadata)]
    .filter(p => attr(p, "playlistType") === "audio" && id(attr(p, "ratingKey")));
  const overall = { retrieved: 0, year: 0, genre: 0, mood: 0, style: 0 };
  for (const p of playlists) {
    const name = decode(attr(p, "title"));
    const playlistId = id(attr(p, "ratingKey"));
    let listed;
    try {
      const container = parser.parse(await get("/playlists/" + playlistId + "/items", {
        "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 5000,
      }))?.MediaContainer;
      listed = asArray(container?.Track).filter(t => id(attr(t, "ratingKey")));
    } catch (error) {
      console.log("\n" + name + ": playlist read failed — " + error.message);
      continue;
    }
    if (!listed.length) { console.log("\n" + name + ": no readable tracks"); continue; }
    const picks = [listed[0], listed[Math.floor(listed.length / 2)]];
    const seen = new Set();
    console.log("\n" + name + " [" + playlistId + "]");
    for (const item of picks) {
      const key = id(attr(item, "ratingKey"));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      try {
        const detail = parseDetail(await get("/library/metadata/" + key));
        if (!detail) { console.log("  track " + key + ": no full metadata"); continue; }
        overall.retrieved++;
        if (detail.year || detail.originalDate) overall.year++;
        if (detail.genre.length) overall.genre++;
        if (detail.mood.length) overall.mood++;
        if (detail.style.length) overall.style++;
        console.log("  " + (detail.artist || decode(attr(item, "grandparentTitle"))) +
          " — " + (detail.title || decode(attr(item, "title"))) +
          " | year=" + (detail.year || "none") +
          " | originalDate=" + (detail.originalDate || "none") +
          " | genre=" + (detail.genre.join(", ") || "none") +
          " | style=" + (detail.style.join(", ") || "none") +
          " | mood=" + (detail.mood.join(", ") || "none"));
      } catch (error) {
        console.log("  track " + key + ": metadata read failed — " + error.message);
      }
    }
  }
  console.log("\nSAMPLED FULL-RECORD COVERAGE (" + overall.retrieved + " tracks)");
  console.log("Year/date: " + overall.year + " | Genre: " + overall.genre +
    " | Style: " + overall.style + " | Mood: " + overall.mood);
  console.log("No Plex changes, playback commands, or files written.");
}
if (require.main === module) main().catch(err => {
  console.error("READ FAILED:", err.message);
  process.exitCode = 1;
});
module.exports = { parseDetail };
