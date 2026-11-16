'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');const start=src.indexOf('async function mlsGd(link, ms, px) {'),end=src.indexOf('// Validate pack identity',start);assert(start>=0&&end>start);
(async()=>{
 const map=new Map();let poll=0,bg=0,session;
 const ctx={require:()=>require('./playback_resolution_cache'),Map,Date,Number,Math,Promise,MLS_GD:map,mlsGdId:u=>u,mlsGdBg:()=>{bg++},mlsGdOnce:async()=>({ok:false,route:'queued',tokUrl:'token',cloud:'cloud',px:'proxy-a'}),mlsGdPoll:async(tok,cloud,ms,px)=>{poll++;session={tok,cloud,ms,px};return {ok:true,direct:'https://worker.test/a',route:'cloud'}}};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end)+'\nglobalThis.run=mlsGd;',ctx);
 const r=await ctx.run('file-1',8500);assert(r.ok);assert.equal(poll,1);assert.deepEqual(JSON.parse(JSON.stringify(session)).tok,'token');assert.equal(session.cloud,'cloud');assert.equal(session.px,'proxy-a');assert.equal(bg,0);assert(map.get('file-1').ok);
 ctx.mlsGdPoll=async(tok,cloud,ms,px)=>({ok:false,route:'queued',tokUrl:tok,cloud,px});const r2=await ctx.run('file-2',8500);assert(!r2.ok);assert.equal(bg,1);assert.equal(map.get('file-2').px,'proxy-a');
 console.log('GDFlix queued sessions continue in foreground within budget and preserve proxy; unresolved sessions continue in background');
})().catch(e=>{console.error(e);process.exit(1)});
