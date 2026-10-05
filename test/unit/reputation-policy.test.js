"use strict";
const test=require("node:test"); const assert=require("node:assert/strict"); const fs=require("fs"); const os=require("os"); const path=require("path");
const {createTracker}=require("../../intelligence/skip-tracker");
function fresh(){const d=fs.mkdtempSync(path.join(os.tmpdir(),"rsvp-rep-")); return createTracker(path.join(d,"data.json"));}
const t={ratingKey:"1",title:"A",artist:"B"};
test("40 percent is a listen and does not add a strike",()=>{const r=fresh(); r.recordSkip(t,.4); assert.equal(r.getStatus("1"),null);});
test("hard skip adds strike and cooldown",()=>{const r=fresh(); r.recordSkip(t,.1); const s=r.getStatus("1"); assert.equal(s.strikes,1); assert.equal(r.isOnCooldown("1"),true);});
test("two soft skips become one hard strike",()=>{const r=fresh(); r.recordSkip(t,.3); r.recordSkip(t,.3); assert.equal(r.getStatus("1").strikes,1);});
test("four strikes can redeem but five is permanent",()=>{const a=fresh(); for(let i=0;i<4;i++)a.recordSkip(t,.1); a.recordPlay(t); assert.equal(a.getStatus("1").strikes,3); const b=fresh(); for(let i=0;i<5;i++)b.recordSkip(t,.1); b.recordPlay(t); assert.equal(b.getStatus("1").strikes,5); assert.equal(b.isOnCooldown("1"),true);});
test("separate trackers do not contaminate each other",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"rsvp-media-")); const a=createTracker(path.join(root,"audio.json")); const v=createTracker(path.join(root,"video.json")); a.recordSkip(t,.1); assert.equal(v.getStatus("1"),null);});
