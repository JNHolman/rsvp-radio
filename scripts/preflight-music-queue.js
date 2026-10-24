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

  for (const [name, id] of Object.entries({
    morning: cfg.PLAYLIST_LOFI,
    daytime: cfg.PLAYLIST_LOUNGE,
    evening: cfg.PLAYLIST_RAP,
    night: cfg.PLAYLIST_RNB,
  })) {
    if (!/^\d+$/.test(String(id || ""))) {
      console.log(name + ": playlist not configured");
      continue;
    }
    try {
      const mc = await get(pms, "/playlists/" + id + "/items", {
        "X-Plex-Container-Start": 0,
        "X-Plex-Container-Size": 5000,
      });
      const songs = list(mc.Track);
      const reported = Number(attr(mc,"totalSize") || attr(mc,"size") || songs.length);
      const missingSection = songs.some(x => !sections.get(attr(x,"librarySectionID")));
      console.log(name + ": " + songs.length + "/" + reported +
        " tracks returned; full=" + (reported === songs.length) +
        "; library_uuid_available=" + !missingSection);
    } catch (e) {
      console.log(name + ": read failed (" + e.message + ")");
    }
  }
  console.log("No changes made. No player commands sent.");
})().catch(e => { console.log("Preflight failed safely:", e.message); process.exitCode = 1; });
