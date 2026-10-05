"use strict";

/**
 * intelligence/playlist-controller.js — RSVP Radio Playlist Switching
 *
 * Owns the logic for telling Plexamp which normal mode playlist to play.
 * The server orchestrates *when* to switch (time boundaries, weighted music
 * blend, manual mode changes); this module owns *how* to ask Plex.
 *
 * Failure semantics
 * - If a playlist ratingKey is empty (env var not set), playPlaylist() returns
 *   { ok: false, reason: "not_configured" } and makes no Plex API call.
 * - If the API call fails, playPlaylist() returns { ok: false, reason: "..." }
 *   and the caller decides what to do.
 */

const MODE_KEY_TABLE = Object.freeze({
  lofi: "PLAYLIST_LOFI",
  wrap: "PLAYLIST_WRAP",
  rap:  "PLAYLIST_RAP",
  rnb:  "PLAYLIST_RNB",
});

// Get the configured ratingKey for a mode, or "" if not set.
function playlistKeyForMode(mode, cfg) {
  const key = MODE_KEY_TABLE[mode];
  if (!key) return "";
  return cfg[key] || "";
}

/**
 * Issue the Plex command to start a playlist on the Plexamp client.
 * Uses /player/playback/playMedia with X-Plex-Target-Client-Identifier.
 */
async function playPlaylist({ playlistRatingKey, plexBase, plexToken, clientId, fetchWithTimeout, timeoutMs = 3000 }) {
  if (!playlistRatingKey) return { ok: false, reason: "not_configured" };
  if (!plexBase || !plexToken || !clientId) return { ok: false, reason: "missing_credentials" };

  const params = new URLSearchParams({
    "X-Plex-Token":                    plexToken,
    "X-Plex-Target-Client-Identifier": clientId,
    "X-Plex-Client-Identifier":        "rsvp-radio",
    "key":                              `/playlists/${playlistRatingKey}/items`,
    "containerKey":                     `/playlists/${playlistRatingKey}/items`,
    "commandID":                        String(Date.now()),
  });
  const url = `${plexBase}/player/playback/playMedia?${params.toString()}`;

  try {
    const r = await fetchWithTimeout(url, timeoutMs);
    if (!r.ok) return { ok: false, reason: `plex_http_${r.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message || "fetch_failed" };
  }
}

module.exports = {
  playlistKeyForMode,
  playPlaylist,
  MODE_KEY_TABLE,
};