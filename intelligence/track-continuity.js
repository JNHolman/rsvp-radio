"use strict";

/**
 * Conservative song-level continuity gate for RSVP Radio, NOT a BPM engine.
 * Uses only full Plex track metadata: year, explicit genre tags and explicit
 * mood words. Never guesses era from a playlist name, artist, or title.
 *
 * Unknown year/genre means NO automatic recommendation. A shared playlist
 * does not override an incompatible song. It is safer to leave the existing
 * queue alone than to manufacture a transition.
 */
const clean = value => String(value || "").normalize("NFKC").toLowerCase()
  .replace(/[‐‑–—]/g, "-").trim();
const validYear = y => Number.isInteger(y) && y >= 1900 && y <= 2100;
const FAMILY_RULES = [
  ["rnb", /(?:\br\s*(?:&|and|n)\s*b\b|rhythm\s*(?:&|and)\s*blues|neo[ -]?soul|quiet storm)/],
  ["hiphop", /(?:hip[ -]?hop|\brap\b|\btrap\b|boom[ -]?bap)/],
  ["funk", /\bfunk\b/],
  ["soul", /\bsoul\b/],
  ["disco", /\bdisco\b/],
  ["reggae", /\breggae\b|\bdancehall\b|\bragga\b/],
  ["afrobeats", /\bafro[ -]?beats?\b|\bafro[ -]?pop\b/],
  ["jazz", /\bjazz\b/],
  ["blues", /\bblues\b/],
  ["house", /\bhouse\b/],
  ["electronic", /\belectronic\b|\btechno\b|\bedm\b/],
  ["pop", /\bpop\b/],
  ["rock", /\brock\b/],
  ["country", /\bcountry\b/],
];
const HIGH_MOODS = /\b(?:raucous|urgent|intense|aggressive|driving|high[ -]?energy|rowdy|lively|rousing|hard[ -]?hitting|energetic)\b/;
const LOW_MOODS = /\b(?:relaxed|mellow|tender|soothing|gentle|laid[ -]?back|intimate|sensual|tranquil|quiet|soft|calm)\b/;

function families(profile) {
  const found = new Set();
  for (const tag of profile?.genre || []) {
    const genre = clean(tag);
    for (const [family, pattern] of FAMILY_RULES) {
      if (pattern.test(genre)) found.add(family);
    }
  }
  return found;
}
function strongMood(moods) {
  const text = (Array.isArray(moods) ? moods : []).map(clean).join(" ");
  const high = HIGH_MOODS.test(text);
  const low = LOW_MOODS.test(text);
  return high === low ? "unknown" : high ? "high-tagged" : "low-tagged";
}

function assessPair(current, candidate, { maxYearGap = 9 } = {}) {
  if (!current || !candidate ||
      !current.ratingKey || !candidate.ratingKey ||
      String(current.ratingKey) === String(candidate.ratingKey)) {
    return { ok: false, reason: "same_or_missing_song" };
  }
  if (!validYear(current.year) || !validYear(candidate.year)) {
    return { ok: false, reason: "unknown_year" };
  }
  const gap = Math.abs(current.year - candidate.year);
  if (gap > maxYearGap) return { ok: false, reason: "era_jump", yearGap: gap };
  const a = families(current), b = families(candidate);
  if (!a.size || !b.size) return { ok: false, reason: "unknown_genre", yearGap: gap };
  const shared = [...a].filter(g => b.has(g));
  if (!shared.length) return { ok: false, reason: "genre_jump", yearGap: gap };

  // Only use literal mood descriptors, not invented BPM/energy estimates.
  const aMood = strongMood(current.mood);
  const bMood = strongMood(candidate.mood);
  if (aMood !== "unknown" && bMood !== "unknown" && aMood !== bMood) {
    return { ok: false, reason: "contradictory_mood_tags", yearGap: gap };
  }
  const norm = p => new Set((p?.genre || []).map(clean));
  const cg = norm(candidate);
  const sameTag = [...norm(current)].some(g => cg.has(g));
  const aMoods = new Set((current.mood || []).map(clean));
  const sameMood = (candidate.mood || []).some(tag => aMoods.has(clean(tag)));
  const score = 100 - gap * 6 + (sameTag ? 15 : 0) +
    (sameMood ? 10 : 0) + Math.min(8, 2 * shared.length);
  return { ok: true, reason: "metadata_compatible", score,
    yearGap: gap, sharedGenres: shared, moodEvidence: aMood + "/" + bMood };
}

function chooseCompatible(current, candidates, { recent = [], maxYearGap = 9 } = {}) {
  const excluded = new Set(recent.map(String));
  const results = [];
  const rejected = {};
  for (const item of candidates || []) {
    if (excluded.has(String(item?.ratingKey))) continue;
    const verdict = assessPair(current, item, { maxYearGap });
    if (verdict.ok) results.push({ profile: item, ...verdict });
    else rejected[verdict.reason] = (rejected[verdict.reason] || 0) + 1;
  }
  // Stable tie-breaker, avoids a second random choice and repeated song.
  results.sort((x, y) => y.score - x.score ||
    String(x.profile.ratingKey).localeCompare(String(y.profile.ratingKey), undefined, { numeric: true }));
  return results.length
    ? { ok: true, ...results[0], evaluated: (candidates || []).length }
    : { ok: false, reason: "no_compatible_song", rejected,
      evaluated: (candidates || []).length };
}

module.exports = { assessPair, chooseCompatible, families, strongMood };
