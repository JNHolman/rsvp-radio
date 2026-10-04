"use strict";

const TIME_BLOCKS = Object.freeze([
  { mode: "lofi", startMin: 4 * 60,  endMin: 12 * 60 },
  { mode: "wrap", startMin: 12 * 60, endMin: 17 * 60 },
  { mode: "rap",  startMin: 17 * 60, endMin: 23 * 60 },
  { mode: "rnb",  startMin: 23 * 60, endMin: 4 * 60  },
]);

const PRE_FADE_MIN = 5;
const POST_FADE_MIN = 5;
const TRANSITION_MS_DEFAULT = 360000;

function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function includesMinute(block, minute) {
  if (block.startMin < block.endMin) {
    return minute >= block.startMin && minute < block.endMin;
  }
  return minute >= block.startMin || minute < block.endMin;
}

function blockModeForMinute(minute) {
  const match = TIME_BLOCKS.find((block) => includesMinute(block, minute));
  return match ? match.mode : "rnb";
}

function blockModeForDate(date = new Date()) {
  return blockModeForMinute(minutesOfDay(date));
}

function boundaries() {
  return TIME_BLOCKS.map((block) => block.startMin);
}

function boundaryTargetMode(boundaryMin) {
  const match = TIME_BLOCKS.find((block) => block.startMin === boundaryMin);
  return match ? match.mode : "rnb";
}

function circularDistanceForward(fromMin, toMin) {
  return (toMin - fromMin + 24 * 60) % (24 * 60);
}

function blendWindowForMinute(minute, preFadeMin = PRE_FADE_MIN, postFadeMin = POST_FADE_MIN) {
  for (let i = 0; i < TIME_BLOCKS.length; i++) {
    const incoming = TIME_BLOCKS[i];
    const outgoing = TIME_BLOCKS[(i - 1 + TIME_BLOCKS.length) % TIME_BLOCKS.length];
    const boundary = incoming.startMin;

    const untilBoundary = circularDistanceForward(minute, boundary);
    const sinceBoundary = circularDistanceForward(boundary, minute);

    const before = untilBoundary <= preFadeMin;
    const after = sinceBoundary < postFadeMin;

    if (!before && !after) continue;

    const phase = before && untilBoundary !== 0 ? "pre" : "post";
    const elapsed = phase === "pre"
      ? preFadeMin - untilBoundary
      : preFadeMin + sinceBoundary;
    const total = preFadeMin + postFadeMin;
    const incomingWeight = Math.max(0, Math.min(1, elapsed / total));

    return {
      active: true,
      phase,
      boundaryMin: boundary,
      outgoingMode: outgoing.mode,
      incomingMode: incoming.mode,
      incomingWeight,
    };
  }

  return null;
}

function shouldTriggerBoundary(minute, boundaryMin, preFadeMin = PRE_FADE_MIN) {
  const fireAt = (boundaryMin - preFadeMin + 24 * 60) % (24 * 60);
  return minute >= fireAt && minute < fireAt + 1;
}

module.exports = {
  TIME_BLOCKS,
  PRE_FADE_MIN,
  POST_FADE_MIN,
  TRANSITION_MS_DEFAULT,
  minutesOfDay,
  blockModeForMinute,
  blockModeForDate,
  boundaries,
  boundaryTargetMode,
  blendWindowForMinute,
  shouldTriggerBoundary,
};
