/* RSVP TV ambient overlay. Display only; no programming/scheduler authority. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const title = $("nextTitle"), artist = $("nextArtist"), featured = $("nextCoverImg"), strip = $("nextStrip");
  const upNext = $("upNext"), progress = $("nowExtras");
  const fill = $("playFill"), elapsed = $("playElapsed"), duration = $("playDuration");
  const clock = $("localClock"), weather = $("weatherSummary");
  const timeZone = "America/Kentucky/Louisville";
  let lastRatingKey = "", visibleAudio = false, paused = true, baselineMs = 0, baselineAt = 0, lengthMs = 0;
  let queueLoading = false, queueFetchedAt = 0;

  function formatTime(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function updateProgress() {
    if (!visibleAudio) return;
    const predicted = baselineMs + (paused ? 0 : Date.now() - baselineAt);
    const position = Math.max(0, Math.min(lengthMs || predicted, predicted));
    elapsed.textContent = formatTime(position);
    duration.textContent = formatTime(lengthMs);
    fill.style.width = (lengthMs > 0 ? 100 * position / lengthMs : 0) + "%";
  }
  function updateClock() {
    clock.textContent = new Intl.DateTimeFormat("en-US", {
      timeZone, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date());
  }
  async function updateWeather() {
    try {
      const res = await fetch("/api/weather", { cache: "no-store" });
      if (!res.ok) throw new Error("Weather request failed");
      const data = await res.json();
      if (!data.available || !Number.isFinite(data.temperatureF)) throw new Error("Weather unavailable");
      weather.textContent = Math.round(data.temperatureF) + "°F · " + data.description;
    } catch (_) {
      weather.textContent = "WEATHER UNAVAILABLE";
    }
  }
  const safeArt = (url) => typeof url === "string" && url.startsWith("/art?") ? url : "";

  function renderQueue(payload) {
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    const available = payload?.available === true;
    const first = tracks[0];
    title.textContent = first?.title || (available ? "Nothing queued" : "Queue unavailable");
    artist.textContent = ""; // Compact queue shows title only for the first upcoming track.
    const url = safeArt(first?.artUrl);
    if (url) {
      featured.src = url;
      featured.hidden = false;
    } else {
      featured.removeAttribute("src");
      featured.hidden = true;
    }
    strip.replaceChildren();
    // Exactly four more album sleeves; no distracting captions.
    for (const track of tracks.slice(1, 5)) {
      const item = document.createElement("div");
      item.className = "nextStripItem";
      item.title = [track.title, track.artist].filter(Boolean).join(" — ");
      const img = document.createElement("img");
      const coverUrl = safeArt(track.artUrl);
      if (coverUrl) {
        img.src = coverUrl;
        img.alt = "Upcoming: " + (track.title || "song");
      } else {
        img.alt = "Album artwork unavailable";
        item.classList.add("missingCover");
      }
      item.appendChild(img);
      strip.appendChild(item);
    }
  }

  async function updateQueue(force = false) {
    if (queueLoading || !visibleAudio) return;
    const now = Date.now();
    if (!force && now - queueFetchedAt < 12000) return;
    queueLoading = true;
    queueFetchedAt = now;
    const capturedKey = lastRatingKey;
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      let res;
      try { res = await fetch("/api/up-next", { cache: "no-store", signal: ctrl.signal }); }
      finally { clearTimeout(timeout); }
      if (!res.ok) throw new Error("Queue request failed");
      const payload = await res.json();
      if (visibleAudio && capturedKey === lastRatingKey) renderQueue(payload);
    } catch (_) {
      if (visibleAudio && capturedKey === lastRatingKey) renderQueue({ available: false, tracks: [] });
    } finally {
      queueLoading = false;
    }
  }

  // Called from the existing player.js after successful /state polling.
  window.renderTvOverlayState = function (state) {
    const m = state?.media || {};
    const playingAudio = m.type === "audio" && ["playing", "paused"].includes(m.playerState);
    visibleAudio = playingAudio;
    progress.classList.toggle("on", playingAudio);
    // Bottom Up Next strip stays on screen even when radio is between tracks.
    // The existing video-mode CSS hides it when RSVP TV owns the display.
    upNext.classList.add("on");
    if (!playingAudio) {
      lastRatingKey = "";
      renderQueue({ available: false, tracks: [] });
      title.textContent = "Waiting for music";
      return;
    }
    paused = m.playerState !== "playing";
    baselineMs = Math.max(0, Number(m.viewOffsetMs) || 0);
    baselineAt = Date.now();
    lengthMs = Math.max(0, Number(m.durationMs) || 0);
    updateProgress();
    const key = String(m.ratingKey || "");
    if (key !== lastRatingKey) {
      lastRatingKey = key;
      queueFetchedAt = 0;
      renderQueue({ available: false, tracks: [] });
      updateQueue(true);
    }
  };

  setInterval(updateProgress, 400);
  setInterval(() => updateQueue(), 2000);
  setInterval(updateClock, 15000);
  setInterval(updateWeather, 15 * 60 * 1000);
  updateClock();
  updateWeather();
})();
