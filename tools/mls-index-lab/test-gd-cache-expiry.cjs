'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),cache=require('./playback_resolution_cache');const src=fs.readFileSync('server.js','utf8'),a=src.indexOf('async function mlsGd(link, ms, px) {'),b=src.indexOf('// Validate pack identity',a);let calls=0;
const map=new Map(),ctx={require:()=>cache,Date,Number,Math,Promise,MLS_GD:map,mlsGdId:()=> 'id',mlsGdOnce:async()=>{calls++;return {ok:true,direct:'https://worker.example/file',route:'fresh'}},mlsGdBg:()=>{},mlsGdPoll:()=>{}};
vm.createContext(ctx);vm.runInContext(src.slice(a,b)+';globalThis.run=mlsGd',ctx);
(async()=>{let now=Date.now();map.set('id',{ok:true,ts:now-1000,direct:'https://worker.example/file?exp='+Math.floor((now+90000)/1000)});assert.equal((await ctx.run('a',5000)).route,'cache');assert.equal(calls,0);
map.set('id',{ok:true,ts:now-1000,direct:'https://worker.example/file?exp='+Math.floor((now+10000)/1000)});assert.equal((await ctx.run('a',5000)).route,'fresh');assert.equal(calls,1);
map.set('id',{ok:true,ts:now-301000,direct:'https://worker.example/file'});assert.equal((await ctx.run('a',5000)).route,'fresh');assert.equal(calls,2);
assert(!cache.fresh({ok:true,ts:now,direct:'not-a-url'},now));console.log('GDFlix temporary cache respects token expiry and bounded lifetime')})().catch(e=>{console.error(e);process.exitCode=1});
