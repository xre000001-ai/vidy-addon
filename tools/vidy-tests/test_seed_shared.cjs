'use strict';
const assert=require('node:assert'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(require('path').join(__dirname,'../../server.js'),'utf8');
const f=s.slice(s.indexOf('const SEED_INFLIGHT ='),s.indexOf('async function vidyMetaQ('));
let calls=0,fail=false;
const ctx={Map,Date,JSON,Error,Number,process:{env:{}},SEED_PX:new Map(),API:'https://api.example',vpxCharge:()=>{},vpxSeedCharge:()=>{},proxiedGet:async()=>{calls++;await new Promise(r=>setTimeout(r,15));if(fail)throw Error('bad');return '{"seed":"hello"}';},tfail:()=>{},PTUN_COOL:new Map(),VIDY_DROP:new Set(),VIDY_OK:new Map(),setTimeout};
vm.runInNewContext(f+'; this.seedViaPx=seedViaPx',ctx);
(async()=>{let x=await Promise.all([ctx.seedViaPx('a:1','155',1000),ctx.seedViaPx('a:1','155',1000),ctx.seedViaPx('a:1','155',1000)]);assert.deepEqual(x,['hello','hello','hello']);assert.equal(calls,1);fail=true;await assert.rejects(ctx.seedViaPx('b:1','155',1000));await assert.rejects(ctx.seedViaPx('b:1','155',1000));assert.equal(calls,3);console.log('Concurrent seeds coalesce, failed seed can be retried');})().catch(e=>{console.error(e);process.exitCode=1});
