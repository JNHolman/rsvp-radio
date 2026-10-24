"use strict";

/**
 * Read-only diagnostic for the SAME Plexamp and Plex Media Server endpoints
 * used by RSVP. Verifies the active timeline queue is retrievable by PMS.
 *
 * Never writes, queues, plays, skips, pauses, or exposes authentication tokens.
 */
const path = require("node:path");
const root = path.resolve(__dirname, "..");
require(path.join(root, "node_modules/dotenv")).config({ path: path.join(root, ".env"), quiet: true });
const cfg = require(path.join(root, "config"));
const { XMLParser } = require(path.join(root, "node_modules/fast-xml-parser"));
const { parseTimelineQueueContext } = require(path.join(root, "intelligence/plex-queue"));

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const arr = value => value == null ? [] : Array.isArray(value) ? value : [value];
const attr = (value, key) => String(value?.["@_" + key] ?? "");
const client = process.env.PLEXAMP_CLIENT_IDENTIFIER || cfg.PLEX_TARGET_CLIENT_IDENTIFIER || "";
const ampBase = process.env.PLEXAMP_BASE || "http://127.0.0.1:32500";
const id = value => /^\d+$/.test(String(value || "")) ? String(value) : "";

async function read(base, resource, options = {}) {
  const url = new URL(resource, base);
  url.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, String(value));
  const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
  const body = await r.text();
  return { status: r.status, ok: r.ok, body };
}
(async () => {
  const now = await read(ampBase, "/player/timeline/poll", {
    wait: 0, commandID: Date.now(), "X-Plex-Target-Client-Identifier": client,
  });
  console.log("===== LIVE PLEXAMP =====");
  console.log("Timeline HTTP:", now.status);
  if (!now.ok) return;
  const xml = parser.parse(now.body)?.MediaContainer || {};
  const music = arr(xml.Timeline).find(x => attr(x, "type") === "music");
  const state = attr(music, "state") || "unavailable";
  const context = parseTimelineQueueContext(now.body);
  console.log("Player:", state);
  console.log("Queue ID:", context?.queueId || "none");
  console.log("Queue item:", context?.itemId || "none");
  console.log("Current song ID:", context?.ratingKey || "none");
  if (state !== "playing" || !context) {
    console.log("No active playable queue to verify. No changes made.");
    return;
  }
  const server = await read(cfg.PLEX_BASE, "/playQueues/" + context.queueId, {
    "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 30,
  });
  console.log("\n===== PLEX MEDIA SERVER =====");
  console.log("Queue GET HTTP:", server.status);
  if (!server.ok) {
    console.log("Plexamp queue ID is not retrievable by PMS — stop here.");
    return;
  }
  const mc = parser.parse(server.body)?.MediaContainer || {};
  const tracks = [...arr(mc.Track), ...arr(mc.Metadata)];
  const activeById = tracks.find(x => id(attr(x, "playQueueItemID")) === context.itemId);
  const activeByKey = tracks.find(x => id(attr(x, "ratingKey")) === context.ratingKey);
  const active = activeById || activeByKey;
  console.log("Items returned:", tracks.length);
  console.log("Current song found in queue:", !!active);
  if (active) {
    console.log("Current:", attr(active, "title"), "—", attr(active, "grandparentTitle"));
    const index = tracks.indexOf(active);
    const next = tracks[index + 1];
    console.log("Following song:", next
      ? attr(next, "title") + " — " + attr(next, "grandparentTitle")
      : "not included in response");
  }
  console.log("No changes made.");
})().catch(error => { console.log("Read-only check failed:", error.message); process.exitCode = 1; });
