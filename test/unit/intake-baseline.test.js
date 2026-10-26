"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { main, loadBaseline, scanPlexLibrary } =
  require("../../intelligence/intake-baseline");

const sample = (id, title, genre="Reggae") => ({
  id, title, artist:"Artist", genres:[genre], addedAt:1761000000,
});
const stamp="2026-10-24T23:00:00.000Z";

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"rsvp-intake-test-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return path.join(dir,"intake-baseline.json");
}

test("initial private baseline creates one mode-0600 JSON state file and never auto-approves tracks",async t=>{
  const file=sandbox(t);
  const result=await main(["--init"],{file,now:stamp,scan:async()=>[
    sample("3","Temperature"),sample("1","No Letting Go"),
  ]});
  assert.equal(result.mode,"initialized");
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
  const content=fs.readFileSync(file,"utf8");
  const data=loadBaseline(file);
  assert.equal(data.tracks.length,2);
  assert.equal("approved" in data,false);
  assert.equal("rotation" in data,false);
  assert.equal(content.includes("X-Plex-Token"),false);
  await assert.rejects(main(["--init"],{file,now:stamp,scan:async()=>[]}),
    /baseline_already_exists_use_check/);
});

test("read-only check finds new track and leaves baseline byte-for-byte intact",async t=>{
  const file=sandbox(t), lines=[];
  await main(["--init"],{file,now:stamp,scan:async()=>[sample("5","Bam Bam")]});
  const before=fs.readFileSync(file,"utf8");
  const result=await main(["--check"],{
    file,now:"2026-10-25T23:00:00.000Z",
    scan:async()=>[sample("5","Bam Bam"),sample("6","Temperature")],
    logger:value=>lines.push(value),
  });
  assert.equal(result.mode,"checked");
  assert.deepEqual(result.delta.candidateNew.map(t=>t.id),["6"]);
  assert.equal(fs.readFileSync(file,"utf8"),before);
  assert.ok(lines.some(x=>x.includes("NEW 6")));
  assert.ok(lines.some(x=>x.includes("baseline NOT advanced")));
});

test("baseline initialization cannot be started from incomplete or empty Plex library",async t=>{
  const file=sandbox(t);
  await assert.rejects(main(["--init"],{file,now:stamp,scan:async()=>{throw new Error("pagination_incomplete")}}),
    /pagination_incomplete/);
  assert.equal(fs.existsSync(file),false);
  await assert.rejects(main(["--init"],{file,now:stamp,scan:async()=>[]}),
    /empty_snapshot_refused/);
  assert.equal(fs.existsSync(file),false);
});

test("corrupt preexisting baseline fails without network scanning or overwrite",async t=>{
  const file=sandbox(t);
  fs.writeFileSync(file,"{broken json");
  let scanned=false;
  await assert.rejects(main(["--check"],{file,scan:async()=>{scanned=true;return[];}}));
  assert.equal(scanned,false);
  assert.equal(fs.readFileSync(file,"utf8"),"{broken json");
});

test("Plex library scan contacts music sections GET-only, not player or playlist mutation endpoints",async()=>{
  const routes=[];
  const fakeRequest=async url=>{
    const u=new URL(url);routes.push({method:"GET",path:u.pathname,query:u.searchParams});
    if(u.pathname==="/library/sections")return{ok:true,text:async()=>'<MediaContainer><Directory key="5" type="artist" title="RSVP Radio"/><Directory key="6" type="show" title="TV"/></MediaContainer>'};
    if(u.pathname==="/library/sections/5/all")return{ok:true,text:async()=>'<MediaContainer totalSize="2"><Track ratingKey="70" title="Reggae" grandparentTitle="Artist"/><Track ratingKey="71" title="Dancehall" grandparentTitle="Artist"/></MediaContainer>'};
    throw new Error("unexpected route: "+u.pathname);
  };
  const tracks=await scanPlexLibrary({base:"http://127.0.0.1:32400",token:"secret-value",request:fakeRequest});
  assert.equal(tracks.length,2);
  assert.deepEqual(routes.map(r=>r.path),[
    "/library/sections","/library/sections/5/all",
  ]);
  assert.equal(routes[1].query.get("type"),"10");
  assert.ok(routes.every(r=>r.query.get("X-Plex-Token")==="secret-value"));
});
