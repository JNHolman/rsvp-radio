"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSections, parseAudioPlaylists, parseTrackPage, loadPages, reviewReport,
} = require("../../intelligence/library-intake");

const track = (id, { genre = "", addedAt = "" } = {}) =>
  '<Track type="track" ratingKey="' + id + '" title="Track ' + id +
  '" grandparentTitle="Artist" addedAt="' + addedAt + '">' +
  (genre ? '<Genre tag="' + genre + '"/>' : "") + '</Track>';
const page = (ids, total, props = {}) =>
  '<MediaContainer' + (total === null ? "" : ' totalSize="' + total + '"') +
  ' size="' + ids.length + '">' +
  ids.map(id => track(id, props)).join("") + '</MediaContainer>';

test("intake inspects only music library sections and audio playlists", () => {
  assert.deepEqual(parseSections('<MediaContainer>' +
    '<Directory type="artist" key="5" title="Music"/>' +
    '<Directory type="movie" key="6" title="TV"/>' +
    '<Directory type="show" key="7" title="Shows"/>' +
    '<Directory type="music" key="8" title="More Music"/></MediaContainer>'), [
    { id: "5", name: "Music" }, { id: "8", name: "More Music" },
  ]);
  assert.deepEqual(parseAudioPlaylists('<MediaContainer>' +
    '<Playlist playlistType="audio" ratingKey="12" title="90s Hip Hop"/>' +
    '<Playlist playlistType="video" ratingKey="13" title="Rap Videos"/>' +
    '</MediaContainer>'), [{ id: "12", name: "90s Hip Hop" }]);
});

test("library scan refuses pages without provable totalSize, playlist page may be unknown", () => {
  assert.equal(parseTrackPage(page(["20"], null)), null);
  assert.equal(parseTrackPage(page(["20"], null), { requireTotal: false }).total, null);
  assert.equal(parseTrackPage(page(["20", "21"], 1)), null);
  assert.equal(parseTrackPage("<invalid"), null);
});

test("paged scan includes every track exactly once across multiple pages", async () => {
  const all = ["20", "21", "22", "23", "24"];
  const calls = [];
  const get = async (_path, params) => {
    const start = Number(params["X-Plex-Container-Start"]);
    const size = Number(params["X-Plex-Container-Size"]);
    calls.push([start,size]);
    return page(all.slice(start,start+size),all.length);
  };
  const tracks = await loadPages(get, "/library/sections/5/all", { type: 10 }, { pageSize: 2 });
  assert.equal(tracks.length, 5);
  assert.deepEqual(tracks.map(t=>t.id),all);
  assert.deepEqual(calls,[[0,2],[2,2],[4,2]]);
});

test("when playlist has no totalSize, exact-size pages do not truncate inventory", async () => {
  const all = ["20","21","22","23"];
  const calls=[];
  const get = async (_path, params) => {
    const start=Number(params["X-Plex-Container-Start"]);
    calls.push(start);
    return page(all.slice(start,start+2),null);
  };
  const tracks = await loadPages(get,"/playlists/33/items",{},{
    pageSize:2,requireTotal:false,
  });
  assert.deepEqual(tracks.map(t=>t.id),all);
  assert.deepEqual(calls,[0,2,4]);
});

test("scanner rejects changes and duplicates mid-pagination", async () => {
  const inconsistent = async (_p, params) => Number(params["X-Plex-Container-Start"]) === 0
    ? page(["1","2"],4) : page(["3"],5);
  await assert.rejects(
    loadPages(inconsistent,"/library/sections/5/all",{}, {pageSize:2}),
    /library_changed_during_scan/,
  );
  const duplicate = async (_p, params) => Number(params["X-Plex-Container-Start"]) === 0
    ? page(["1","2"],4) : page(["2","3"],4);
  await assert.rejects(
    loadPages(duplicate,"/library/sections/5/all",{}, {pageSize:2}),
    /duplicate_track_in_pages/,
  );
});

test("30-day intake report counts unlisted new music but never approves it", () => {
  const now = Date.UTC(2026,9,24);
  const older = Math.floor((now - 45*86400000)/1000);
  const newer = Math.floor((now - 2*86400000)/1000);
  const libraryTracks = [
    { id:"1", artist:"Artist", title:"Listed", addedAt:older, genres:["Reggae"] },
    { id:"2", artist:"Artist", title:"New Reggae", addedAt:newer, genres:["Reggae/Dancehall"] },
    { id:"3", artist:"Artist", title:"Afrobeats", addedAt:newer, genres:["Afrobeats"] },
    { id:"4", artist:"Artist", title:"Untyped", addedAt:null, genres:[] },
  ];
  const report=reviewReport({
    libraryTracks,
    playlists:[{id:"10",name:"80s Reggae/Afrobeats"}],
    entriesByPlaylist:new Map([["10",[{id:"1"}]]]),
    asOfMs:now, days:30,
  });
  assert.equal(report.libraryTracks,4);
  assert.equal(report.playlistEntries,1);
  assert.equal(report.outsideCount,3);
  assert.equal(report.recentCount,2);
  assert.equal(report.recentOutsideCount,2);
  assert.equal(report.reggaeTaggedCount,2);
  assert.equal(report.reggaeTaggedOutside,1);
  assert.equal(report.afrobeatsTaggedCount,1);
  assert.equal(report.afrobeatsTaggedOutside,1);
  assert.equal(report.missingAddedAt,1);
  assert.equal(report.recentOutside[0].id,"2");
  assert.equal(Object.hasOwn(report,"approved"),false);
});
