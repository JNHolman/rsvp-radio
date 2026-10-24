"use strict";

/**
 * RSVP programming-readiness audit. READ ONLY.
 * Checks whether live Plex playlists already expose enough track-level tags
 * to make musical decisions. Does not assign blocks, edit tags, save manifests,
 * touch playback, or write to disk.
 *
 * Run from /home/pi/rsvp-radio. This file may be downloaded to /tmp.
 */
const path = require("node:path");
const root = process.cwd();
require(path.join(root, "node_modules/dotenv"))
  .config({ path: path.join(root, ".env"), quiet: true });
const cfg = require(path.join(root, "config"));
const { XMLParser } = require(path.join(root, "node_modules/fast-xml-parser"));
const { decodeXmlEntities } = require(path.join(root, "intelligence/plex-parser"));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
const attr = (x, k) => String(x?.["@_" + k] ?? "");
const tags = (track, field) => arr(track?.[field])
  .map(x => attr(x, "tag")).filter(Boolean).map(decodeXmlEntities);
const readable = x => decodeXmlEntities(String(x || "")).trim();
const player = String(cfg.PLEX_BASE || "").replace(/\/+$/, "");

function auditTracks(xml) {
  let mc;
  try { mc = parser.parse(xml)?.MediaContainer; } catch { return null; }
  if (!mc) return null;
  const tracks = arr(mc.Track);
  const reported = Number(attr(mc, "totalSize") || attr(mc, "size") || tracks.length);
  if (!Number.isSafeInteger(reported) || tracks.length !== reported) return null;
  const summary = { count: tracks.length, genres: 0, styles: 0, moods: 0, years: 0, stars: 0, samples: [] };
  const top = new Map();
  for (const track of tracks) {
    const genre = tags(track, "Genre");
    const style = tags(track, "Style");
    const mood = tags(track, "Mood");
    if (genre.length) summary.genres++;
    if (style.length) summary.styles++;
    if (mood.length) summary.moods++;
    if (/^\d{4}$/.test(attr(track, "year"))) summary.years++;
    if (Number(attr(track, "userRating")) > 0) summary.stars++;
    for (const g of genre) top.set(g, (top.get(g) || 0) + 1);
    if (summary.samples.length < 2) {
      summary.samples.push({
        title: readable(attr(track, "title")), artist: readable(attr(track, "grandparentTitle")),
        genre: genre.slice(0, 2), style: style.slice(0, 2), mood: mood.slice(0, 2),
      });
    }
  }
  summary.topGenres = [...top].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return summary;
}

async function fetchPlex(endpoint, params = {}) {
  if (!cfg.PLEX_TOKEN || !player) throw new Error("Plex credentials missing");
  const u = new URL(player + endpoint);
  u.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, String(value));
  const res = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Plex HTTP " + res.status);
  return res.text();
}
async function main() {
  console.log("RSVP TRACK PROGRAMMING METADATA — READ ONLY");
  const xml = await fetchPlex("/playlists");
  const mc = parser.parse(xml)?.MediaContainer || {};
  const playlists = [...arr(mc.Playlist), ...arr(mc.Metadata)].filter(p =>
    attr(p, "playlistType") === "audio" && /^\d+$/.test(attr(p, "ratingKey")));
  let total = 0, withGenre = 0, withStyle = 0, withMood = 0, withYear = 0;
  const pct = (n, of) => of ? Math.round(n / of * 100) + "%" : "n/a";
  for (const p of playlists) {
    const name = readable(attr(p, "title"));
    const key = attr(p, "ratingKey");
    try {
      const data = auditTracks(await fetchPlex("/playlists/" + key + "/items", {
        "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 5000,
      }));
      if (!data) { console.log(name + ": incomplete/unreadable track metadata"); continue; }
      total += data.count;
      withGenre += data.genres; withStyle += data.styles;
      withMood += data.moods; withYear += data.years;
      console.log("\n" + name + " [" + key + "] — " + data.count + " entries");
      console.log("  Genre " + pct(data.genres, data.count) +
        " | Style " + pct(data.styles, data.count) +
        " | Mood " + pct(data.moods, data.count) +
        " | Year " + pct(data.years, data.count) +
        " | Starred " + pct(data.stars, data.count));
      console.log("  Most common genre tags: " +
        (data.topGenres.map(([tag, count]) => tag + " (" + count + ")").join(", ") || "none"));
      for (const s of data.samples) console.log("  Example: " + s.artist + " — " + s.title +
        " | genre: " + (s.genre.join(", ") || "none") +
        " | style: " + (s.style.join(", ") || "none") +
        " | mood: " + (s.mood.join(", ") || "none"));
    } catch (error) {
      console.log(name + ": READ FAILED (" + error.message + ")");
    }
  }
  console.log("\nTOTAL: " + total + " playlist entries");
  console.log("Genre coverage: " + pct(withGenre, total) + "; style: " + pct(withStyle, total) +
    "; mood: " + pct(withMood, total) + "; year: " + pct(withYear, total));
  console.log("Diagnostic only. No changes made; no files or manifests saved.");
}
if (require.main === module) main().catch(e => {
  console.error("READ FAILED: " + e.message);
  process.exitCode = 1;
});
module.exports = { auditTracks };
