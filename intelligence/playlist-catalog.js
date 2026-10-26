"use strict";

/**
 * Live, read-only Plex playlist catalog with explicit owner-programmed pools.
 *
 * Clock modes intentionally do NOT imply a genre. The catalog only identifies
 * playable music playlists; the MUSIC_POOL_* environment variables decide
 * which sources belong in each block. New playlists are picked up automatically
 * when their exact approved names appear in the registry.
 */
const { XMLParser } = require("fast-xml-parser");
const { decodeXmlEntities } = require("./plex-parser");
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false,
});
const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
const attr = (x, key) => String(x?.["@_" + key] ?? "");
const clean = x => String(x || "").trim();
const normalize = x => clean(x).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const numericId = x => /^\d+$/.test(clean(x)) ? clean(x) : "";
const MODES = Object.freeze(["lofi", "lounge", "rap", "rnb"]);

function parseMusicCatalog(xml) {
  let mc;
  try { mc = parser.parse(xml)?.MediaContainer; } catch { return null; }
  if (!mc) return null;
  const result = [];
  const seen = new Set();
  for (const item of [...arr(mc.Playlist), ...arr(mc.Metadata)]) {
    const id = numericId(attr(item, "ratingKey"));
    const name = clean(decodeXmlEntities(attr(item, "title")));
    const media = clean(attr(item, "playlistType")).toLowerCase();
    if (!id || !name || media !== "audio" || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, name });
  }
  return result;
}

function parsePoolNames(value) {
  const names = [];
  const seen = new Set();
  for (const name of clean(value).split("|").map(clean).filter(Boolean)) {
    const key = normalize(name);
    if (seen.has(key)) continue;
    names.push(name);
    seen.add(key);
  }
  return names;
}

function createPlaylistCatalog({
  plexBase, plexToken, fetchWithTimeout, timeoutMs = 3000,
  pools = {}, ttlMs = 60_000, random = Math.random, log = () => {},
}) {
  const configured = Object.fromEntries(MODES.map(mode => [mode, parsePoolNames(pools[mode])]));
  const base = clean(plexBase).replace(/\/+$/, "");
  let snapshot = null;
  let fetchedAt = 0;
  let inFlight = null;

  async function getMusicPlaylists({ force = false } = {}) {
    if (!force && snapshot && Date.now() - fetchedAt < ttlMs) return snapshot;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (!base || !plexToken) throw new Error("missing_plex_credentials");
      const u = new URL(base + "/playlists");
      u.searchParams.set("X-Plex-Token", plexToken);
      const resp = await fetchWithTimeout(u.toString(), timeoutMs);
      if (!resp.ok) throw new Error("plex_http_" + resp.status);
      const registry = parseMusicCatalog(await resp.text());
      if (registry === null) throw new Error("unreadable_playlist_registry");
      snapshot = registry;
      fetchedAt = Date.now();
      return registry;
    })();
    try { return await inFlight; }
    finally { inFlight = null; }
  }

  async function resolveMode(mode, { deterministic = false, bridgeFrom = "", bridgeTo = "", preferPlaylistKey = "", bridgeStrength = 1 } = {}) {
    if (!MODES.includes(mode)) return { ok: false, reason: "invalid_mode" };
    const names = configured[mode];
    if (!names.length) return { ok: false, reason: "unassigned_mode_pool" };
    let live;
    try { live = await getMusicPlaylists(); }
    catch (err) {
      log("[playlist-catalog] registry unavailable: " + err.message);
      return { ok: false, reason: "registry_unavailable" };
    }
    const liveNames = new Map(live.map(p => [normalize(p.name), p]));
    const eligible = names.map(name => liveNames.get(normalize(name))).filter(Boolean);
    if (!eligible.length) return { ok: false, reason: "no_approved_playlists_available" };

    // During the early song-driven handoff, prefer sources that belong to BOTH
    // adjacent blocks. This narrows the jump from a random entire-era pool.
    // If there is no shared approved source, leave existing selection intact.
    // Only exact approved live playlist names are eligible; never infer a genre.
    const bridgeRequested = MODES.includes(bridgeFrom) && MODES.includes(bridgeTo) &&
      bridgeFrom !== bridgeTo && (mode === bridgeFrom || mode === bridgeTo);
    let choices = eligible;
    const weight = Math.max(0, Math.min(1, Number(bridgeStrength) || 0));
    let usingBridge = false;
    if (bridgeRequested && weight > 0) {
      const other = mode === bridgeFrom ? bridgeTo : bridgeFrom;
      const shared = new Set(configured[other].map(normalize));
      const overlap = eligible.filter(item => shared.has(normalize(item.name)));
      // Shared-source preference fades as the new block gradually takes over.
      if (overlap.length && (deterministic || Number(random()) < weight)) {
        choices = overlap;
        usingBridge = true;
      }
    }

    // Keep the previous automatically selected source when it belongs to the
    // shared pool, rather than randomly jumping between approved eras.
    const preferred = !deterministic && usingBridge
      ? choices.find(item => item.id === String(preferPlaylistKey || "")) : null;
    const roll = Number(random());
    const position = deterministic ? 0 :
      Math.floor((Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0.5) * choices.length);
    const selected = preferred || choices[position];
    return { ok: true, playlistKey: selected.id, name: selected.name, mode };
  }

  // Legacy skip-driven lanes may declare numeric playlist IDs. Only resolve
  // them when their current identity is verified in the LIVE music registry.
  async function resolveLane(id) {
    const key = numericId(id);
    if (!key) return { ok: false, reason: "invalid_lane_id" };
    try {
      const live = await getMusicPlaylists();
      const playlist = live.find(p => p.id === key);
      return playlist
        ? { ok: true, playlistKey: playlist.id, name: playlist.name }
        : { ok: false, reason: "lane_not_in_music_registry" };
    } catch (_) { return { ok: false, reason: "registry_unavailable" }; }
  }

  return {
    resolveMode, resolveLane, getMusicPlaylists,
    configuration: () => Object.fromEntries(MODES.map(mode => [mode, [...configured[mode]]])),
  };
}

module.exports = { createPlaylistCatalog, parseMusicCatalog, parsePoolNames, MODES };
