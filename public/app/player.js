/**
 * public/app/player.js
 * Plex polling and UI updates.
 *
 * - 2000ms poll interval
 * - In-flight guard: skips if previous fetch still running
 * - Change detection: only touches DOM when values actually changed
 * - Uses AbortController + setTimeout for timeout (safe on all Chromium versions)
 */

// ── DOM refs (resolved once at load, not on every poll) ───────────────────────
const _el = {
  status:  document.getElementById("statusText"),
  card:    document.getElementById("nowCard"),
  img:     document.getElementById("artImg"),
  ph:      document.getElementById("ph"),
  title:   document.getElementById("tTitle"),
  artist:  document.getElementById("tArtist"),
  album:   document.getElementById("tAlbum"),
};

// ── Change detection cache ────────────────────────────────────────────────────
let _prev = { playing: null, title: null, artist: null, album: null, artUrl: null, mode: null, isVideo: null, ratingKey: null };

// ── In-flight guard ───────────────────────────────────────────────────────────
let _busy = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _decode(str) {
  if (!str) return "";
  const t = document.createElement("textarea");
  t.innerHTML = str;
  return t.value;
}

function _artUrl(state) {
  if (!state) return "";
  // Always use relative URLs — the server proxies art through /art
  // Never call Plex directly from the browser
  const url = state.media?.artUrl || "";
  if (url) {
    if (url.startsWith("/")) return url; // relative — let browser resolve
    try { return new URL(url, location.origin).href; } catch (_) {}
  }
  return "";
}

// Safe fetch with timeout — works on all Chromium versions (no AbortSignal.timeout)
function _fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: "no-store", signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

// ── DOM writers (only called when value changed) ──────────────────────────────

function _setStatus(playerState) {
  if (playerState === "playing") {
    _el.status.textContent = "NOW PLAYING";
  } else if (playerState === "paused") {
    _el.status.textContent = "PAUSED";
  } else {
    _el.status.textContent = "IDLE";
  }
}

function _showCard(on) {
  _el.card.classList.toggle("on", !!on);
}

function _setArt(url) {
  if (url) {
    _el.img.src          = url;
    _el.img.style.display = "block";
    _el.ph.style.display  = "none";
  } else {
    _el.img.removeAttribute("src");
    _el.img.style.display = "none";
    _el.ph.style.display  = "grid";
  }
}

function _setMeta(title, artist, album) {
  _el.title.textContent  = _decode(title)  || "—";
  _el.artist.textContent = _decode(artist) || "—";
  _el.album.textContent  = _decode(album)  || "—";
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll() {
  if (_busy) return;
  _busy = true;

  try {
    let state = null;
    try {
      const r = await _fetchWithTimeout(STATE_URL, POLL_TIMEOUT);
      if (r.ok) state = await r.json();
    } catch (_) { /* network error → treat as idle */ }

    const media       = state?.media       || {};
    const mediaType   = media.type         || "idle";
    const playerState = media.playerState  || "";

    const playing = !!(
      (mediaType === "audio" || mediaType === "video") &&
      playerState === "playing"
    );

    const activeMedia = !!(
      (mediaType === "audio" || mediaType === "video") &&
      (playerState === "playing" || playerState === "paused")
    );

    if (!activeMedia) {
      _setStatus("idle");
      _showCard(false);
      if (_prev.isVideo) {
        _prev.isVideo = false;
        _prev.ratingKey = null;
        exitMusicVideoMode();
      }
      if (_prev.playing !== false) _prev.playing = false;
      return;
    }

    // Something is playing.
    _setStatus(playerState || "idle");

    const isVideo   = mediaType === "video";
    const ratingKey = String(media.ratingKey || "");
    const mediaUrl  = media.mediaUrl || "";

    // Only pause from poll — never call play() here
    // play() is called inside enterMusicVideoMode after loadedmetadata
    // Calling play() from poll can restart a nearly-ended video before ended fires
    if (isVideo) {
      const mv = document.getElementById("musicVideo");
      if (mv) {
        if (playerState === "paused") {
          mv.pause();
        }
        // Seek sync disabled — polling every 2s causes constant seeks and stuttering.
        // Plex viewOffsetMs is too unstable at 2s intervals for reliable seek.
      }
    }

    // ── Playing ───────────────────────────────────────────────────────────────
    if (playing && _prev.playing !== true) {
      _prev.playing = true;
    }

    const sameVideo = isVideo &&
      _prev.isVideo &&
      _prev.ratingKey &&
      String(_prev.ratingKey) === ratingKey;

    const localEnded = typeof isMusicVideoEnded === "function" && isMusicVideoEnded();
    const localVideoFailed = isVideo && mediaUrl &&
      typeof isMusicVideoFailed === "function" && isMusicVideoFailed(mediaUrl);

    // ── Music video mode ──────────────────────────────────────────────────────
    // NEW VIDEO LOADS FIRST — before any ended/failed guard
    // This ensures Video B loads immediately even if Video A just ended
    if (isVideo && mediaUrl && !localVideoFailed && !sameVideo) {
      _prev.isVideo   = isVideo;
      _prev.ratingKey = ratingKey;
      await enterMusicVideoMode(mediaUrl, playerState || "playing");
    } else if (!isVideo && _prev.isVideo) {
      // Only exit video mode if ratingKey also changed — Plex can misreport
      // a paused video as type "audio", so don't exit just because the type flipped
      const ratingKeyChanged = ratingKey && _prev.ratingKey && ratingKey !== _prev.ratingKey;
      const ratingKeyGone    = !ratingKey;
      if (ratingKeyChanged || ratingKeyGone) {
        _prev.isVideo   = false;
        _prev.ratingKey = null;
        exitMusicVideoMode();
      }
    }

    // SAME ENDED VIDEO — hold black, don't show card
    if (sameVideo && localEnded) {
      _showCard(false);
      _el.status.textContent = "LOADING NEXT VIDEO";
      return;
    }

    // FAILED VIDEO — hide card, show failure status
    if (localVideoFailed) {
      _showCard(false);
      _el.status.textContent = "VIDEO FAILED";
      return;
    }

    _showCard(true);

    // Metadata — write only on change
    const title  = media.title  || "";
    const artist = media.artist || "";
    const album  = media.album  || "";
    if (title !== _prev.title || artist !== _prev.artist || album !== _prev.album) {
      _prev.title  = title;
      _prev.artist = artist;
      _prev.album  = album;
      _setMeta(title, artist, album);
    }

    // Artwork — write only on change
    const url = _artUrl(state);
    if (url !== _prev.artUrl) {
      _prev.artUrl = url;
      _setArt(url);
    }

  } finally {
    _busy = false;
  }
}

function startPolling() {
  poll();
  setInterval(poll, POLL_MS);
}
