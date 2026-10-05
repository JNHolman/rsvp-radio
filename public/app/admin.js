/** RSVP Radio / TV admin console. The server remains the only automation authority. */
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const r = await fetch(path, { cache: "no-store", ...opts });
  let body = {};
  try { body = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

const post = (path, body = {}) => api(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function result(msg, bad = false, target = "actionResult") {
  const el = $(target);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("bad", bad);
  el.classList.toggle("good", !bad);
}

function fmtTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n).toLocaleTimeString();
}

function fmtPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function modeLabel(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "rnb") return "R&B";
  if (mode === "lofi") return "LOFI";
  if (mode === "lounge") return "LOUNGE";
  if (mode === "rap") return "RAP";
  return value ? String(value).toUpperCase() : "—";
}

function setNowArt(url) {
  const host = $("nowArt");
  if (!host) return;
  const art = String(url || "");
  host.style.backgroundImage = art ? `url(${JSON.stringify(art)})` : "";
  const placeholder = host.querySelector(".nowArtPlaceholder");
  if (placeholder) placeholder.hidden = !!art;
}

function setConfigBanner(state) {
  const banner = $("configBanner");
  if (!banner) return;
  const health = state.configHealth || {};
  const missingPlaylists = Object.entries(health.playlists || {})
    .filter(([, configured]) => !configured)
    .map(([mode]) => modeLabel(mode));
  const messages = [];
  if (health.plexTokenSet === false) messages.push("Plex token is not configured.");
  if (missingPlaylists.length) messages.push(`Missing music playlist IDs: ${missingPlaylists.join(", ")}.`);
  if (!messages.length) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = messages.join(" ");
}

function setVideoTransport(state) {
  const transport = $("videoTransport");
  if (!transport) return;
  const active = state.video?.phase === "playing" || state.video?.phase === "paused";
  const paused = state.video?.phase === "paused";
  transport.classList.toggle("disabled", !active);
  for (const button of transport.querySelectorAll("button")) button.disabled = !active;

  const pause = transport.querySelector('[data-action="video-pause"]');
  if (pause) {
    pause.dataset.paused = paused ? "1" : "0";
    pause.textContent = paused ? "Resume ▶" : "Pause ⏸";
    pause.classList.toggle("primary", paused);
  }

  const vm = state.videoMode;
  const label = $("videoResult");
  if (!label) return;
  if (!active || !vm) {
    label.textContent = "Idle · Radio owns the room";
    label.classList.remove("bad", "good");
    return;
  }
  const index = Number(vm.index);
  const total = Number(vm.total);
  const position = Number.isFinite(index) && Number.isFinite(total) && total > 0
    ? ` · ${index + 1}/${total}`
    : "";
  label.textContent = `${paused ? "Paused" : "Playing"}: ${vm.playlist || "RSVP TV"}${position}`;
  label.classList.remove("bad");
  label.classList.add("good");
}

function setStatusPill(state) {
  const pill = $("statusPill");
  if (!pill) return;
  const value = state.appState || "IDLE";
  pill.textContent = value;
  const live = value === "AUDIO_PLAYING" || value === "VIDEO_PLAYING";
  pill.classList.toggle("live", live);
  pill.classList.toggle("idle", !live);
}

async function refreshState() {
  try {
    const s = await api("/state");
    setStatusPill(s);
    setConfigBanner(s);
    setVideoTransport(s);
    setNowArt(s.media?.artUrl);

    $("nowTitle").textContent = s.media?.title || "Nothing playing";
    $("nowArtist").textContent = s.media?.artist || "";
    $("nowAlbum").textContent = s.media?.album || "";
    $("modeChip").textContent = modeLabel(s.mode?.current);
    $("modeSource").textContent = s.mode?.source || "—";
    $("modeExpiry").textContent = s.mode?.manualExpiresAt ? `until ${fmtTime(s.mode.manualExpiresAt)}` : "";
    if ($("rawState")) $("rawState").textContent = JSON.stringify(s, null, 2);

    const pairs = {
      kAppState: s.appState,
      kMediaType: s.media?.type,
      kPlayerState: s.media?.playerState,
      kModeSource: s.mode?.source,
      kManualExpires: fmtTime(s.mode?.manualExpiresAt),
      kVideoPhase: s.video?.phase,
      kPlexamp: s.plexamp?.pausedByRsvpVideo ? "YES" : "NO",
      kLightsEnabled: s.configHealth?.hue?.enabled === true ? "ON" : "OFF",
      kLightsManualExpires: fmtTime(s.configHealth?.hue?.manualExpiresAt),
      kUpdated: fmtTime(s.updatedAt),
      kError: s.error || "—",
      kRatingKey: s.media?.ratingKey,
      kStrikes: s.intelligence?.strikes,
      kSoftStrikes: s.intelligence?.softStrikes,
      kRating: s.intelligence?.rating,
      kLastPlayPct: s.intelligence?.lastPlayPercent == null ? "—" : fmtPercent(s.intelligence.lastPlayPercent),
      kDesiredPlaylist: s.music?.desiredPlaylist,
      kCommandedPlaylist: s.music?.lastCommandedPlaylist,
      kAligned: s.music?.commandAligned === true ? "YES" : s.music?.commandAligned === false ? "NO" : "—",
    };
    for (const [id, value] of Object.entries(pairs)) {
      const el = $(id);
      if (el) el.textContent = value === "" || value == null ? "—" : String(value);
    }
  } catch (err) {
    const pill = $("statusPill");
    if (pill) {
      pill.textContent = "OFFLINE";
      pill.classList.remove("live");
      pill.classList.add("idle");
    }
  }
}

async function refreshVideos() {
  const host = $("videoPlaylists");
  if (!host) return;
  try {
    const data = await api("/admin/video-playlists");
    host.replaceChildren();
    for (const playlist of data.playlists || []) {
      const button = document.createElement("button");
      button.className = "btn";
      if (data.active?.playlistKey === playlist.ratingKey) button.classList.add("primary");
      button.textContent = playlist.title;
      button.dataset.videoPlaylist = playlist.ratingKey;
      host.appendChild(button);
    }
    if (!host.children.length) {
      const empty = document.createElement("span");
      empty.className = "empty";
      empty.textContent = "No RSVP TV playlists found";
      host.appendChild(empty);
    }
  } catch (_) {
    host.textContent = "Video playlists unavailable";
  }
}

function renderTopList(id, items, metric, label) {
  const list = $(id);
  if (!list) return;
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No data yet";
    list.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "ttl";
    title.textContent = item.title || "Unknown";
    const artist = document.createElement("div");
    artist.className = "art";
    artist.textContent = item.artist || "";
    meta.append(title, artist);
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(item[metric] || 0);
    const small = document.createElement("small");
    small.textContent = label;
    num.appendChild(small);
    li.append(meta, num);
    list.appendChild(li);
  }
}

function renderSkipTable(items) {
  const body = $("skipTbody");
  if (!body) return;
  body.replaceChildren();
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty";
    cell.textContent = "No reputation history yet";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }
  for (const item of items) {
    const row = document.createElement("tr");
    const values = [
      item.title || "Unknown",
      item.artist || "",
      item.plays || 0,
      item.strikes || 0,
      item.softStrikes || 0,
      item.rating ?? "—",
      item.lastTs ? fmtTime(item.lastTs) : "—",
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (index >= 2 && index <= 5) cell.className = "num";
      row.appendChild(cell);
    });
    body.appendChild(row);
  }
}

async function refreshInsights() {
  try {
    const [top, skip] = await Promise.all([
      api("/admin/top-songs"),
      api("/admin/skip-data"),
    ]);
    renderTopList("topPlayed", top.topPlayed || [], "plays", "plays");
    renderTopList("topStruck", top.topStruck || [], "strikes", "strikes");
    renderSkipTable(skip.tracks || []);
  } catch (_) {
    renderTopList("topPlayed", [], "plays", "plays");
    renderTopList("topStruck", [], "strikes", "strikes");
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.id === "detailsToggle") return;
  try {
    if (button.dataset.programMode) {
      await post(`/mode/${button.dataset.programMode}`);
    } else if (button.dataset.mode) {
      await post(`/admin/lights/mode/${button.dataset.mode}`);
    } else if (button.dataset.videoPlaylist) {
      await post(`/admin/video/play/${button.dataset.videoPlaylist}`);
      result("RSVP TV started", false, "videoResult");
    } else {
      const action = button.dataset.action;
      const routes = {
        "lights-on": "/admin/lights/on",
        "lights-off": "/admin/lights/off",
        "force-sync": "/admin/force-timeblock-sync",
        "clear-manual": "/mode/clear",
        "automation-stop": "/admin/automation/stop",
        "automation-start": "/admin/automation/start",
        "sync-ratings": "/admin/sync-ratings",
        "video-prev": "/admin/video/prev",
        "video-next": "/admin/video/next",
        "video-stop": "/admin/video/stop",
        "plexamp-pause": "/admin/plexamp/pause",
        "plexamp-resume": "/admin/plexamp/resume",
      };
      if (action === "video-pause") {
        const paused = button.dataset.paused === "1";
        await post(paused ? "/admin/video/resume" : "/admin/video/pause");
      } else if (routes[action]) {
        await post(routes[action]);
      } else {
        return;
      }
    }
    result("OK");
    await Promise.all([refreshState(), refreshVideos(), refreshInsights()]);
  } catch (err) {
    result(err.message, true);
  }
});

$("detailsToggle")?.addEventListener("click", () => {
  const body = $("detailsBody");
  const button = $("detailsToggle");
  if (!body || !button) return;
  body.hidden = !body.hidden;
  button.textContent = body.hidden ? "Show technical details ▾" : "Hide technical details ▴";
});

refreshState();
refreshVideos();
refreshInsights();
setInterval(refreshState, 2000);
setInterval(refreshVideos, 15000);
setInterval(refreshInsights, 15000);