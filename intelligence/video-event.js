"use strict";

function normalizeMediaPath(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), "http://localhost");
    return url.pathname;
  } catch (_) {
    return String(value).split(/[?#]/, 1)[0];
  }
}

function activeVideoIdentity(videoMode) {
  if (!videoMode || !videoMode.active || !Array.isArray(videoMode.clips) || !videoMode.clips.length) {
    return { ratingKey: "", mediaPath: "" };
  }
  const index = Number.isInteger(videoMode.index) ? videoMode.index : 0;
  const clip = videoMode.clips[index];
  const ratingKey = clip && clip.ratingKey ? String(clip.ratingKey) : "";
  return {
    ratingKey,
    mediaPath: ratingKey ? `/media/${ratingKey}` : "",
  };
}

function eventMatchesActiveVideo({ mediaUrl = "", ratingKey = "" } = {}, videoMode) {
  const active = activeVideoIdentity(videoMode);
  if (!active.ratingKey) return false;
  const suppliedKey = ratingKey ? String(ratingKey) : "";
  if (suppliedKey && suppliedKey !== active.ratingKey) return false;
  const suppliedPath = normalizeMediaPath(mediaUrl);
  if (suppliedPath && suppliedPath !== active.mediaPath) return false;
  // Correlation is mandatory. A bare event must never mutate the current clip.
  return !!(suppliedKey || suppliedPath);
}

function ratingKeyFromMediaUrl(mediaUrl) {
  const path = normalizeMediaPath(mediaUrl);
  const match = /^\/media\/([^/]+)$/.exec(path);
  return match ? decodeURIComponent(match[1]) : "";
}

module.exports = {
  normalizeMediaPath,
  activeVideoIdentity,
  eventMatchesActiveVideo,
  ratingKeyFromMediaUrl,
};
