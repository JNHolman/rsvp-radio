const test = require("node:test");
const assert = require("node:assert/strict");
const plexControl = require("../../intelligence/plex-control");

function response(xml, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml,
  };
}

test("resolveConfiguredLanes keeps only playlists that actually exist", async () => {
  const fakeFetch = async () => response(
    '<MediaContainer>' +
      '<Playlist ratingKey="10" title="RSVP RAP - Main" playlistType="audio" smart="0" />' +
      '<Playlist ratingKey="11" title="RSVP RAP - Left" playlistType="audio" smart="1" />' +
      '<Playlist ratingKey="99" title="Video Stuff" playlistType="video" smart="0" />' +
    '</MediaContainer>'
  );

  const result = await plexControl.resolveConfiguredLanes({
    fetchImpl: fakeFetch,
    plexBase: "http://127.0.0.1:32400",
    plexToken: "token",
  }, {
    rap: [
      { title: "RSVP RAP - Main" },
      { title: "RSVP RAP - Left" },
      { title: "Missing" },
    ],
  });

  assert.deepEqual(
    result.lanes.rap.map((x) => [x.title, x.ratingKey]),
    [["RSVP RAP - Main", "10"], ["RSVP RAP - Left", "11"]],
  );
});

test("createPlaylistQueue builds a shuffled continuous audio queue", async () => {
  let seenUrl = "";
  let seenMethod = "";
  const fakeFetch = async (url, opts = {}) => {
    seenUrl = String(url);
    seenMethod = opts.method || "GET";
    return response('<MediaContainer playQueueID="55"><Track key="/library/metadata/123" /></MediaContainer>');
  };

  const queue = await plexControl.createPlaylistQueue({
    fetchImpl: fakeFetch,
    plexBase: "http://127.0.0.1:32400",
    plexToken: "token",
    playlistRatingKey: "10",
  });

  const u = new URL(seenUrl);
  assert.equal(seenMethod, "POST");
  assert.equal(u.pathname, "/playQueues");
  assert.equal(u.searchParams.get("playlistID"), "10");
  assert.equal(u.searchParams.get("shuffle"), "1");
  assert.equal(u.searchParams.get("continuous"), "1");
  assert.deepEqual(queue, { queueId: "55", selectedKey: "/library/metadata/123" });
});

test("playQueueOnPlexamp targets the local companion endpoint", async () => {
  let seen = "";
  const fakeFetch = async (url) => {
    seen = String(url);
    return response("");
  };

  await plexControl.playQueueOnPlexamp({
    fetchImpl: fakeFetch,
    plexampBase: "http://127.0.0.1:32500",
    plexBase: "http://127.0.0.1:32400",
    plexToken: "token",
    machineIdentifier: "server-id",
    targetClientIdentifier: "plexamp-id",
    queueId: "55",
    selectedKey: "/library/metadata/123",
    commandId: 7,
  });

  const u = new URL(seen);
  assert.equal(u.origin, "http://127.0.0.1:32500");
  assert.equal(u.pathname, "/player/playback/playMedia");
  assert.equal(u.searchParams.get("containerKey"), "/playQueues/55?window=100&own=1");
  assert.equal(u.searchParams.get("X-Plex-Target-Client-Identifier"), "plexamp-id");
  assert.equal(u.searchParams.get("commandID"), "7");
});
