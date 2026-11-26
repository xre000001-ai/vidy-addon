'use strict';
// Execute candidate selection and scanning, rather than pinning obsolete source
// spellings. This replaces the baseline's already-failing literal assertion.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
function cut(a,b){const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i,a);return src.slice(i,j);}
async function trainer(){
 const pools=new Map(),ids=Array.from({length:40},(_,i)=>'node'+i),active={n:0,max:0},checked=[];
 const c={Date,Promise,Map,Set,Math,Number,Object,Array,process:{uptime:()=>200,env:{}},LAST_STREAM_AT:0,MMR_ACTIVE_UNTIL:0,INFLIGHT_STREAM:0,spoolBusy:false,spoolSourceCursor:0,SRC_PROBE:{a:{},b:{},c:{},d:{}},SPOOL:pools,SPOOL_TRIED:new Map(),VIDY_OK:new Map(ids.map(x=>[x,{}])),POOL:[],PX_SITE:new Set(),PX_RAW:[],SPOOL_TGT:288,DBG:false,spoolFresh:e=>!!e.ok,srcPool:k=>{if(!pools.has(k))pools.set(k,new Map());return pools.get(k);},spoolCheck:async(k,px)=>{active.n++;active.max=Math.max(active.max,active.n);checked.push(k+':'+px);await new Promise(r=>setTimeout(r,2));active.n--;return true;},spoolSave:()=>{},console};
 vm.createContext(c);vm.runInContext(cut('async function spoolTrain() {','\nspoolLoad();')+';globalThis.run=spoolTrain;',c);
 await c.run();assert.equal(checked.length,64);assert.equal(new Set(checked).size,64,'each source/candidate pair is checked once');assert(active.max<=32&&active.max>=17,'two source batches stay bounded but concurrent');
 checked.length=0;c.INFLIGHT_STREAM=1;await c.run();assert.equal(checked.length,0,'no new discovery while a request is in flight');
}
async function candidateScan(inflight){
 const discovery=Array.from({length:40},(_,i)=>'n'+i),raw=Array.from({length:60},(_,i)=>'n'+(i+10));
 const checked=[],locks=new Set();let active=0,peak=0,released=0;
 const ctx={Date,Promise,Map,Set,Math,Number,Object,Array,process:{env:{}},POOL:Array.from({length:80},(_,i)=>({px:'n'+(i+20),ms:i})),PX_SITE:new Set(),PX_CAP:1000,free:()=>true,pxScore:(_p,ms)=>ms,pxRawRecent:()=>raw,VY_DISCOVERY:{candidates:()=>discovery},vpxLeft:()=>10,capN:90,_inflight:inflight,vidyReadyCount:()=>0,LAST_STREAM_AT:0,DBG:false,console,VIDY_TRIED:new Map(),triedTtl:300000,vpxTake:px=>{assert(!locks.has(px),'no overlapping work for the same candidate');locks.add(px);return true;},vySlot:async()=>{},vyFree:()=>{},vpxFree:px=>{assert(locks.delete(px));released++;},vidyPing:async px=>{checked.push(px);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;return 10;},vidyNodeOk:()=>{}};
 vm.createContext(ctx);vm.runInContext('globalThis.run=async function(){'+cut('    const poolC = POOL.filter(c => free(c.px))','    if (DBG && (vidySweepBusy')+';return cands;};',ctx);
 const cands=await ctx.run();assert.equal(cands.length,90);assert.equal(new Set(cands).size,90,'raw/discovery/pool overlap is deduplicated by actual selection');assert(cands.includes('n0')&&cands.includes('n69')&&cands.includes('n89'),'all discovery cohorts remain represented');assert.equal(new Set(checked).size,checked.length,'scan batches never overlap candidate calls');assert.equal(released,checked.length);assert.equal(locks.size,0);
 if(inflight){assert.equal(peak,6);assert.equal(checked.length,18,'traffic recovery admits only three small batches');}else{assert.equal(peak,24);assert.equal(checked.length,90,'advance equals the actual slice width');}
}
(async()=>{await trainer();await candidateScan(0);await candidateScan(1);console.log('source trainer: 2x16 bound/traffic pause; VIDY candidate dedup, cohort diversity, non-overlapping 24-wide scan and 6-wide traffic recovery passed');})().catch(e=>{console.error(e);process.exitCode=1;});
