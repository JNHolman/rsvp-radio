"use strict";

/**
 * One-shot, operator-approved live Plex Play Next verification.
 *
 * Makes one PUT to the active PLAY QUEUE, then best-effort DELETE of only
 * the new queue item. NEVER playMedia, stop, skip, pause or clear the queue.
 * Aborts if the active track/queue changes before the write.
 *
 * Run from /home/pi/rsvp-radio; this script may be downloaded to /tmp.
 */
const path = require("node:path");
const readline = require("node:readline/promises");
const root = process.cwd();
require(path.join(root, "node_modules/dotenv"))
  .config({ path: path.join(root, ".env"), quiet: true });
const cfg = require(path.join(root, "config"));
const { XMLParser } = require(path.join(root, "node_modules/fast-xml-parser"));
const { parseTimelineQueueContext } = require(path.join(root, "intelligence/plex-queue"));

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const attr = (v, name) => String(v?.["@_" + name] ?? "");
const id = x => /^\d+$/.test(String(x || "")) ? String(x) : "";
const CLIENT_ID = process.env.PLEXAMP_CLIENT_IDENTIFIER || cfg.PLEX_TARGET_CLIENT_IDENTIFIER || "";
const AMP_BASE = process.env.PLEXAMP_BASE || "http://127.0.0.1:32500";
const TEST_PLAYLIST_NAME = "80s Hip Hip"; // exact title from the Pi's live Plex registry

async function request(base, endpoint, { method = "GET", params = {} } = {}) {
  const u = new URL(endpoint, base);
  u.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { method, signal: AbortSignal.timeout(7000) });
  const body = await r.text();
  const container = body.trim() ? (() => {
    try { return parser.parse(body)?.MediaContainer || {}; } catch { return {}; }
  })() : {};
  return { ok: r.ok, status: r.status, container, body };
}
async function timeline() {
  const r = await request(AMP_BASE, "/player/timeline/poll", {
    params: { wait: 0, commandID: Date.now(), "X-Plex-Target-Client-Identifier": CLIENT_ID },
  });
  if (!r.ok) throw new Error("Plexamp timeline HTTP " + r.status);
  const music = arr(r.container.Timeline).find(x => attr(x, "type") === "music");
  return {
    state: attr(music, "state"),
    context: parseTimelineQueueContext(r.body),
  };
}
async function queue(queueId) {
  const r = await request(cfg.PLEX_BASE, "/playQueues/" + queueId, {
    params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 250 },
  });
  if (!r.ok) throw new Error("Queue GET HTTP " + r.status);
  const tracks = [...arr(r.container.Metadata), ...arr(r.container.Track)];
  const count = Number(attr(r.container, "playQueueTotalCount") || tracks.length);
  if (count !== tracks.length) throw new Error("Queue truncated; refusing write");
  if (tracks.some(t => !id(attr(t, "playQueueItemID")))) {
    throw new Error("Queue item IDs not available");
  }
  return tracks;
}
const sameCurrent = (a, b) => a?.queueId === b?.queueId &&
  a?.itemId === b?.itemId && a?.ratingKey === b?.ratingKey;

async function main() {
  if (!cfg.PLEX_TOKEN || !CLIENT_ID) {
    throw new Error("Missing Plex token/client; refusing write");
  }
  const before = await timeline();
  if (before.state !== "playing" || !before.context?.itemId) {
    throw new Error("Plexamp must be playing a queue item");
  }
  const original = await queue(before.context.queueId);
  const currentIndex = original.findIndex(x =>
    id(attr(x, "playQueueItemID")) === before.context.itemId);
  if (currentIndex < 0) throw new Error("Current track not found in queue");

  const registry = await request(cfg.PLEX_BASE, "/playlists");
  if (!registry.ok) throw new Error("Playlist registry HTTP " + registry.status);
  const matches = [...arr(registry.container.Playlist), ...arr(registry.container.Metadata)]
    .filter(p => attr(p, "title") === TEST_PLAYLIST_NAME &&
      attr(p, "playlistType") === "audio" && id(attr(p, "ratingKey")));
  if (matches.length !== 1) throw new Error("Test playlist missing/ambiguous");
  const playlistKey = id(attr(matches[0], "ratingKey"));

  const itemsResponse = await request(cfg.PLEX_BASE, "/playlists/" + playlistKey + "/items", {
    params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 5000 },
  });
  if (!itemsResponse.ok) throw new Error("Test playlist HTTP " + itemsResponse.status);
  const items = [...arr(itemsResponse.container.Track), ...arr(itemsResponse.container.Metadata)];
  const total = Number(attr(itemsResponse.container, "totalSize") ||
    attr(itemsResponse.container, "size") || items.length);
  if (!items.length || total !== items.length) throw new Error("Test playlist incomplete");

  const known = new Set(original.map(x => id(attr(x, "ratingKey"))));
  const selection = items.find(x => id(attr(x, "ratingKey")) &&
    id(attr(x, "librarySectionID")) && !known.has(id(attr(x, "ratingKey"))));
  if (!selection) throw new Error("No unused track for test");
  const choiceKey = id(attr(selection, "ratingKey"));
  const sectionKey = id(attr(selection, "librarySectionID"));

  const sectionsResponse = await request(cfg.PLEX_BASE, "/library/sections");
  if (!sectionsResponse.ok) throw new Error("Library sections HTTP " + sectionsResponse.status);
  const section = arr(sectionsResponse.container.Directory)
    .find(x => id(attr(x, "key")) === sectionKey);
  const uuid = attr(section, "uuid");
  if (!/^[a-z0-9-]{8,}$/i.test(uuid)) throw new Error("Missing music library UUID");

  console.log("===== SAFE PLAY NEXT TEST =====");
  console.log("Playing:", attr(original[currentIndex], "title"), "—",
    attr(original[currentIndex], "grandparentTitle"));
  console.log("Currently next:", attr(original[currentIndex + 1], "title") || "none");
  console.log("Test insert:", attr(selection, "title"), "—",
    attr(selection, "grandparentTitle"));
  console.log("Queue:", before.context.queueId);
  console.log("Plan: add ONE test song as Play Next, verify current song, then");
  console.log("remove ONLY the inserted queue item. No playback commands.");
  console.log("Do not run near the current song's ending or while changing the queue on your phone.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try { answer = await rl.question("Type TEST to perform the temporary queue test: "); }
  finally { rl.close(); }
  if (answer !== "TEST") {
    console.log("Cancelled. No changes made.");
    return;
  }

  const recheck = await timeline();
  if (recheck.state !== "playing" || !sameCurrent(before.context, recheck.context)) {
    throw new Error("Playback changed while confirming; no queue write");
  }
  const originalItemIds = new Set(original.map(x => id(attr(x, "playQueueItemID"))));
  const uri = "library://" + uuid + "/item/library/metadata/" + choiceKey;
  // Even if PUT times out after Plex processes it, inspect the queue for
  // the newly inserted item and try to remove that exact item.
  let insertedId = "";
  try {
    let putStatus = "request failed";
    try {
      const put = await request(cfg.PLEX_BASE, "/playQueues/" + before.context.queueId,
        { method: "PUT", params: { uri, next: 1 } });
      putStatus = put.status;
    } catch (error) {
      console.log("Play Next request error:", error.message);
    }
    console.log("Play Next PUT HTTP:", putStatus);
    const after = await queue(before.context.queueId);
    const changed = after.filter(x => !originalItemIds.has(id(attr(x, "playQueueItemID"))) &&
      id(attr(x, "ratingKey")) === choiceKey);
    if (changed.length === 1) insertedId = id(attr(changed[0], "playQueueItemID"));
    else if (changed.length > 1) console.log("WARNING: multiple matching insertions; no automatic removal");
    const afterTimeline = await timeline();
    console.log("Playback remains playing:", afterTimeline.state === "playing");
    console.log("Current song unchanged:", sameCurrent(before.context, afterTimeline.context));
    console.log("Inserted song found:", !!insertedId);
    const idx = after.findIndex(x => id(attr(x, "playQueueItemID")) === before.context.itemId);
    const next = idx < 0 ? null : after[idx + 1];
    console.log("Now next:", next ? attr(next, "title") : "not found");
    console.log("Current queue entries after insert:", after.length);
  } finally {
    if (insertedId) {
      // Only the exact new item. Never delete a previous queue entry.
      const del = await request(cfg.PLEX_BASE,
        "/playQueues/" + before.context.queueId + "/items/" + insertedId,
        { method: "DELETE" });
      console.log("Test-item rollback DELETE HTTP:", del.status);
      const final = await queue(before.context.queueId);
      console.log("Test item removed:", !final.some(x =>
        id(attr(x, "playQueueItemID")) === insertedId));
      const still = await timeline();
      console.log("Playback still playing:", still.state === "playing");
    } else {
      console.log("Could not identify a unique new queue item for rollback.");
      console.log("Inspect Plexamp Up Next manually if the test song remains.");
    }
  }
}
main().catch(e => { console.error("TEST STOPPED:", e.message); process.exitCode = 1; });
