"use strict";

/**
 * Prepare exactly ONE following song in Plexamp's existing play queue.
 * No playMedia/skipNext/pause/stop commands are issued here.
 *
 * A live queue and playing timeline are mandatory. On errors we leave
 * the current queue untouched rather than switching playback as fallback.
 */
const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false });
const asArray = (x) => x == null ? [] : Array.isArray(x) ? x : [x];
const attr = (obj, name) => String(obj?.["@_" + name] ?? "");
const validId = (id) => /^\d+$/.test(String(id || "")) ? String(id) : "";
const base = (s) => String(s || "").replace(/\/+$/, "");
const parseXML = (xml) => { try { return parser.parse(xml)?.MediaContainer || null; } catch { return null; } };

function parsePlayingTimeline(xml) {
  const mc = parseXML(xml);
  const music = asArray(mc?.Timeline).find(t => attr(t, "type") === "music");
  if (!music || attr(music, "state") !== "playing") return null;
  const queueId = validId(attr(music, "playQueueID"));
  const ratingKey = validId(attr(music, "ratingKey"));
  if (!queueId || !ratingKey) return null;
  return { queueId, ratingKey, itemId: validId(attr(music, "playQueueItemID")) };
}

function parsePlaylistIndex(xml) {
  const mc = parseXML(xml);
  const tracks = asArray(mc?.Track);
  const total = Number(attr(mc, "totalSize") || attr(mc, "size") || tracks.length);
  if (!Number.isSafeInteger(total) || total < 1 || !tracks.length ||
      tracks.length < total) return null; // Never silently sample a partial page.
  const entries = tracks.map(item => ({
    ratingKey: validId(attr(item, "ratingKey")),
    sectionId: validId(attr(item, "librarySectionID")),
  })).filter(item => item.ratingKey && item.sectionId);
  return entries.length ? entries : null;
}

function parseLibrarySections(xml) {
  const mc = parseXML(xml);
  const map = new Map();
  for (const section of asArray(mc?.Directory)) {
    const key = validId(attr(section, "key"));
    const uuid = attr(section, "uuid");
    if (key && /^[a-z0-9-]{8,}$/i.test(uuid)) map.set(key, uuid);
  }
  return map;
}

function createQueueHandoff({
  plexBase, plexampBase, plexToken, clientId, fetchWithTimeout,
  timeoutMs = 3000, random = Math.random, log = () => {},
}) {
  const server = base(plexBase);
  const player = base(plexampBase);
  let busy = false;
  let completedKey = "";
  let attemptedKey = "";
  let lastSongKey = "";
  let sectionMap = null;
  const recentPicks = [];
  const playlists = new Map();

  async function request(url, options) {
    const r = await fetchWithTimeout(url, timeoutMs, options);
    if (!r.ok) throw new Error("plex_http_" + r.status);
    return r.text();
  }
  function plexUrl(path, extra = {}) {
    const u = new URL(server + path);
    u.searchParams.set("X-Plex-Token", plexToken);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
    return u.toString();
  }
  async function timeline() {
    const u = new URL(player + "/player/timeline/poll");
    u.searchParams.set("wait", "0");
    u.searchParams.set("commandID", String(Date.now()));
    u.searchParams.set("X-Plex-Token", plexToken);
    u.searchParams.set("X-Plex-Target-Client-Identifier", clientId);
    return parsePlayingTimeline(await request(u.toString()));
  }
  async function chooseTrack(playlistKey, currentRatingKey) {
    let cached = playlists.get(playlistKey);
    if (!cached || Date.now() >= cached.until) {
      const xml = await request(plexUrl("/playlists/" + playlistKey + "/items", {
        "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 5000,
      }));
      const entries = parsePlaylistIndex(xml);
      if (!entries) throw new Error("playlist_empty_or_incomplete");
      cached = { entries, until: Date.now() + 30 * 60 * 1000 };
      playlists.set(playlistKey, cached);
    }
    const candidates = cached.entries.filter(track => track.ratingKey !== currentRatingKey &&
      !recentPicks.includes(track.ratingKey));
    const available = candidates.length ? candidates :
      cached.entries.filter(track => track.ratingKey !== currentRatingKey);
    if (!available.length) throw new Error("no_alternate_playlist_song");
    const roll = Number(random());
    const index = Math.floor((Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0.5) * available.length);
    return available[index];
  }
  async function getSectionUuid(sectionId) {
    if (!sectionMap || !sectionMap.has(sectionId)) {
      sectionMap = parseLibrarySections(await request(plexUrl("/library/sections")));
    }
    return sectionMap.get(sectionId) || "";
  }

  async function prepareNext({ playlistRatingKey, expectedRatingKey, isAllowed = () => true } = {}) {
    const playlistKey = validId(playlistRatingKey);
    const expected = validId(expectedRatingKey);
    if (!playlistKey || !expected || !server || !player || !plexToken || !clientId) {
      return { ok: false, reason: "missing_queue_context" };
    }
    if (busy) return { ok: false, reason: "busy" };
    if (!isAllowed()) return { ok: false, reason: "not_owner" };
    busy = true;
    try {
      const context = await timeline();
      if (!context || context.ratingKey !== expected) return { ok: false, reason: "playback_changed_or_stopped" };
      // Unique queue item is preferred to ratingKey: songs can repeat.
      const key = [context.queueId, context.itemId || context.ratingKey].join(":");
      if (key === completedKey || key === attemptedKey) return { ok: false, reason: "already_prepared_or_attempted" };
      const pick = await chooseTrack(playlistKey, expected);
      const uuid = await getSectionUuid(pick.sectionId);
      if (!uuid) return { ok: false, reason: "library_uuid_unavailable" };

      // Recheck after the network lookups: a track boundary or manual takeover
      // must cancel any stale request before the queue mutation.
      const stillPlaying = await timeline();
      if (!isAllowed() || !stillPlaying || stillPlaying.queueId !== context.queueId ||
          stillPlaying.ratingKey !== context.ratingKey ||
          (context.itemId && stillPlaying.itemId !== context.itemId)) {
        return { ok: false, reason: "playback_changed_before_enqueue" };
      }
      const uri = "library://" + uuid + "/item/library/metadata/" + pick.ratingKey;
      // Mark the attempt before PUT: if the response is lost, retrying could
      // enqueue a duplicate. A new playing track will obtain a new item key.
      attemptedKey = key;
      const endpoint = plexUrl("/playQueues/" + context.queueId, { uri, next: 1 });
      const response = await fetchWithTimeout(endpoint, timeoutMs, { method: "PUT" });
      if (!response.ok) throw new Error("queue_http_" + response.status);
      completedKey = key;
      recentPicks.push(pick.ratingKey);
      if (recentPicks.length > 12) recentPicks.shift();
      lastSongKey = pick.ratingKey;
      log("[playlist] queued one next song from playlist " + playlistKey +
          " (track=" + pick.ratingKey + ", queue=" + context.queueId + ")");
      return { ok: true, playlistKey, ratingKey: pick.ratingKey, queueId: context.queueId };
    } catch (e) {
      log("[playlist] queue handoff failed safely: " + e.message);
      return { ok: false, reason: e.message || "unknown_failure" };
    } finally {
      busy = false;
    }
  }
  return { prepareNext, snapshot: () => ({ busy, lastPreparedKey: completedKey, lastSongKey }) };
}

module.exports = { createQueueHandoff, parsePlayingTimeline, parsePlaylistIndex, parseLibrarySections };
