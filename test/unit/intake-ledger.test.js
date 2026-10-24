"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshot, validateSnapshot, compareSnapshots, pathHash } =
  require("../../intelligence/intake-ledger");

const iso = "2026-10-24T23:00:00.000Z";
const record = (id,title,other={}) => ({
  id, artist:"Artist",title,genres:["Reggae"],...other,
});

test("intake initial baseline is deterministic and stores no raw file path", () => {
  const filePath="/private/music/Sean Paul - Temperature.flac";
  const base=snapshot([record("3","Temperature",{filePath}),record("1","No Letting Go")],iso);
  assert.deepEqual(base.tracks.map(t=>t.id),["1","3"]);
  assert.equal(base.tracks[1].fileHash,pathHash(filePath));
  assert.equal(JSON.stringify(base).includes("/private"),false);
  assert.equal(base.tracks[0].fileHash,null);
  assert.equal(validateSnapshot(base),base);
});

test("new Plex ratingKey is a candidate even when its addedAt is old or recent", () => {
  const first=snapshot([record("10","Song A")],iso);
  const second=snapshot([record("10","Song A"),record("11","Song B")],iso);
  const delta=compareSnapshots(first,second);
  assert.deepEqual(delta.candidateNew.map(t=>t.id),["11"]);
  assert.equal(delta.candidateMissing.length,0);
  assert.equal(delta.previousCount,1);
  assert.equal(delta.currentCount,2);
  assert.equal(delta.requiresHumanReview,true);
});

test("changed Plex ratingKey with identical unique file identity is reindexed, not new", () => {
  const filePath="/private/audio/trinity/Temperature.mp3";
  const first=snapshot([record("10","Temperature",{filePath})],iso);
  const second=snapshot([record("99","Temperature",{filePath})],iso);
  const delta=compareSnapshots(first,second);
  assert.deepEqual(delta.reindexed,[{
    oldId:"10",newId:"99",title:"Temperature",artist:"Artist",
  }]);
  assert.equal(delta.candidateNew.length,0);
  assert.equal(delta.candidateMissing.length,0);
});

test("shared song title does not silently collapse alternate versions", () => {
  const first=snapshot([record("10","Gimme the Light",{filePath:"/songs/original.mp3"})],iso);
  const second=snapshot([record("99","Gimme the Light",{filePath:"/songs/remix.mp3"})],iso);
  const delta=compareSnapshots(first,second);
  assert.equal(delta.reindexed.length,0);
  assert.deepEqual(delta.candidateNew.map(x=>x.id),["99"]);
  assert.equal(delta.uncertain.length,1);
  assert.equal(delta.uncertain[0].reason,"possibly_reindexed_or_different_version");
});

test("mood classifications cannot be inferred by the intake ledger", () => {
  const one=snapshot([record("1","Song", {genres:["Reggae"]})],iso);
  const two=snapshot([record("1","Song", {genres:["Dancehall"]})],iso);
  const changes=compareSnapshots(one,two);
  assert.deepEqual(changes.metadataChanged.map(x=>x.id),["1"]);
  assert.equal("approved" in changes,false);
  assert.equal("energy" in changes,false);
});

test("snapshot validation rejects corrupt IDs or hashes", () => {
  assert.throws(()=>snapshot([record("1","A"),record("1","B")],iso),/duplicate/);
  assert.throws(()=>snapshot([record("hi","A")],iso),/invalid/);
  const bad=snapshot([record("1","A")],iso);
  bad.tracks[0].fileHash="not-hash";
  assert.throws(()=>validateSnapshot(bad),/invalid_intake_snapshot/);
  assert.throws(()=>compareSnapshots({tracks:[],version:4,scannedAt:iso},snapshot([],iso)),
    /unsupported_intake_snapshot/);
});