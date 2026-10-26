"use strict";

/**
 * Full-record Plex music metadata reader for future DJ-style programming.
 *
 * Full /library/metadata/:ratingKey responses provide year and some mood tags
 * missing from the short playlist endpoint. Preserve values as facts; NEVER
 * infer energy, groove, RSVP neighborhoods or clean/dirty status from an
 * artist, decade, genre name, star rating, or absent metadata.
 *
 * Read-only and inert: no calls from the live queue scheduler until the owner
 * approves a concrete programming/transition policy.
 */
const { XMLParser } = require("fast-xml-parser");
const { decodeXmlEntities } = require("./plex-parser");

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false,
});
const arr = value => value == null ? [] : Array.isArray(value) ? value : [value];
const attr = (value, key) => String(value?.["@_" + key] ?? "");
const id = value => /^\d+$/.test(String(value || "")) ? String(value) : "";
const dec = value => decodeXmlEntities(String(value || "")).trim();
const tags = (record, type) =>
  [...new Set(arr(record?.[type]).map(value => dec(attr(value, "tag"))).filter(Boolean))];

function parseMusicProfile(xml) {
  let mc;
  try { mc = parser.parse(xml)?.MediaContainer; }
  catch { return null; }
  const record = arr(mc?.Track)[0] || arr(mc?.Metadata)[0];
  if (!record) return null;
  const ratingKey = id(attr(record, "ratingKey"));
  if (!ratingKey) return null;
  const rawYear = attr(record, "year") || attr(record, "parentYear");
  const year = /^(18|19|20|21)\d{2}$/.test(rawYear) ? Number(rawYear) : null;
  const originalDate = attr(record, "originallyAvailableAt");
  const rawRating = attr(record, "userRating");
  const userRating = rawRating !== "" && Number.isFinite(Number(rawRating)) &&
    Number(rawRating) >= 0 && Number(rawRating) <= 10
    ? Number(rawRating) : null;
  return {
    ratingKey,
    title: dec(attr(record, "title")),
    artist: dec(attr(record, "grandparentTitle")),
    album: dec(attr(record, "parentTitle")),
    year,
    originalDate: /^\d{4}-\d{2}-\d{2}$/.test(originalDate) ? originalDate : null,
    genre: tags(record, "Genre"),
    mood: tags(record, "Mood"),
    style: tags(record, "Style"),
    userRating, // owner preference; NEVER interpreted as song energy
    // Release year may describe a remaster/reissue rather than the original.
    // Values not provided by Plex are explicitly unknown, never estimated.
    programming: {
      neighborhoods: [],
      moodClass: null,
      energy: null,
      groove: null,
      cleanDirty: null,
    },
  };
}

function createMusicProfileReader({
  plexBase, plexToken, fetchWithTimeout, timeoutMs = 3000,
  ttlMs = 30 * 60_000, maxEntries = 512,
}) {
  const base = String(plexBase || "").replace(/\/+$/, "");
  const token = String(plexToken || "");
  const cache = new Map();
  const inflight = new Map();

  async function get(ratingKey) {
    const key = id(ratingKey);
    if (!key) return { ok: false, reason: "invalid_track_id" };
    if (!base || !token || typeof fetchWithTimeout !== "function") {
      return { ok: false, reason: "missing_plex_configuration" };
    }
    const saved = cache.get(key);
    if (saved && Date.now() - saved.at < ttlMs) return { ok: true, profile: saved.profile, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      try {
        const u = new URL(base + "/library/metadata/" + key);
        u.searchParams.set("X-Plex-Token", token);
        const response = await fetchWithTimeout(u.toString(), timeoutMs);
        if (!response.ok) return { ok: false, reason: "plex_http_" + response.status };
        const profile = parseMusicProfile(await response.text());
        if (!profile || profile.ratingKey !== key) return { ok: false, reason: "unreadable_track_metadata" };
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(key, { at: Date.now(), profile });
        return { ok: true, profile, cached: false };
      } catch (error) {
        return { ok: false, reason: "metadata_read_failed" };
      }
    })();
    inflight.set(key, job);
    try { return await job; }
    finally { inflight.delete(key); }
  }

  return { get, clear: () => cache.clear() };
}

module.exports = { parseMusicProfile, createMusicProfileReader };
