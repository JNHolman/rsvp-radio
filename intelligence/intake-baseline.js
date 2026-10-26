"use strict";

/**
 * RSVP music intake baseline: separate, manual, OFF-AIR command.
 *
 * Initial baseline: --init   (one deliberate local JSON write, mode 0600)
 * Change report:   --check  (read-only; the initial baseline is never advanced)
 *
 * No automation, admission, queue mutation, Plex changes or HTTP server.
 * This script and its two sibling modules may be downloaded to the same /tmp
 * directory while keeping the checked-out live Pi production code unchanged.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseSections, loadPages } = require("./library-intake");
const { snapshot, validateSnapshot, compareSnapshots } = require("./intake-ledger");

const DEFAULT_BASELINE = path.join(os.homedir(), ".local", "state", "rsvp-radio", "intake-baseline.json");
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;

function createBaseline(file, value) {
  validateSnapshot(value);
  const dir = path.dirname(file);
  // Private home-state folder is outside the live repository and service files.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const raw = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(raw) > MAX_SNAPSHOT_BYTES) throw new Error("baseline_too_large");
  let fd;
  let wrote = false;
  try {
    fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, raw);
    fs.fsyncSync(fd);
    wrote = true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (!wrote && fd !== undefined) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
}

function loadBaseline(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SNAPSHOT_BYTES) {
    throw new Error("untrusted_baseline_file");
  }
  return validateSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
}

async function scanPlexLibrary({ base, token, request = global.fetch, logger = () => {} }) {
  if (!base || !token) throw new Error("missing_plex_credentials");
  const host = String(base).replace(/\/+$/, "");
  const get = async (endpoint, query={}) => {
    const url = new URL(host + endpoint);
    url.searchParams.set("X-Plex-Token", token);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    const response = await request(url, { method: "GET", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("plex_read_http_" + response.status);
    return response.text();
  };
  const sections = parseSections(await get("/library/sections"));
  if (!sections || sections.length === 0) throw new Error("music_sections_unavailable");
  const ids = new Set(), tracks = [];
  for (const section of sections) {
    const entries = await loadPages(get, "/library/sections/" + section.id + "/all", { type: 10 });
    logger("Music section " + section.name + ": " + entries.length + " records");
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error("duplicate_track_across_music_sections");
      ids.add(entry.id);
      tracks.push(entry);
    }
  }
  if (!tracks.length) throw new Error("empty_music_library_refusing_baseline");
  return tracks;
}

function printChanges(delta, log = console.log) {
  log("Previously known: " + delta.previousCount + " | Current library: " + delta.currentCount);
  log("Newly detected IDs (REVIEW ONLY): " + delta.candidateNew.length);
  log("Missing IDs (investigate, no deletion): " + delta.candidateMissing.length);
  log("Changed metadata: " + delta.metadataChanged.length);
  log("Confirmed unique-file ID remaps: " + delta.reindexed.length);
  log("Ambiguous title matches (reindex/remix): " + delta.uncertain.length);
  for (const t of delta.candidateNew.slice(0, 25)) {
    log("  NEW " + t.id + " | " + t.artist + " — " + t.title +
      " | " + (t.genres.join(", ") || "genre unknown"));
  }
  for (const t of delta.candidateMissing.slice(0, 10)) {
    log("  MISSING " + t.id + " | " + t.artist + " — " + t.title);
  }
  for (const x of delta.uncertain.slice(0, 10)) {
    log("  UNCERTAIN " + x.newId + " (prior: " + x.previousIds.join(",") + ") | " +
      x.artist + " — " + x.title);
  }
  if (delta.candidateNew.length > 25 || delta.candidateMissing.length > 10) {
    log("Some candidates omitted from terminal display. Baseline unchanged.");
  }
  log("No changes admitted to rotation; baseline NOT advanced.");
}

async function main(argv = process.argv.slice(2), opts = {}) {
  if (argv.length !== 1 || !["--init","--check"].includes(argv[0])) {
    throw new Error("usage: node intake-baseline.js --init | --check");
  }
  const mode = argv[0];
  const file = opts.file || DEFAULT_BASELINE;
  const fsExists = fs.existsSync(file);
  if (mode === "--init" && fsExists) throw new Error("baseline_already_exists_use_check");
  if (mode === "--check" && !fsExists) throw new Error("baseline_missing_initialize_first");
  // Validate before network scan. Corrupt state should never be overwritten.
  const previous = mode === "--check" ? loadBaseline(file) : null;
  const now = opts.now || new Date().toISOString();
  const tracks = await opts.scan();
  const current = snapshot(tracks, now);
  if (mode === "--init") {
    if (!current.tracks.length) throw new Error("empty_snapshot_refused");
    createBaseline(file, current);
    console.log("RSVP Music Intake baseline INITIALIZED: " + current.tracks.length + " tracks");
    console.log("Saved private checkpoint: " + file);
    console.log("This initial checkpoint does not approve or add songs to any playlist.");
    console.log("Subsequent --check scans will compare against this fixed baseline.");
    return { mode: "initialized", count: current.tracks.length };
  }
  const delta = compareSnapshots(previous, current);
  printChanges(delta, opts.logger || console.log);
  return { mode: "checked", delta };
}

if (require.main === module) {
  (async () => {
    require(path.join(process.cwd(), "node_modules/dotenv"))
      .config({ path: path.join(process.cwd(), ".env"), quiet: true });
    const cfg = require(path.join(process.cwd(), "config"));
    console.log("RSVP MUSIC INTAKE BASELINE — NO PLAYBACK / NO PLAYLIST WRITES");
    await main(process.argv.slice(2), {
      scan: () => scanPlexLibrary({
        base: cfg.PLEX_BASE, token: cfg.PLEX_TOKEN, logger: console.log,
      }),
    });
  })().catch(error => {
    console.error("INTAKE STOPPED:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, createBaseline, loadBaseline, scanPlexLibrary, printChanges };
