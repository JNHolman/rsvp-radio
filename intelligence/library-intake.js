"use strict";

/**
 * RSVP library intake inventory — analysis only. Never edits Plex, its queues,
 * playlists, source files, metadata, approvals, or the live radio runtime.
 *
 * The Plex *music library* is not the same thing as the set of RSVP playlists.
 * New recordings may be scanned into the former but not added to the latter.
 */
const path = require("node:path");
// CLI is downloaded to /tmp, while dependencies and config stay in the
// working RSVP checkout. Production use also starts with repo as cwd.
const root = process.cwd();
const { XMLParser } = require(path.join(root, "node_modules/fast-xml-parser"));
const { decodeXmlEntities } = require(path.join(root, "intelligence/plex-parser"));
const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false,
});
const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
const attr = (x, name) => String(x?.["@_" + name] ?? "");
const numeric = x => /^\d+$/.test(String(x || "")) ? String(x) : "";
const dec = x => decodeXmlEntities(String(x || "")).trim();
const DAY_MS = 86400000;
const REGGAE = /(?:^|[^a-z])(?:reggae|dancehall|ragga)(?:$|[^a-z])/i;
const AFROBEATS = /(?:^|[^a-z])(?:afrobeats?|afro[- ]?pop)(?:$|[^a-z])/i;

function parseSections(text) {
  const mc = parse(text);
  if (!mc) return null;
  return arr(mc.Directory)
    .filter(d => ["artist", "music", "8"].includes(attr(d, "type").toLowerCase()))
    .map(d => ({ id: numeric(attr(d, "key")), name: dec(attr(d, "title")) }))
    .filter(d => d.id);
}
function parse(text) {
  try { return xml.parse(text)?.MediaContainer || null; }
  catch { return null; }
}
function parseAudioPlaylists(text) {
  const mc = parse(text);
  if (!mc) return null;
  return [...arr(mc.Playlist), ...arr(mc.Metadata)]
    .filter(p => attr(p, "playlistType") === "audio")
    .map(p => ({ id: numeric(attr(p, "ratingKey")), name: dec(attr(p, "title")) }))
    .filter(p => p.id && p.name);
}
function parseTrackPage(text, { requireTotal = true } = {}) {
  const mc = parse(text);
  if (!mc) return null;
  const tracks = [...arr(mc.Track), ...arr(mc.Metadata)]
    .filter(x => attr(x, "type") === "" || attr(x, "type") === "track")
    .map(x => ({
      id: numeric(attr(x, "ratingKey")),
      title: dec(attr(x, "title")),
      artist: dec(attr(x, "grandparentTitle")),
      addedAt: /^\d+$/.test(attr(x, "addedAt")) ? Number(attr(x, "addedAt")) : null,
      genres: [...arr(x.Genre)].map(g => dec(attr(g, "tag"))).filter(Boolean),
    }));
  if (tracks.some(t => !t.id)) return null;
  const totalRaw = attr(mc, "totalSize");
  if (requireTotal && !/^\d+$/.test(totalRaw)) return null;
  const total = /^\d+$/.test(totalRaw) ? Number(totalRaw) : null;
  if (total !== null && (!Number.isSafeInteger(total) || total < tracks.length)) return null;
  return { total, tracks };
}

/** Require complete, stable pagination. No partial totals disguised as facts. */
async function loadPages(get, path, params = {}, { pageSize = 250, maxItems = 50000, requireTotal = true } = {}) {
  const result = [], seen = new Set();
  let expected; // undefined until first page; null means totalSize unavailable
  for (let start = 0; ; start += pageSize) {
    const text = await get(path, {
      ...params, "X-Plex-Container-Start": start, "X-Plex-Container-Size": pageSize,
    });
    const page = parseTrackPage(text, { requireTotal });
    if (!page) throw new Error("incomplete_or_unreadable_page: " + path + " @" + start);
    if (expected === undefined) {
      expected = page.total;
      if (expected !== null && expected > maxItems) throw new Error("safety_cap_exceeded: " + expected);
    }
    if (page.total !== expected) throw new Error("library_changed_during_scan");
    if (expected !== null && page.tracks.length === 0 && start < expected) {
      throw new Error("empty_middle_page");
    }
    for (const track of page.tracks) {
      if (seen.has(track.id)) throw new Error("duplicate_track_in_pages: " + track.id);
      seen.add(track.id);
      result.push(track);
    }
    if (result.length > maxItems) throw new Error("safety_cap_exceeded: " + result.length);
    if (expected !== null) {
      if (result.length === expected) return result;
      if (result.length > expected || page.tracks.length !== Math.min(pageSize, expected - start)) {
        throw new Error("pagination_incomplete");
      }
    } else if (page.tracks.length < pageSize) {
      // A playlist may omit totalSize; only a short/empty page ends the scan.
      return result;
    }
  }
}

function reviewReport({ libraryTracks, playlists, entriesByPlaylist, asOfMs = Date.now(), days = 30 }) {
  if (!Number.isFinite(asOfMs) || days < 1) throw new Error("invalid_audit_window");
  const knownTracks = new Map(), inPlaylists = new Set(), listedAt = new Map();
  for (const t of libraryTracks) {
    if (knownTracks.has(t.id)) throw new Error("duplicate_library_rating_key");
    knownTracks.set(t.id, t);
  }
  let playlistEntries = 0;
  for (const p of playlists) {
    const tracks = entriesByPlaylist.get(p.id);
    if (!tracks) throw new Error("missing_playlist_entries: " + p.name);
    playlistEntries += tracks.length;
    for (const item of tracks) {
      inPlaylists.add(item.id);
      if (!listedAt.has(item.id)) listedAt.set(item.id, []);
      listedAt.get(item.id).push({ playlist: p.name, ...item });
    }
  }
  const playlistOnly = [...listedAt.entries()]
    .filter(([id]) => !knownTracks.has(id))
    .map(([id, entries]) => ({ id, playlists: [...new Set(entries.map(x => x.playlist))],
      title: entries[0].title || "", artist: entries[0].artist || "" }));
  const latest = asOfMs - days * DAY_MS;
  const recent = libraryTracks.filter(t =>
    t.addedAt !== null && t.addedAt * 1000 >= latest && t.addedAt * 1000 <= asOfMs + DAY_MS);
  const outside = libraryTracks.filter(t => !inPlaylists.has(t.id));
  const recentOutside = recent.filter(t => !inPlaylists.has(t.id));
  const tagged = libraryTracks.filter(t => t.genres.length > 0);
  const reggae = libraryTracks.filter(t => t.genres.some(g => REGGAE.test(g)));
  const afrobeats = libraryTracks.filter(t => t.genres.some(g => AFROBEATS.test(g)));
  const sortNewest = tracks => [...tracks].sort((a,b) => (b.addedAt || 0) - (a.addedAt || 0));
  return {
    libraryTracks: libraryTracks.length,
    playlists: playlists.length,
    playlistEntries,
    uniquePlaylistTracks: inPlaylists.size,
    outsideCount: outside.length,
    playlistOnlyCount: playlistOnly.length,
    playlistOnly,
    recentCount: recent.length,
    recentOutsideCount: recentOutside.length,
    genreTagCoverage: tagged.length,
    missingAddedAt: libraryTracks.filter(t => t.addedAt === null).length,
    reggaeTaggedCount: reggae.length,
    reggaeTaggedOutside: reggae.filter(t => !inPlaylists.has(t.id)).length,
    afrobeatsTaggedCount: afrobeats.length,
    afrobeatsTaggedOutside: afrobeats.filter(t => !inPlaylists.has(t.id)).length,
    recentOutside: sortNewest(recentOutside).slice(0, 15),
    reggaeOutside: sortNewest(reggae.filter(t => !inPlaylists.has(t.id))).slice(0, 15),
    afrobeatsOutside: sortNewest(afrobeats.filter(t => !inPlaylists.has(t.id))).slice(0, 10),
    // A track outside the nine RSVP playlists may be unapproved, on purpose.
    // Never convert this report into an approval or admission decision.
    allPlaylistItemsInLibrary: playlistOnly.length === 0,
  };
}

module.exports = {
  parseSections, parseAudioPlaylists, parseTrackPage, loadPages, reviewReport,
};

/** One-shot no-write CLI. Browser and Plexamp are not contacted. */
async function runReadOnlyAudit() {
  require(path.join(root, "node_modules/dotenv"))
    .config({ path: path.join(root, ".env"), quiet: true });
  const cfg = require(path.join(root, "config"));
  const base = String(cfg.PLEX_BASE || "").replace(/\/+$/, "");
  if (!base || !cfg.PLEX_TOKEN) throw new Error("missing_Plex_configuration");
  const scanDays = 30;
  const get = async (endpoint, params = {}) => {
    const u = new URL(base + endpoint);
    u.searchParams.set("X-Plex-Token", cfg.PLEX_TOKEN);
    for (const [k,v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const res = await fetch(u, { method: "GET", signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error("Plex_READ_HTTP_" + res.status + ": " + endpoint);
    return res.text();
  };
  console.log("RSVP MUSIC LIBRARY INTAKE — READ ONLY");
  console.log("Comparing ALL Plex music tracks with currently listed RSVP audio playlists.");
  console.log("No write, no admission, no new manifest, no playback commands.\n");
  const sections = parseSections(await get("/library/sections"));
  if (!sections || !sections.length) throw new Error("no_explicit_music_library_sections_found");
  const playlists = parseAudioPlaylists(await get("/playlists"));
  if (!playlists) throw new Error("music_playlist_registry_unavailable");

  const libraryTracks = [];
  for (const section of sections) {
    console.log("Reading music library: " + section.name + " [" + section.id + "]");
    const tracks = await loadPages(get, "/library/sections/" + section.id + "/all", { type: 10 });
    console.log("  Tracks read: " + tracks.length);
    libraryTracks.push(...tracks);
  }
  const entriesByPlaylist = new Map();
  for (const list of playlists) {
    // Playlists are expected to be small; use the same complete paging check.
    const tracks = await loadPages(get, "/playlists/" + list.id + "/items", {}, {
      pageSize: 250, requireTotal: false, maxItems: 20000,
    });
    entriesByPlaylist.set(list.id, tracks);
    console.log("Playlist: " + list.name + " [" + list.id + "] — " + tracks.length + " tracks");
  }
  const report = reviewReport({ libraryTracks, playlists, entriesByPlaylist, days: scanDays });
  console.log("\n===== LIBRARY VERSUS PLAYLISTS =====");
  console.log("Full Plex music library tracks: " + report.libraryTracks);
  console.log("Audio playlists / entries: " + report.playlists + " / " + report.playlistEntries);
  console.log("Unique tracks in any current music playlist: " + report.uniquePlaylistTracks);
  console.log("Tracks outside all listed music playlists: " + report.outsideCount);
  console.log("Playlist IDs absent from scanned music library: " + report.playlistOnlyCount);
  for (const item of report.playlistOnly) {
    console.log("  " + item.id + " | " + (item.artist || "Unknown") + " — " +
      (item.title || "Untitled") + " | playlist: " + item.playlists.join(" / "));
  }
  console.log("Plex addedAt dates within " + scanDays + " days: " + report.recentCount);
  console.log("NOTE: addedAt means Plex ingestion time; a mass import can make older songs appear new.");
  console.log("Recent Plex-ingested tracks outside playlists: " + report.recentOutsideCount);
  console.log("Library tracks with no readable addedAt: " + report.missingAddedAt);
  console.log("\n===== GENRE TAGS (EVIDENCE ONLY) =====");
  console.log("Tracks with genre tags in library listing: " + report.genreTagCoverage +
    " / " + report.libraryTracks);
  console.log("Reggae/Dancehall-tagged tracks: " + report.reggaeTaggedCount +
    "; outside playlists: " + report.reggaeTaggedOutside);
  console.log("Afrobeats/Afropop keyword tag matches (may include hybrid tags): " + report.afrobeatsTaggedCount +
    "; outside playlists: " + report.afrobeatsTaggedOutside);
  console.log("These are Plex-tag keyword matches, NOT proof of the recording's true genre or approval.");
  const print = (title, tracks) => {
    console.log("\n" + title + ":");
    if (!tracks.length) console.log("  None detected from available tags/dates");
    for (const t of tracks) {
      console.log("  " + t.id + " | " + (t.artist || "Unknown") + " — " +
        (t.title || "Untitled") + " | " + (t.genres.join(", ") || "genre unknown"));
    }
  };
  print("Recent additions outside RSVP music playlists (up to 15)", report.recentOutside);
  print("Reggae/Dancehall-tagged tracks outside playlists (up to 15)", report.reggaeOutside);
  print("Afrobeats/Afropop-tagged tracks outside playlists (up to 10)", report.afrobeatsOutside);
  const toInspect = [
    ...new Map(
      [...report.recentOutside, ...report.reggaeOutside, ...report.afrobeatsOutside]
        .map(item => [item.id, item]),
    ).values(),
  ].slice(0, 25);
  console.log("\n===== FULL PLEX RECORDS FOR UNLISTED CANDIDATES =====");
  const detail = async id => {
    try {
      const mc = parse(await get("/library/metadata/" + id));
      const t = arr(mc?.Track)[0] || arr(mc?.Metadata)[0];
      if (!t) return { status: "record_not_returned" };
      const tagNames = key => arr(t[key]).map(x => dec(attr(x, "tag"))).filter(Boolean);
      return {
        status: "ok", year: attr(t, "year") || attr(t, "parentYear") || "unknown",
        moods: tagNames("Mood"), genres: tagNames("Genre"),
        album: dec(attr(t, "parentTitle")) || "unknown",
      };
    } catch (err) {
      return { status: "read_failed: " + err.message };
    }
  };
  for (const item of toInspect) {
    const meta = await detail(item.id);
    console.log("  " + item.id + " | " + item.artist + " — " + item.title +
      " | " + (meta.status === "ok"
        ? "year=" + meta.year + " | album=" + meta.album +
          " | genre=" + (meta.genres.join(", ") || "none") +
          " | mood=" + (meta.moods.slice(0, 5).join(", ") || "none")
        : meta.status));
  }
  // A missing listing may be stale or a library-scanning discrepancy.
  // Read records for diagnosis only; never delete/repair in this audit.
  if (report.playlistOnly.length) {
    console.log("\n===== INVESTIGATE PLAYLIST-ONLY TRACK IDs =====");
    for (const item of report.playlistOnly) {
      const meta = await detail(item.id);
      console.log("  " + item.id + " | " + item.playlists.join(" / ") +
        " | full Plex record: " + (meta.status === "ok"
          ? "exists, year=" + meta.year + ", album=" + meta.album
          : meta.status));
    }
  }
  console.log("\nDiscovery is NOT approval. No files, queues, playlists, or metadata changed.");
}
if (require.main === module) {
  runReadOnlyAudit().catch(err => {
    console.error("INTAKE READ STOPPED:", err.message);
    process.exitCode = 1;
  });
}
