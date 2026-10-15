"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCurrentQueueContext, parseUpcomingQueue } = require("../../intelligence/plex-queue");

const xml = '<MediaContainer size="1"><Track title="Playing" ratingKey="51" playQueueID="102" playQueueItemID="202"><Player product="Plexamp" machineIdentifier="rsvp-pi" state="playing"/></Track></MediaContainer>';

test("reads a queue only from the intended Plexamp session", () => {
  assert.deepEqual(parseCurrentQueueContext(xml, "rsvp-pi"), { queueId:"102", itemId:"202", ratingKey:"51" });
  assert.equal(parseCurrentQueueContext(xml, "other-client"), null);
});
test("rejects absent and invalid queue identifiers", () => {
  assert.equal(parseCurrentQueueContext('<MediaContainer><Track ratingKey="2"><Player product="Plexamp"/></Track></MediaContainer>'), null);
  assert.equal(parseCurrentQueueContext('<MediaContainer><Track playQueueID="../../oops"><Player product="Plexamp"/></Track></MediaContainer>'), null);
});
test("returns only tracks strictly after active queue entry", () => {
  const result = parseUpcomingQueue({MediaContainer:{Metadata:[
    {ratingKey:"50",playQueueItemID:201,title:"Previously played"},
    {ratingKey:"51",playQueueItemID:202,title:"Playing"},
    {ratingKey:"52",playQueueItemID:203,title:"Next",grandparentTitle:"Artist",thumb:"/library/metadata/52/thumb"},
    {ratingKey:"53",playQueueItemID:204,title:"Later"},
  ]}}, {itemId:"202",ratingKey:"51"});
  assert.equal(result.available, true);
  assert.deepEqual(result.tracks.map(x=>x.title),["Next","Later"]);
  assert.equal(result.tracks[0].artist, "Artist");
});
test("tracks duplicated in a queue are identified by unique playQueueItemID", () => {
  const queue = {MediaContainer:{Metadata:[
    {ratingKey:"51",playQueueItemID:111,title:"Duplicate prior"},
    {ratingKey:"51",playQueueItemID:222,title:"Current"},
    {ratingKey:"51",playQueueItemID:333,title:"Duplicate upcoming"},
  ]}};
  assert.deepEqual(parseUpcomingQueue(queue, {itemId:"222",ratingKey:"51"}).tracks.map(t=>t.title),["Duplicate upcoming"]);
});
test("stale queue is unavailable, never a guessed upcoming playlist", () => {
  const q = {MediaContainer:{Metadata:[{ratingKey:"30",playQueueItemID:300,title:"Unrelated"}]}};
  assert.deepEqual(parseUpcomingQueue(q,{itemId:"202",ratingKey:"51"}),{available:false,tracks:[],reason:"current_track_not_in_queue"});
});
