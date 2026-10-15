/* RSVP TV ambient overlay. Display only; no programming/scheduler authority. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const title = $("nextTitle"), artist = $("nextArtist"), featured = $("nextCoverImg"), strip = $("nextStrip");
  const upNext = $("upNext"), progress = $("nowExtras");
  const fill = $("playFill"), elapsed = $("playElapsed"), duration = $("playDuration");
  const clock = $("localClock"), weatherTemp = $("weatherTemp"), weatherCondition = $("weatherCondition");
  const timeZone = "America/Kentucky/Louisville";
  let lastRatingKey = "", visibleAudio = false, paused = true, baselineMs = 0, baselineAt = 0, lengthMs = 0;
  let queueLoading = false, queueFetchedAt = 0;
  let verifiedQueue = []; // Only items returned from the actual Plex play queue.

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
      weatherTemp.textContent = Math.round(data.temperatureF) + "°F";
      weatherCondition.textContent = String(data.description || "").trim();
    } catch (_) {
      weatherTemp.textContent = "--°F";
      weatherCondition.textContent = "WEATHER UNAVAILABLE";
    }
  }
  const safeArt = (url) => typeof url === "string" && url.startsWith("/art?") ? url : "";

  function renderQueue(payload) {
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    const available = payload?.available === true;
    const first = tracks[0];
    title.textContent = first?.title || (available ? "Nothing queued" : "Queue unavailable");
    artist.textContent = first?.artist || "";
    title.title = first?.title || "";
    const url = safeArt(first?.artUrl);
    if (url) {
      featured.src = url;
      featured.hidden = false;
    } else {
      featured.removeAttribute("src");
      featured.hidden = true;
    }
    strip.replaceChildren();
    // Three more sleeves after the identified next track: four covers total.
    // Preserve the real Plex play queue order; no playlist guessing.
    for (const track of tracks.slice(1, 4)) {
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
      if (visibleAudio && capturedKey === lastRatingKey) {
        verifiedQueue = payload.available && Array.isArray(payload.tracks) ? payload.tracks : [];
        renderQueue(payload);
      }
    } catch (_) {
      if (visibleAudio && capturedKey === lastRatingKey) {
        verifiedQueue = [];
        renderQueue({ available: false, tracks: [] });
      }
    } finally {
      queueLoading = false;
      // The track may have advanced while this previous queue request was
      // in flight; fetch the new queue without an extra polling-cycle wait.
      if (visibleAudio && capturedKey !== lastRatingKey) updateQueue(true);
    }
  }

  // Called from the existing player.js after successful /state polling.
  window.renderTvOverlayState = function (state) {
    const m = state?.media || {};
    const activeState = ["playing", "paused"].includes(m.playerState);
    const playingAudio = m.type === "audio" && activeState;
    const activeVideo = m.type === "video" && activeState;
    visibleAudio = playingAudio;

    // Idle is background-only: no song/title/cover/progress/queue, logo,
    // clock, or weather. Audio paused still has a loaded song and retains its
    // information. Video is handled by the existing video-mode rules.
    // The background artwork/light layer is never hidden by this state.
    document.querySelector(".stage")?.classList.toggle("radio-idle", !playingAudio && !activeVideo);
    progress.classList.toggle("on", playingAudio);
    upNext.classList.toggle("on", playingAudio);
    if (!playingAudio) {
      lastRatingKey = "";
      verifiedQueue = [];
      // Clear old metadata so nothing stale appears when music resumes.
      renderQueue({ available: false, tracks: [] });
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
      if (key && verifiedQueue[0]?.ratingKey === key) {
        // The previously verified next song is now playing: immediately
        // advance the known queue while requesting the authoritative update.
        // No guesses from the playlist; mismatches display a loading state.
        verifiedQueue = verifiedQueue.slice(1);
        renderQueue({ available: true, tracks: verifiedQueue });
      } else {
        verifiedQueue = [];
        renderQueue({ available: false, tracks: [] });
        title.textContent = "Loading next song";
      }
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
