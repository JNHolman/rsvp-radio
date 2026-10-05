"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVideoMetadata } = require("../../intelligence/video-metadata");

test("video metadata prefers filename identity and Plex parent artwork", () => {
  const result = parseVideoMetadata(
    '<MediaContainer><Video ratingKey="42" title="Untitled" grandparentTitle="Plex Artist" parentTitle="Project X" parentThumb="/library/metadata/7/thumb" duration="183000"><Media><Part file="/mnt/music/Artist Name - Song Name (Clean).mp4" duration="182000"/></Media></Video></MediaContainer>',
    "42",
  );

  assert.deepEqual(result, {
    ratingKey: "42",
    title: "Song Name",
    artist: "Artist Name",
    album: "Project X",
    thumb: "/library/metadata/7/thumb",
    duration: 182000,
  });
});

test("video artwork falls through Plex thumb, parentThumb, grandparentThumb, then art", () => {
  const base = '<Video ratingKey="9" title="Clip" grandparentTitle="Artist" art="/art.jpg"/>';
  assert.equal(parseVideoMetadata(base.replace(' art=', ' thumb="/thumb.jpg" art='), "9").thumb, "/thumb.jpg");
  assert.equal(parseVideoMetadata(base.replace(' art=', ' parentThumb="/parent.jpg" art='), "9").thumb, "/parent.jpg");
  assert.equal(parseVideoMetadata(base.replace(' art=', ' grandparentThumb="/grandparent.jpg" art='), "9").thumb, "/grandparent.jpg");
  assert.equal(parseVideoMetadata(base, "9").thumb, "/art.jpg");
});

test("video metadata uses Plex tags when the filename has no artist-title separator", () => {
  const result = parseVideoMetadata(
    '<MediaContainer><Video ratingKey="10" title="Plex title" grandparentTitle="Plex artist" parentTitle="Album"><Media><Part file="/mnt/music/clip.mp4"/></Media></Video></MediaContainer>',
    "10",
  );

  assert.equal(result.title, "clip");
  assert.equal(result.artist, "Plex artist");
  assert.equal(result.album, "Album");
});
