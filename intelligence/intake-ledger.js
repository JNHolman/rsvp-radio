"use strict";

/**
 * Private, read-only-in-production RSVP music intake baseline.
 *
 * A scanner supplies COMPLETE current Plex library Track rows. This module
 * builds an immutable snapshot and compares subsequent scans, allowing RSVP
 * to identify candidate additions without trusting Plex addedAt, which resets
 * after a bulk import. Never changes a song, playlist, queue, rating or status.
 *
 * A stable file-path HASH (not the path itself) may help detect a Plex ratingKey
 * reindex. Without it, the same artist/title is only a POSSIBLE reindex and
 * never auto-approved or silently matched: remixes and alternate recordings
 * can legitimately have the same title.
 */
const { createHash } = require("node:crypto");
const VERSION = 1;
const numeric = value => /^\d+$/.test(String(value || "")) ? String(value) : "";
const clean = value => String(value || "").trim();
const normalized = value => clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g," ");
const pathHash = file => {
  const raw = clean(file);
  return raw ? createHash("sha256").update(raw).digest("hex") : null;
};

function snapshot(tracks, now = new Date().toISOString()) {
  if (!Array.isArray(tracks) || Number.isNaN(Date.parse(now))) {
    throw new Error("invalid_snapshot_input");
  }
  const seen = new Set();
  const entries = tracks.map(t => {
    const id = numeric(t.id);
    if (!id || seen.has(id)) throw new Error("invalid_or_duplicate_track_id");
    seen.add(id);
    return {
      id,
      artist: clean(t.artist),
      title: clean(t.title),
      // A locally derived hash cannot expose a private Pi audio-file path.
      fileHash: clean(t.fileHash) || pathHash(t.filePath || ""),
      // Metadata below is descriptive only, not an approval/energy judgment.
      genres: [...new Set((t.genres || []).map(clean).filter(Boolean))],
    };
  }).sort((a,b) => Number(a.id) - Number(b.id));
  return { version: VERSION, scannedAt: now, tracks: entries };
}

function validateSnapshot(data) {
  if (!data || data.version !== VERSION || !Array.isArray(data.tracks) ||
      Number.isNaN(Date.parse(data.scannedAt))) throw new Error("unsupported_intake_snapshot");
  const ids = new Set();
  for (const t of data.tracks) {
    if (!numeric(t.id) || ids.has(t.id) || typeof t.title !== "string" ||
        typeof t.artist !== "string" || (t.fileHash !== null &&
          !/^[a-f0-9]{64}$/.test(t.fileHash)) || !Array.isArray(t.genres)) {
      throw new Error("invalid_intake_snapshot");
    }
    ids.add(t.id);
  }
  return data;
}

function compareSnapshots(previous, current) {
  validateSnapshot(previous);
  validateSnapshot(current);
  const earlier = new Map(previous.tracks.map(t => [t.id, t]));
  const latest = new Map(current.tracks.map(t => [t.id, t]));
  const newlySeen = current.tracks.filter(t => !earlier.has(t.id));
  const missing = previous.tracks.filter(t => !latest.has(t.id));
  const changed = current.tracks.filter(t => {
    const before = earlier.get(t.id);
    return before && (before.title !== t.title || before.artist !== t.artist ||
      before.fileHash !== t.fileHash ||
      JSON.stringify(before.genres) !== JSON.stringify(t.genres));
  });
  // Only a UNIQUE matching path hash is strong enough to reconcile old/new
  // ratingKeys automatically. Reusing an artist/title is never sufficient.
  const oldByHash = new Map(), newByHash = new Map();
  for (const t of missing) if (t.fileHash) {
    oldByHash.set(t.fileHash, [...(oldByHash.get(t.fileHash) || []), t]);
  }
  for (const t of newlySeen) if (t.fileHash) {
    newByHash.set(t.fileHash, [...(newByHash.get(t.fileHash) || []), t]);
  }
  const remappedOld = new Set(), remappedNew = new Set(), reindexed = [];
  for (const [hash, olds] of oldByHash) {
    const news = newByHash.get(hash) || [];
    if (olds.length !== 1 || news.length !== 1) continue;
    reindexed.push({ oldId: olds[0].id, newId: news[0].id,
      title: news[0].title, artist: news[0].artist });
    remappedOld.add(olds[0].id);
    remappedNew.add(news[0].id);
  }
  const candidateNew = newlySeen.filter(t => !remappedNew.has(t.id));
  const candidateMissing = missing.filter(t => !remappedOld.has(t.id));
  const oldByTitle = new Map();
  for (const t of candidateMissing) {
    const key = normalized(t.artist) + "|" + normalized(t.title);
    oldByTitle.set(key, [...(oldByTitle.get(key) || []), t]);
  }
  const uncertain = [];
  for (const t of candidateNew) {
    const similar = oldByTitle.get(normalized(t.artist) + "|" + normalized(t.title)) || [];
    if (similar.length) uncertain.push({ newId: t.id, previousIds: similar.map(x => x.id),
      artist: t.artist, title: t.title, reason: "possibly_reindexed_or_different_version" });
  }
  return {
    previousCount: previous.tracks.length,
    currentCount: current.tracks.length,
    unchangedCount: current.tracks.length - newlySeen.length - changed.length,
    metadataChanged: changed,
    reindexed,
    // Candidate means NOT YET reviewed or approved.
    candidateNew,
    candidateMissing,
    uncertain,
    requiresHumanReview: candidateNew.length > 0 || candidateMissing.length > 0 ||
      uncertain.length > 0 || changed.length > 0 || reindexed.length > 0,
  };
}

module.exports = { snapshot, validateSnapshot, compareSnapshots, pathHash, VERSION };
