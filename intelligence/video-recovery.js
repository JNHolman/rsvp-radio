"use strict";

function removeFailedActiveClip(videoMode, ratingKey) {
  if (!videoMode || !videoMode.active || !Array.isArray(videoMode.clips) || !videoMode.clips.length) {
    return { ok: false, reason: "no_active_video", state: videoMode };
  }
  const index = Number.isInteger(videoMode.index) ? videoMode.index : 0;
  const current = videoMode.clips[index];
  const currentKey = current?.ratingKey ? String(current.ratingKey) : "";
  if (!currentKey || String(ratingKey || "") !== currentKey) {
    return { ok: false, reason: "stale_video", state: videoMode };
  }

  const clips = videoMode.clips.filter((_, i) => i !== index);
  if (!clips.length) {
    return { ok: true, empty: true, removedRatingKey: currentKey, state: { ...videoMode, active: false, clips: [], index: 0 } };
  }
  const nextIndex = index >= clips.length ? 0 : index;
  return {
    ok: true,
    empty: false,
    removedRatingKey: currentKey,
    state: { ...videoMode, clips, index: nextIndex, startedAt: Date.now() },
  };
}

module.exports = { removeFailedActiveClip };
