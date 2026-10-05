"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.RsvpStateFetch = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  async function fetchState(fetchWithTimeout, url, timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, timeoutMs);
      if (!response || !response.ok) {
        return { ok: false, reason: `http_${response?.status ?? "unknown"}` };
      }

      const state = await response.json();
      if (!state || typeof state !== "object" || Array.isArray(state) ||
          !state.media || typeof state.media !== "object") {
        return { ok: false, reason: "invalid_state" };
      }

      return { ok: true, state };
    } catch (error) {
      return { ok: false, reason: "request_failed", error: error?.message || "fetch_failed" };
    }
  }

  return Object.freeze({ fetchState });
});
