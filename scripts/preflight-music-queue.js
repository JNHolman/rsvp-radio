"use strict";
/**
 * Read-only RSVP music handoff preflight.
 * Run from anywhere on Pi. Never prints the Plex token or changes playback.
 */
const root = "/home/pi/rsvp-radio";
const { XMLParser } = require(root + "/node_modules/fast-xml-parser");
require(root + "/node_modules/dotenv").config({ path: root + "/.env", quiet: true });
const cfg = require(root + "/config");
const parse = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const list = x => x == null ? [] : Array.isArray(x) ? x : [x];
const attr = (x, name) => String(x?.["@_" + name] ?? "");
const plex = (process.env.PLEXAMP_BASE || "http://127.0.0.1:32500").replace(/\/+$/, "");
const pms = cfg.PLEX_BASE.replace(/\/+$/, "");
const client = process.env.PLEXAMP_CLIENT_IDENTIFIER || cfg.PLEX_TARGET_CLIENT_IDENTIFIER;
function url(base, path, extra = {}) {
  const u = new URL(base + path);
  u.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
  Object.entries(extra).forEach(([k,v]) => u.searchParams.set(k, String(v)));
  return u.toString();
}
async function get(base, path, extra) {
  const r = await fetch(url(base,path,extra), { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return parse.parse(await r.text())?.MediaContainer || {};
}
(async () => {
  console.log("RSVP music queue compatibility — READ ONLY");
  const tl = await get(plex, "/player/timeline/poll", {
    wait: 0, commandID: Date.now(), "X-Plex-Target-Client-Identifier": client || "",
  });
  const music = list(tl.Timeline).find(t => attr(t,"type") === "music");
  console.log("Plexamp state:", attr(music,"state") || "unavailable");
  console.log("Active queue detected:", !!attr(music,"playQueueID"));
  console.log("Active queue item detected:", !!attr(music,"playQueueItemID"));

  const sect = await get(pms, "/library/sections");
  const sections = new Map(list(sect.Directory).map(x => [attr(x,"key"), !!attr(x,"uuid")]));
  console.log("Plex library sections:", sections.size);

  const registry = await get(pms, "/playlists");
  const all = [...list(registry.Playlist), ...list(registry.Metadata)];
  const audio = all.filter(x => attr(x, "playlistType").toLowerCase() === "audio");
  const normalize = x => String(x || "").trim().toLowerCase().replace(/\\s+/g, " ");
  const title = x => attr(x, "title").replace(/&amp;/g, "&");
  const byName = new Map(audio.map(x => [normalize(title(x)), x]));
  console.log("Audio playlists accessible to RSVP:", audio.length);
  for (const p of audio) console.log("  " + attr(p, "ratingKey") + ": " + title(p));

  const pools = {
    morning: cfg.MUSIC_POOL_LOFI,
    daytime: cfg.MUSIC_POOL_LOUNGE,
    evening: cfg.MUSIC_POOL_RAP,
    night: cfg.MUSIC_POOL_RNB,
  };
  for (const [name, configured] of Object.entries(pools)) {
    const names = String(configured || "").split("|").map(x => x.trim()).filter(Boolean);
    if (!names.length) {
      console.log(name + ": no owner-approved sources assigned");
      continue;
    }
    for (const desired of names) {
      const p = byName.get(normalize(desired));
      if (!p) {
        console.log(name + ": source NOT FOUND (" + desired + ")");
        continue;
      }
      const id = attr(p, "ratingKey");
      try {
        const mc = await get(pms, "/playlists/" + id + "/items", {
          "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 5000,
        });
        const songs = list(mc.Track);
        const reported = Number(attr(mc, "totalSize") || attr(mc, "size") || songs.length);
        const missingSection = songs.some(x => !sections.get(attr(x, "librarySectionID")));
        console.log(name + ": " + title(p) + " [" + id + "] " +
          songs.length + "/" + reported + " tracks; complete=" +
          (reported === songs.length) + "; library_uuid_available=" + !missingSection);
      } catch (e) {
        console.log(name + ": " + desired + " read failed (" + e.message + ")");
      }
    }
  }
  console.log("No changes made. No player commands sent.");
})().catch(e => { console.log("Preflight failed safely:", e.message); process.exitCode = 1; });
