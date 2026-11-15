'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync('server.js', 'utf8');
const a = src.indexOf('function mmResolveHasSources('), b = src.indexOf('async function mmVidbolt(', a);
assert(a >= 0 && b > a);
const valid = JSON.stringify({stream:{sources:[{url:'https://example.org/master.m3u8'}]}});
const calls=[];
const ctx={URL, AbortSignal, VB_REF:'https://vidbolt.xyz/', UA:'test',
 fetch:async()=>({ok:true,text:async()=>'{"stream":{"sources":[]}}'}),
 mmRacePool:async(u,n,t,accept)=>{calls.push('mm'); assert(!accept('<html>')); throw Error('blocked');},
 racePool:async(u,n,t,key,accept,h)=>{calls.push(key);assert(!accept('{"stream":{"sources":[]}}'));assert(accept(valid)); assert.equal(h.Referer,'https://vidbolt.xyz/'); return {body:valid};}};
vm.createContext(ctx);vm.runInContext(src.slice(a,b)+';globalThis.go=mmResolveText;globalThis.valid=mmResolveHasSources',ctx);
(async()=>{assert(!ctx.valid('<html>'));assert(!ctx.valid('{"stream":{"sources":[]}}'));assert(!ctx.valid('{"stream":{"sources":[{"url":"javascript:evil"}]}}'));assert(ctx.valid(valid));assert.equal(await ctx.go('https://vidbolt.xyz/api/resolve?type=movie&id=1',500),valid);assert.deepEqual(calls,['mm','mm-resolve']);console.log('MM resolver direct/dedicated/source-scored race and body validation passed');})().catch(e=>{console.error(e);process.exitCode=1});
