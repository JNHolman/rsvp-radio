"use strict";

/**
 * intelligence/plex-parser.js — RSVP Radio / TV Plex XML parser
 *
 * Pure parsing of Plex /status/sessions XML responses.
 * No I/O — receives an XML string, returns a structured session or null.
 *
 * Two paths:
 *   1. Structured (preferred) — uses fast-xml-parser when available.
 *   2. Regex shim fallback — used when fast-xml-parser isn't installed
 *      or the document fails to parse. Mirrors the structured path's
 *      filtering rules (paused/buffering/stopped video filtered out).
 *
 * Design goals:
 *   - Tests now hit real exported functions instead of duplicating regex
 *     literals.
 *   - clientId-aware Plexamp detection lives in one place.
 *   - server.js shrinks from a 1300-line monolith into something narrower.
 */

let xmlParse = null;
try {
  const { XMLParser } = require("fast-xml-parser");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Plex XML only needs normal attributes/text. Disable DTD/entity expansion
    // in the general-purpose parser and decode the small XML entity subset we
    // actually need ourselves below.
    processEntities: false,
    htmlEntities: false,
  });
  xmlParse = (xml) => parser.parse(xml);
} catch {
  // Caller will see hasStructuredParser() === false and tests can mock if needed.
}

function hasStructuredParser() { return !!xmlParse; }

// ── Regex helpers (pure, no module state) ────────────────────────────────────

function _attr(openTag, name) {
  const m = openTag.match(new RegExp("\\s" + name + '="([^"]*)"', "i"));
  return m ? decodeXmlEntities(m[1]) : "";
}

function _first(str, re) {
  const m = str.match(re);
  return m ? m[0] : "";
}

function _trackBlocks(xml) {
  const full = xml.match(/<Track\b[^>]*>[\s\S]*?<\/Track>/gi) || [];
  const self = xml.match(/<Track\b[^>]*\/>/gi) || [];
  return full.length ? full : self;
}

function _videoBlocks(xml) {
  const full = xml.match(/<Video\b[^>]*>[\s\S]*?<\/Video>/gi) || [];
  const self = xml.match(/<Video\b[^>]*\/>/gi) || [];
  return full.length ? full : self;
}

// ── Structured-path extractor ────────────────────────────────────────────────

function _extractItem(item, isVideoType) {
  const a = (k) => decodeXmlEntities(item[`@_${k}`] || "");
  const p = item.Player || {};
  const media         = item.Media ? (Array.isArray(item.Media) ? item.Media[0] : item.Media) : null;
  const part          = media?.Part ? (Array.isArray(media.Part) ? media.Part[0] : media.Part) : null;
  const localFilePath = decodeXmlEntities(part?.["@_file"] || "").trim();
  return {
    type:         isVideoType ? "video" : (a("type") || "track"),
    title:        a("title"),
    artist:       a("grandparentTitle") || a("originalTitle") || a("title") || "",
    album:        a("parentTitle") || "",
    thumb:        a("thumb") || a("parentThumb") || a("grandparentThumb") || "",
    ratingKey:    a("ratingKey") || a("key") || "",
    viewOffsetMs: Number(a("viewOffset")) || 0,
    durationMs:   Number(a("duration"))   || 0,
    playerState:  (p["@_state"] || "playing").toLowerCase(),
    isVideo:      isVideoType,
    localFilePath,
  };
}

// ── parseSessions — main entry ───────────────────────────────────────────────
//
// Parses a Plex /status/sessions XML body and returns a single normalized
// session object (or null when nothing active).
//
// options.targetClientId — preferred Plex client UUID for video sessions
//                          (e.g. PLEX_TARGET_CLIENT_IDENTIFIER). Used to pick
//                          between multiple concurrent sessions.
//
// Filtering rules (applied to BOTH structured and regex paths for parity):
//   - Video: only "playing" or missing-state surfaces. paused/buffering/
//     stopped/etc all fall through to the Track branch.
//   - Track: Plexamp-product tracks are preferred; falls back to first track.

function parseSessions(xml, options = {}) {
  const targetId = options.targetClientId || "";
  const ignoreVideo = options.ignoreVideo === true;

  // ── Structured path ──────────────────────────────────────────────────────
  if (xmlParse) {
    try {
      const doc = xmlParse(xml);
      const mc  = doc?.MediaContainer;
      if (!mc) return null;

      // Video session has priority unless it's not playing.
      // Allowlist for "active": empty/missing state OR explicit "playing".
      // Anything else (paused, stopped, buffering, ...) falls through to track.
      // Match the regex fallback behavior so both parser paths agree.
      const isVideoActive = (v) => {
        const s = (v?.Player?.["@_state"] || "").toLowerCase();
        return s === "" || s === "playing";
      };
      if (!ignoreVideo && mc.Video) {
        let videos = mc.Video;
        if (!Array.isArray(videos)) videos = [videos];

        const playingSessions = videos.filter(isVideoActive);

        // Within active sessions, prefer targetClientId, then local, then first.
        const video =
          (targetId && playingSessions.find((v) =>
            (v?.Player?.["@_machineIdentifier"] || "") === targetId ||
            (v?.Player?.["@_clientIdentifier"]  || "") === targetId
          )) ||
          playingSessions.find((v) =>
            v?.Player?.["@_local"] === "1" || v?.Player?.["@_local"] === true
          ) ||
          playingSessions[0];

        if (video && isVideoActive(video)) {
          return _extractItem(video, true);
        }
        // No active video — fall through to track.
      }

      let tracks = mc.Track;
      if (!tracks) return null;
      if (!Array.isArray(tracks)) tracks = [tracks];
      const track =
        tracks.find((t) => t?.Player?.["@_product"] === "Plexamp") || tracks[0];
      if (!track) return null;
      return _extractItem(track, false);
    } catch (_) {
      // Fall through to regex shim.
    }
  }

  // ── Regex shim fallback ──────────────────────────────────────────────────
  // Keep fallback priority order identical to the structured parser.
  //   1. activeVideoBlocks filtered by allowlist (state="" or "playing")
  //   2. among those, prefer one whose Player.machineIdentifier or
  //      Player.clientIdentifier equals targetId
  //   3. otherwise, prefer one with Player.local="1"/"true"
  //   4. otherwise, first active block
  // Do not simply take the first active block; prefer the intended player/media
  // targetClientId entirely — could pick the wrong client when multiple
  // video sessions were active.
  const videoBlocks = ignoreVideo ? [] : _videoBlocks(xml);
  const activeVideoBlocks = videoBlocks.filter((b) => {
    const playerTag = _first(b, /<Player\b[^>]*>/i);
    if (!playerTag) return true; // no Player tag → assume active
    const state = _attr(playerTag, "state").toLowerCase();
    return state === "" || state === "playing";
  });

  const videoBlock =
    (targetId && activeVideoBlocks.find((b) => {
      const playerTag = _first(b, /<Player\b[^>]*>/i);
      if (!playerTag) return false;
      return _attr(playerTag, "machineIdentifier") === targetId ||
             _attr(playerTag, "clientIdentifier")  === targetId;
    })) ||
    activeVideoBlocks.find((b) => {
      const playerTag = _first(b, /<Player\b[^>]*>/i);
      if (!playerTag) return false;
      const local = _attr(playerTag, "local");
      return local === "1" || local === "true";
    }) ||
    activeVideoBlocks[0];

  if (videoBlock) {
    const block   = videoBlock;
    const openTag = _first(block, /<Video\b[^>]*\/?>/i);
    if (openTag) {
      const playerTag = _first(block, /<Player\b[^>]*>/i);
      const partTag   = _first(block, /<Part\b[^>]*\/?>/i);
      return {
        type:         "video",
        title:        _attr(openTag, "title"),
        artist:       _attr(openTag, "grandparentTitle") || _attr(openTag, "originalTitle") || _attr(openTag, "title") || "",
        album:        _attr(openTag, "parentTitle") || "",
        thumb:        _attr(openTag, "thumb") || _attr(openTag, "parentThumb") || _attr(openTag, "grandparentThumb") || "",
        ratingKey:    _attr(openTag, "ratingKey") || _attr(openTag, "key") || "",
        viewOffsetMs: Number(_attr(openTag, "viewOffset")) || 0,
        durationMs:   Number(_attr(openTag, "duration"))   || 0,
        playerState:  (playerTag ? _attr(playerTag, "state") : "playing").toLowerCase(),
        isVideo:      true,
        localFilePath: partTag ? _attr(partTag, "file") : "",
      };
    }
  }

  const blocks = _trackBlocks(xml);
  if (!blocks.length) return null;
  const block   = blocks.find((b) => /<Player\b[^>]*product="Plexamp"/i.test(b)) || blocks[0];
  const openTag = _first(block, /<Track\b[^>]*\/?>/i);
  if (!openTag) return null;
  let playerTag = _first(block, /<Player\b[^>]*>/i);
  if (!playerTag) playerTag = _first(xml, /<Player\b[^>]*product="Plexamp"[^>]*>/i);
  const partTag = _first(block, /<Part\b[^>]*\/?>/i);
  return {
    type:         _attr(openTag, "type") || "track",
    title:        _attr(openTag, "title"),
    artist:       _attr(openTag, "grandparentTitle") || _attr(openTag, "originalTitle") || "",
    album:        _attr(openTag, "parentTitle") || "",
    thumb:        _attr(openTag, "thumb") || _attr(openTag, "parentThumb") || _attr(openTag, "grandparentThumb") || "",
    ratingKey:    _attr(openTag, "ratingKey") || _attr(openTag, "key") || "",
    viewOffsetMs: Number(_attr(openTag, "viewOffset")) || 0,
    durationMs:   Number(_attr(openTag, "duration"))   || 0,
    playerState:  (playerTag ? _attr(playerTag, "state") : "playing").toLowerCase(),
    isVideo:      false,
    localFilePath: partTag ? _attr(partTag, "file") : "",
  };
}

// ── isPlexampPlaying — pure XML check for Plexamp playing state ──────────────
//
// Two-stage: first identify Plexamp Player tags, then check state. Lookaheads
// make this attribute-order safe (Plex sometimes emits state before product
// or vice versa).
//
// options.plexampClientId — when set, additionally requires that the matched
//                           Player tag's machineIdentifier/clientIdentifier
//                           equals this value. Lets the deployment ignore
//                           Plexamp clients that aren't the configured Pi.

function isPlexampPlaying(xml, options = {}) {
  if (!xml) return false;
  const wantClientId = options.plexampClientId || "";

  // Try structured path first when available — gives us proper attribute access
  // for the clientId match.
  if (xmlParse) {
    try {
      const doc = xmlParse(xml);
      const mc  = doc?.MediaContainer;
      let tracks = mc?.Track;
      if (tracks) {
        if (!Array.isArray(tracks)) tracks = [tracks];
        return tracks.some((t) => {
          const p = t?.Player || {};
          if ((p["@_product"] || "") !== "Plexamp") return false;
          if ((p["@_state"]   || "").toLowerCase() !== "playing") return false;
          if (!wantClientId) return true;
          return (p["@_machineIdentifier"] || "") === wantClientId ||
                 (p["@_clientIdentifier"]  || "") === wantClientId;
        });
      }
      // No tracks at all — nothing to match.
      return false;
    } catch (_) {
      // Fall through to regex.
    }
  }

  // Regex fallback. Lookaheads make attribute order irrelevant.
  // First find any Plexamp Player tag in playing state.
  const tagRe = /<Player\b(?=[^>]*\bproduct="Plexamp")(?=[^>]*\bstate="playing")[^>]*>/gi;
  const matches = xml.match(tagRe) || [];
  if (matches.length === 0) return false;
  if (!wantClientId) return true;
  // ClientId match — use _attr to inspect each candidate.
  return matches.some((tag) => {
    return _attr(tag, "machineIdentifier") === wantClientId ||
           _attr(tag, "clientIdentifier")  === wantClientId;
  });
}

// ── parseMediaPart — extract local file path from /library/metadata XML ─────
//
// Used by the /media/:ratingKey route to find the on-disk file path for a
// given track/video/photo so it can be streamed to the kiosk.
//
// Returns the file path string, or "" if not found / on parse error.
// Tries structured parser first, falls back to regex with XML entity decode.

// Decode XML entities — both named (&amp; &quot; etc.) and numeric (&#233; &#xE9;).
// Plex emits numeric entities for non-ASCII characters in file paths
// (Victoria Monét → "Victoria Mon&#233;t"). If we don't decode these before
// fs.stat(), every accented filename returns ENOENT.
//
// Important: ampersand last in the named-entity pass so we don't double-decode
// something like "&amp;quot;" → "&quot;" → '"' (which would be wrong if the
// original literal text contained "&amp;quot;"). Standard XML decode order.
function decodeXmlEntities(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); }
      catch (_e) { return ""; }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); }
      catch (_e) { return ""; }
    })
    .replace(/&amp;/g,  "&");
}

function parseMediaPart(xml) {
  if (!xml) return "";

  if (xmlParse) {
    try {
      const doc  = xmlParse(xml);
      const mc   = doc?.MediaContainer;
      const item = mc?.Track || mc?.Video || mc?.Photo;
      if (item) {
        const first = Array.isArray(item) ? item[0] : item;
        const media = first?.Media ? (Array.isArray(first.Media) ? first.Media[0] : first.Media) : null;
        const part  = media?.Part  ? (Array.isArray(media.Part)  ? media.Part[0]  : media.Part)  : null;
        const file  = part?.["@_file"] || "";
        // Defensive decode — fast-xml-parser USUALLY handles entities, but
        // some versions/configs leave numeric entities (&#233;) in place.
        // Decoding twice on already-decoded text is a no-op since "é" has
        // no entity form to match.
        if (file) return decodeXmlEntities(file);
      }
    } catch (_) {
      // Fall through to regex.
    }
  }

  // Regex fallback — manual decode required.
  const m = xml.match(/<Part\b[^>]*\sfile="([^"]+)"/i);
  if (m) return decodeXmlEntities(m[1]);
  return "";
}

module.exports = {
  parseSessions,
  isPlexampPlaying,
  parseMediaPart,
  decodeXmlEntities,
  hasStructuredParser,
  // Exported for unit tests that want to drive the regex helpers directly.
  _attr,
  _first,
  _trackBlocks,
  _videoBlocks,
};