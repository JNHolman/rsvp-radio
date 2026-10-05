"use strict";

function createSingleFlight(work) {
  if (typeof work !== "function") {
    throw new TypeError("single-flight work must be a function");
  }

  let inFlight = null;
  return function singleFlight(...args) {
    if (inFlight) return inFlight;

    const context = this;
    const flight = Promise.resolve()
      .then(() => work.apply(context, args))
      .finally(() => {
        if (inFlight === flight) inFlight = null;
      });
    inFlight = flight;
    return flight;
  };
}

module.exports = { createSingleFlight };
