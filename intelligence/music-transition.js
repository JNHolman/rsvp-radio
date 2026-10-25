"use strict";

/**
 * Music-only time-block handoff.
 *
 * A clock boundary changes what future songs should be favored; it never
 * commands Plexamp to switch playlists or replace a playing track. Only a
 * successfully prepared following song advances the transition. The bias
 * changes asymptotically with played-song opportunities, not elapsed minutes
 * or a mandatory fixed number of tracks.
 *
 * This is SOURCE blending, not a BPM/genre/energy compatibility engine.
 */
const MODES = new Set(["lofi", "lounge", "rap", "rnb"]);
const validMode = value => MODES.has(value) ? value : "";

function createMusicTransition({ random = Math.random } = {}) {
  let block = "";
  let source = "";
  let transition = null;
  let planned = null;
  let confirmedTrack = "";

  function observeBlock(mode) {
    const incoming = validMode(mode);
    if (!incoming || incoming === block) return false;
    const previous = source || block;
    block = incoming;
    transition = previous && previous !== incoming
      ? { fromMode: previous, toMode: incoming, prepared: 0 }
      : null;
    planned = null;
    confirmedTrack = "";
    return true;
  }

  function incomingShare() {
    if (!transition) return 1;
    if (transition.prepared === 0) return 0; // never force a jump at the boundary
    const progressive = 1 - Math.pow(0.82, transition.prepared);
    // Once the new sound has entered the sequence, favor keeping it rather
    // than bouncing back and forth between completely different source pools.
    const continuity = source === transition.toMode ? 0.12 : -0.06;
    return Math.max(0, Math.min(0.995, progressive + continuity));
  }

  function chooseForTrack(trackKey, { steeringMode = "" } = {}) {
    const key = String(trackKey || "");
    if (!key || !block) return { mode: "", reason: "no_music_context" };
    if (confirmedTrack === key) return { mode: "", reason: "already_prepared" };
    if (planned?.key === key) return { mode: planned.mode, reason: "same_track_decision" };

    let mode = block;
    let incomingPct = 100;
    const lateral = validMode(steeringMode);
    if (lateral) {
      mode = lateral; // explicit skip-driven steering beats clock preference
    } else if (transition) {
      incomingPct = Math.round(incomingShare() * 100);
      let roll = Number(random());
      if (!Number.isFinite(roll)) roll = 0.5;
      roll = Math.max(0, Math.min(0.999999999, roll));
      mode = roll < incomingShare() ? transition.toMode : transition.fromMode;
    }
    planned = { key, mode };
    return {
      mode, reason: lateral ? "skip_steering" : transition ? "gradual_handoff" : "steady_block",
      incomingPct,
    };
  }

  function isPending(trackKey, mode) {
    return !!planned && planned.key === String(trackKey || "") && planned.mode === mode;
  }

  function confirmPrepared(trackKey, mode) {
    if (!isPending(trackKey, mode)) return false;
    confirmedTrack = planned.key;
    source = mode;
    if (transition) transition.prepared += 1;
    planned = null;
    return true;
  }

  function cancelPending() {
    // A temporary automation stop must not erase the current musical source.
    planned = null;
  }

  function reset(mode = "") {
    block = validMode(mode);
    source = block;
    transition = null;
    planned = null;
    confirmedTrack = "";
  }

  function snapshot() {
    return {
      block, source,
      transition: transition ? { ...transition, incomingPct: Math.round(incomingShare() * 100) } : null,
    };
  }

  return { observeBlock, chooseForTrack, isPending, confirmPrepared, cancelPending, reset, snapshot };
}

module.exports = { createMusicTransition };
