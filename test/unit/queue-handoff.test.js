"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createQueueHandoff, parsePlayingTimeline, parsePlaylistIndex, parseLibrarySections } =
  require("../../intelligence/queue-handoff");

const timeline = (state = "playing", key = "51", item = "202", queue = "102") =>
  '<MediaContainer><Timeline type="music" state="' + state + '" ratingKey="' + key +
  '" playQueueID="' + queue + '" playQueueItemID="' + item + '"/></MediaContainer>';
const playlist = () =>
  '<MediaContainer totalSize="3" size="3">' +
  '<Track type="track" ratingKey="70" librarySectionID="5"/>' +
  '<Track type="track" ratingKey="71" librarySectionID="5"/>' +
  '<Track type="track" ratingKey="72" librarySectionID="5"/>' +
  '</MediaContainer>';
const sections = '<MediaContainer><Directory key="5" uuid="01234567-aaaa-bbbb-cccc-0123456789ab"/></MediaContainer>';

function mock({ stopped = false, playbackChanges = false, putFails = false } = {}) {
  const calls = [];
  let timelineCalls = 0;
  const fetchWithTimeout = async (url, timeout, opts) => {
    const u = new URL(url);
    const method = opts?.method || "GET";
    calls.push({ method, path: u.pathname, query: u.searchParams });
    assert.equal(u.searchParams.get("X-Plex-Token"), "redacted-token");
    if (u.pathname === "/player/timeline/poll") {
      timelineCalls++;
      return { ok: true, text: async () => timeline(
        stopped ? "stopped" : "playing",
        playbackChanges && timelineCalls > 1 ? "52" : "51",
      ) };
    }
    if (u.pathname === "/playlists/186/items") {
      assert.equal(u.searchParams.get("X-Plex-Container-Size"), "5000");
      return { ok: true, text: async () => playlist() };
    }
    if (u.pathname === "/library/sections") return { ok: true, text: async () => sections };
    if (u.pathname === "/playQueues/102") {
      assert.equal(method, "PUT");
      return putFails ? { ok: false, status: 503 } : { ok: true };
    }
    throw new Error("unexpected API call " + u.pathname);
  };
  const engine = createQueueHandoff({
    plexBase: "http://localhost:32400",
    plexampBase: "http://localhost:32500",
    plexToken: "redacted-token",
    clientId: "pi-client",
    fetchWithTimeout,
    random: () => 0.5,
  });
  return { engine, calls };
}

test("parses only an actually playing Plexamp music timeline with a valid queue", () => {
  assert.deepEqual(parsePlayingTimeline(timeline()), {
    queueId: "102", ratingKey: "51", itemId: "202",
  });
  assert.equal(parsePlayingTimeline(timeline("paused")), null);
  assert.equal(parsePlayingTimeline(timeline("stopped")), null);
  assert.equal(parsePlayingTimeline(timeline("playing", "51", "202", "../../escape")), null);
});
test("playlist and library candidates are validated", () => {
  assert.deepEqual(parsePlaylistIndex(playlist()), [
    { ratingKey: "70", sectionId: "5" },
    { ratingKey: "71", sectionId: "5" },
    { ratingKey: "72", sectionId: "5" },
  ]);
  assert.equal(parsePlaylistIndex('<MediaContainer totalSize="3" size="1"><Track ratingKey="70" librarySectionID="5"/></MediaContainer>'), null);
  assert.equal(parsePlaylistIndex('<MediaContainer size="0"/>'), null);
  assert.equal(parseLibrarySections(sections).get("5"), "01234567-aaaa-bbbb-cccc-0123456789ab");
});

test("5 PM automatic handoff enqueues one song to Play Next, never playMedia or skip", async () => {
  const { engine, calls } = mock();
  const result = await engine.prepareNext({ playlistRatingKey: "186", expectedRatingKey: "51" });
  assert.equal(result.ok, true);
  const mutations = calls.filter(c => c.method !== "GET");
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, "/playQueues/102");
  assert.equal(mutations[0].query.get("next"), "1");
  assert.equal(mutations[0].query.get("uri"),
    "library://01234567-aaaa-bbbb-cccc-0123456789ab/item/library/metadata/71");
  assert.equal(calls.some(c => /playMedia|skipNext|pause|stop/.test(c.path)), false);
  const again = await engine.prepareNext({ playlistRatingKey: "186", expectedRatingKey: "51" });
  assert.equal(again.reason, "already_prepared_or_attempted");
  assert.equal(calls.filter(c => c.method === "PUT").length, 1);
});

test("a stopped Plexamp produces no queue writes or autoplay", async () => {
  const { engine, calls } = mock({ stopped: true });
  const result = await engine.prepareNext({ playlistRatingKey: "186", expectedRatingKey: "51" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "playback_changed_or_stopped");
  assert.equal(calls.filter(c => c.method !== "GET").length, 0);
});
test("a changing song cancels a stale scheduled enqueue", async () => {
  const { engine, calls } = mock({ playbackChanges: true });
  const result = await engine.prepareNext({ playlistRatingKey: "186", expectedRatingKey: "51" });
  assert.equal(result.reason, "playback_changed_before_enqueue");
  assert.equal(calls.filter(c => c.method !== "GET").length, 0);
});
test("explicit manual ownership cancels an automatic handoff", async () => {
  const { engine, calls } = mock();
  const result = await engine.prepareNext({
    playlistRatingKey: "186", expectedRatingKey: "51", isAllowed: () => false,
  });
  assert.equal(result.reason, "not_owner");
  assert.equal(calls.length, 0);
});
test("failed PUT cannot loop and duplicate a queued song on subsequent polls", async () => {
  const { engine, calls } = mock({ putFails: true });
  const first = await engine.prepareNext({ playlistRatingKey: "186", expectedRatingKey: "51" });
  assert.equal(first.ok, false);
  const second = await engine.prepareNext({ playlistRatingKey: "186", expectedRatingKey: "51" });
  assert.equal(second.reason, "already_prepared_or_attempted");
  assert.equal(calls.filter(c => c.method === "PUT").length, 1);
});
