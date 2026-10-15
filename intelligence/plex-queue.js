"use strict";

/**
 * Read-only Plex queue extraction for RSVP TV's Up Next panel.
 * Never guesses the next track from a playlist: it only returns verified
 * entries AFTER the active item of the currently reported Plex play queue.
 */
const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const validId = (value) => /^\d+$/.test(String(value || "")) ? String(value) : "";
const arr = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const attr = (v, name) => String(v?.["@_" + name] ?? "");
const str = (v) => v == null ? "" : String(v);

function parseCurrentQueueContext(xml, clientId = "") {
  if (!xml) return null;
  let container;
  try { container = parser.parse(xml)?.MediaContainer; } catch { return null; }
  if (!container) return null;
  const tracks = arr(container.Track);
  const plexamp = tracks.filter((track) => String(attr(track.Player, "product")).toLowerCase() === "plexamp");
  const current = clientId
    ? plexamp.find((track) => [attr(track.Player, "machineIdentifier"), attr(track.Player, "clientIdentifier")].includes(clientId))
    : plexamp[0];
  if (!current) return null;
  const qid = validId(attr(current, "playQueueID") || attr(current.Player, "playQueueID") || attr(container, "playQueueID"));
  if (!qid) return null;
  return {
    queueId: qid,
    itemId: validId(attr(current, "playQueueItemID") || attr(current.Player, "playQueueItemID")),
    ratingKey: validId(attr(current, "ratingKey")),
  };
}

function parseUpcomingQueue(payload, context, limit = 5) {
  const container = payload?.MediaContainer || {};
  if (!context || !Array.isArray(container.Metadata)) return { available: false, tracks: [], reason: "queue_unavailable" };
  const entries = container.Metadata;
  const desiredItem = context.itemId || validId(container.playQueueSelectedItemID);
  let activeIndex = desiredItem
    ? entries.findIndex((track) => validId(track.playQueueItemID) === desiredItem)
    : -1;
  if (activeIndex < 0 && context.ratingKey) {
    activeIndex = entries.findIndex((track) => validId(track.ratingKey) === context.ratingKey);
  }
  if (activeIndex < 0) {
    // A too-small window or stale queue must not become an invented "Up Next".
    return { available: false, tracks: [], reason: "current_track_not_in_queue" };
  }
  const max = Math.min(5, Math.max(1, Number(limit) || 5));
  return {
    available: true,
    tracks: entries.slice(activeIndex + 1, activeIndex + 1 + max).map(track => ({
      title: str(track.title),
      artist: str(track.grandparentTitle || track.originalTitle),
      album: str(track.parentTitle),
      thumb: str(track.thumb || track.parentThumb || track.grandparentThumb),
      ratingKey: validId(track.ratingKey),
    })),
    reason: "",
  };
}
module.exports = { parseCurrentQueueContext, parseUpcomingQueue };
