"use strict";

const TIME_BLOCKS = Object.freeze([
  { mode: "lofi", startMin: 4 * 60,  endMin: 12 * 60 },
  { mode: "wrap", startMin: 12 * 60, endMin: 17 * 60 },
  { mode: "rap",  startMin: 17 * 60, endMin: 23 * 60 },
  { mode: "rnb",  startMin: 23 * 60, endMin: 4 * 60  },
]);

const PRE_FADE_MIN = 5;
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

function shouldTriggerBoundary(minute, boundaryMin, preFadeMin = PRE_FADE_MIN) {
  const fireAt = (boundaryMin - preFadeMin + 24 * 60) % (24 * 60);
  return minute >= fireAt && minute < fireAt + 1;
}

module.exports = {
  TIME_BLOCKS,
  PRE_FADE_MIN,
  TRANSITION_MS_DEFAULT,
  minutesOfDay,
  blockModeForMinute,
  blockModeForDate,
  boundaries,
  boundaryTargetMode,
  shouldTriggerBoundary,
};
