"use strict";

// Serialize external media commands and let callers ignore results belonging
// to an intent that has since been replaced.
function createCommandLane() {
  let tail = Promise.resolve();
  let revision = 0;

  return Object.freeze({
    issueIntent() {
      revision += 1;
      return revision;
    },
    isCurrent(intent) {
      return intent === revision;
    },
    enqueue(work) {
      if (typeof work !== "function") {
        return Promise.reject(new TypeError("command work must be a function"));
      }
      const result = tail.then(work, work);
      tail = result.catch(() => undefined);
      return result;
    },
  });
}

module.exports = { createCommandLane };
