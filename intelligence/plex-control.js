"use strict";

/**
 * intelligence/plex-control.js
 *
 * Minimal Plex/Plexamp control surface used by playlist steering.
 * It discovers configured playlists, creates a shuffled Plex play queue,
 * then asks the local Plexamp Companion endpoint to play that queue.
 */

const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function timeoutFetch(fetchImpl, url, ms, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetchImpl(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function listAudioPlaylists({ fetchImpl = fetch, plexBase, plexToken, timeoutMs = 4000 }) {
  const url = new URL("/playlists", plexBase);
  url.searchParams.set("X-Plex-Token", plexToken);

  const res = await timeoutFetch(fetchImpl, url, timeoutMs);
  if (!res.ok) throw new Error(`playlist_list_http_${res.status}`);

  const doc = parser.parse(await res.text());
  return asArray(doc?.MediaContainer?.Playlist)
    .filter((p) => String(p?.["@_playlistType"] || "").toLowerCase() === "audio")
    .map((p) => ({
      ratingKey: String(p?.["@_ratingKey"] || ""),
      title: String(p?.["@_title"] || ""),
      smart: String(p?.["@_smart"] || "0") === "1",
    }))
    .filter((p) => p.ratingKey && p.title);
}

async function resolveConfiguredLanes(opts, laneConfig) {
  const playlists = await listAudioPlaylists(opts);
  const byTitle = new Map(playlists.map((p) => [p.title, p]));
  const resolved = {};

  for (const [mode, lanes] of Object.entries(laneConfig || {})) {
    resolved[mode] = lanes
      .map((lane) => {
        const playlist = byTitle.get(lane.title);
        return playlist ? { ...lane, ratingKey: playlist.ratingKey } : null;
      })
      .filter(Boolean);
  }

  return { playlists, lanes: resolved };
}

async function serverIdentity({ fetchImpl = fetch, plexBase, plexToken, timeoutMs = 4000 }) {
  const url = new URL("/identity", plexBase);
  url.searchParams.set("X-Plex-Token", plexToken);
  const res = await timeoutFetch(fetchImpl, url, timeoutMs);
  if (!res.ok) throw new Error(`plex_identity_http_${res.status}`);
  const doc = parser.parse(await res.text());
  const id = String(doc?.MediaContainer?.["@_machineIdentifier"] || "");
  if (!id) throw new Error("plex_identity_missing_machineIdentifier");
  return id;
}

async function createPlaylistQueue({
  fetchImpl = fetch,
  plexBase,
  plexToken,
  playlistRatingKey,
  timeoutMs = 4000,
}) {
  const url = new URL("/playQueues", plexBase);
  url.searchParams.set("type", "audio");
  url.searchParams.set("playlistID", playlistRatingKey);
  url.searchParams.set("shuffle", "1");
  url.searchParams.set("repeat", "0");
  url.searchParams.set("continuous", "1");
  url.searchParams.set("X-Plex-Token", plexToken);

  const res = await timeoutFetch(fetchImpl, url, timeoutMs, { method: "POST" });
  if (!res.ok) throw new Error(`playqueue_create_http_${res.status}`);

  const doc = parser.parse(await res.text());
  const mc = doc?.MediaContainer || {};
  const queueId = String(mc?.["@_playQueueID"] || "");
  const selected = asArray(mc?.Track)[0] || {};
  const selectedKey = String(selected?.["@_key"] || "");

  if (!queueId || !selectedKey) throw new Error("playqueue_create_invalid_response");
  return { queueId, selectedKey };
}

async function playQueueOnPlexamp({
  fetchImpl = fetch,
  plexampBase,
  plexBase,
  plexToken,
  machineIdentifier,
  targetClientIdentifier,
  queueId,
  selectedKey,
  commandId,
  timeoutMs = 4000,
}) {
  const serverUrl = new URL(plexBase);
  const url = new URL("/player/playback/playMedia", plexampBase);

  url.searchParams.set("providerIdentifier", "com.plexapp.plugins.library");
  url.searchParams.set("machineIdentifier", machineIdentifier);
  url.searchParams.set("protocol", serverUrl.protocol.replace(":", ""));
  url.searchParams.set("address", serverUrl.hostname);
  url.searchParams.set("port", serverUrl.port || (serverUrl.protocol === "https:" ? "443" : "80"));
  url.searchParams.set("offset", "0");
  url.searchParams.set("key", selectedKey);
  url.searchParams.set("type", "music");
  url.searchParams.set("containerKey", `/playQueues/${queueId}?window=100&own=1`);
  url.searchParams.set("commandID", String(commandId));
  url.searchParams.set("X-Plex-Client-Identifier", "rsvp-radio");
  url.searchParams.set("X-Plex-Token", plexToken);
  if (targetClientIdentifier) {
    url.searchParams.set("X-Plex-Target-Client-Identifier", targetClientIdentifier);
  }

  const res = await timeoutFetch(fetchImpl, url, timeoutMs);
  if (!res.ok) throw new Error(`plexamp_play_http_${res.status}`);
  return true;
}

module.exports = {
  listAudioPlaylists,
  resolveConfiguredLanes,
  serverIdentity,
  createPlaylistQueue,
  playQueueOnPlexamp,
};
