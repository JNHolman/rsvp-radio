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


test("interleaveTracks keeps current track first and mixes both lane pools", () => {
  const outgoing = [
    { ratingKey: "1", title: "Current" },
    { ratingKey: "2", title: "Out 2" },
    { ratingKey: "3", title: "Out 3" },
  ];
  const incoming = [
    { ratingKey: "4", title: "In 1" },
    { ratingKey: "5", title: "In 2" },
  ];

  const mixed = plexControl.interleaveTracks(outgoing, incoming, {
    currentRatingKey: "1",
    maxTracks: 4,
  });

  assert.equal(mixed[0].ratingKey, "1");
  assert.ok(mixed.some((t) => t.ratingKey === "2"));
  assert.ok(mixed.some((t) => t.ratingKey === "4"));
  assert.equal(new Set(mixed.map((t) => t.ratingKey)).size, mixed.length);
});

test("createTrackQueue sends explicit ordered track IDs to Plex", async () => {
  let seenUrl = "";
  const fakeFetch = async (url, opts = {}) => {
    seenUrl = String(url);
    assert.equal(opts.method, "POST");
    return response(
      '<MediaContainer playQueueID="88"><Track key="/library/metadata/1" /></MediaContainer>'
    );
  };

  const queue = await plexControl.createTrackQueue({
    fetchImpl: fakeFetch,
    plexBase: "http://127.0.0.1:32400",
    plexToken: "token",
    tracks: [
      { ratingKey: "1" },
      { ratingKey: "4" },
      { ratingKey: "2" },
    ],
  });

  const u = new URL(seenUrl);
  assert.equal(u.pathname, "/playQueues");
  assert.equal(u.searchParams.get("shuffle"), "0");
  assert.equal(u.searchParams.get("continuous"), "0");
  assert.equal(
    decodeURIComponent(u.searchParams.get("uri")),
    "library:///directory//library/metadata/1,4,2",
  );
  assert.deepEqual(queue, { queueId: "88", selectedKey: "/library/metadata/1" });
});


test("blend weighting favors the incoming pool later in the window", () => {
  const outgoing = [
    { ratingKey: "o1", durationMs: 180000 },
    { ratingKey: "o2", durationMs: 180000 },
    { ratingKey: "o3", durationMs: 180000 },
    { ratingKey: "o4", durationMs: 180000 },
  ];
  const incoming = [
    { ratingKey: "i1", durationMs: 180000 },
    { ratingKey: "i2", durationMs: 180000 },
    { ratingKey: "i3", durationMs: 180000 },
    { ratingKey: "i4", durationMs: 180000 },
  ];

  const mixed = plexControl.interleaveTracks(outgoing, incoming, {
    targetDurationMs: 9 * 60 * 1000,
    incomingWeight: 0.8,
  });

  const incomingCount = mixed.filter((t) => t.ratingKey.startsWith("i")).length;
  const outgoingCount = mixed.filter((t) => t.ratingKey.startsWith("o")).length;
  assert.ok(incomingCount >= outgoingCount);
});

test("blend queue targets duration rather than a fixed track count", () => {
  const outgoing = [
    { ratingKey: "o1", durationMs: 240000 },
    { ratingKey: "o2", durationMs: 240000 },
  ];
  const incoming = [
    { ratingKey: "i1", durationMs: 240000 },
    { ratingKey: "i2", durationMs: 240000 },
  ];

  const mixed = plexControl.interleaveTracks(outgoing, incoming, {
    targetDurationMs: 10 * 60 * 1000,
    incomingWeight: 0.5,
  });

  const total = mixed.reduce((sum, t) => sum + t.durationMs, 0);
  assert.ok(total >= 10 * 60 * 1000 || mixed.length === 4);
});
