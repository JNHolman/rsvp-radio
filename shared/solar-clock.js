"use strict";

// Cache the solar phase and schedule its exact next transition. The 30-second
// Hue scheduling check reads this cache; it must never recalculate sunrise/dusk.
// A single hourly safety wake-up covers Pi sleep or an adjusted system clock.
const solarPhase = require("./solar-phase");

function createSolarClock({
  latitude,
  longitude,
  onPhaseChange = () => {},
  onError = () => {},
  getSolarPhase = solarPhase.getSolarPhase,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  safetyMs = 60 * 60 * 1000,
  retryMs = 60 * 1000,
} = {}) {
  let running = false;
  let timer = null;
  let current = null;

  function schedule(nextTransition) {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!running) return;
    const eventMs = nextTransition instanceof Date ? nextTransition.getTime() : NaN;
    const remaining = eventMs - now().getTime();
    // Reconcile at the known event, or once an hour only as a safety measure.
    const delay = Number.isFinite(remaining)
      ? Math.min(safetyMs, Math.max(1, remaining))
      : retryMs;
    timer = setTimer(reconcile, delay);
  }

  function reconcile() {
    if (!running) return current;
    try {
      const next = getSolarPhase(now(), latitude, longitude);
      if (!["day", "night"].includes(next.phase) ||
          !(next.nextTransition instanceof Date) ||
          !Number.isFinite(next.nextTransition.getTime())) {
        throw new Error("solar_phase_unavailable");
      }
      const previousPhase = current?.phase;
      current = next;
      schedule(next.nextTransition);
      if (previousPhase && previousPhase !== next.phase) onPhaseChange(next.phase);
    } catch (error) {
      onError(error);
      // Keep the last confirmed phase and retry only on the failure cadence.
      schedule(null);
    }
    return current;
  }

  return {
    start() {
      if (running) return current;
      running = true;
      return reconcile();
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    phase() { return current?.phase || null; },
    state() { return current; },
    refresh: reconcile,
  };
}

module.exports = { createSolarClock };
