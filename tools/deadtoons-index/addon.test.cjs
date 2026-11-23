'use strict';
// Execute the actual DT task in a VM with only mocked final-link resolution.
// No server boot, socket, gate, HTML, player, HEAD, Range or media request occurs.
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const C=require('./core.cjs'),R=require('./runtime.cjs'),{namedFunction}=require('../source-review-tests/extract.cjs');
const server=fs.readFileSync(path.resolve(__dirname,'../../server.js'),'utf8');
function harness({proof=async url=>({direct:url,size:0,name:'fixture.mkv'}),fastTimers=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt419-addon-')),rows={naruto:[[1,1,1,1080,'same'],[1,1,0,1080,'same']]},state={},shardState={},cache=new Map(),calls={network:0,proof:0,gate:0},timers=new Set(),errors=[];
 C.split(rows).forEach((p,i)=>C.write(path.join(dir,'dti',C.filename(i)),p));
 const runtime=R.create({seedDir:dir,mirrors:[],state,shardState,cache,fetch:async()=>{calls.network++;throw Error('No index network from lookup');}}),unlocks=new Map(),results=new Map();
 const schedule=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},fastTimers?Math.min(ms,3):ms);timers.add(id);return id;};
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const context=vm.createContext({Promise,Date,Map,Set,Number,String,Math,Array,process:{env:{}},setTimeout:schedule,console:{error:(...args)=>errors.push(args.join(' '))},DBG:true,DT_C:results,DT_UNLOCK:unlocks,DT_UNLOCK_JOBS:new Map(),DT_IDX:state,DT_SH:shardState,DT_SH_CACHE:cache,DT_INDEX:runtime,DT_ST:{hit:0,noMatch:0,cands:0,idxReady:0,proofOk:0,proofFail:0,fast:0,watch:0,last:''},SDL_MS:10000,
  mlsNorm:norm,mlsQ:v=>Number((String(v||'').match(/\d{3,4}/)||[])[0]||0),mlsMB:()=>'',dtIxSlugOf:R.titleKey,dtShardFor:slug=>runtime.lookup(slug),dtShNo:C.shard,dtIdxByTitle:()=>null,dtAudio:()=>'',diag:()=>{},_shrink:()=>{},
  dtFileProof:async url=>{calls.proof++;return proof(url);},dtJson:async()=>{calls.network++;throw Error('Indexed DT must not search upstream');},dtJsonPost:async()=>{calls.gate++;throw Error('Indexed DT must not start gates');},dtUSave:()=>{},fetch:async()=>{calls.network++;throw Error('Unexpected network');}
 });
 vm.runInContext(['dtRowsToLinks','dtDlCands','dtUnlockOne','dtTask'].map(n=>namedFunction(server,n)).join('\n'),context);
 return {context,calls,errors,runtime,unlocks,results,async run(){return context.dtTask(Promise.resolve('Naruto'),Promise.resolve({name:'Naruto',year:2002}),'series',1,1,'');},async close(){for(const id of timers)clearTimeout(id);await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('DT actual addon first-ready: a ready Pixeldrain card returns before deferred HubCloud; late mirror merges into that generation cache',{timeout:3000},async()=>{
 let release;const pending=new Promise(r=>{release=r;}),h=harness({proof:async url=>url.includes('hubcloud')?pending:{direct:url,size:0,name:'fixture.mkv'}});
 try{const cards=await h.run();a.equal(cards.length,1,h.errors.join('\n'));a(cards[0].url.includes('pixeldrain'));a.equal(h.calls.network,0);a.equal(h.calls.gate,0);a.equal(h.unlocks.size,2,'Identical IDs on distinct hosts cannot collide');
  release({direct:'https://hubcloud.pw/drive/same',size:0,name:'fixture.mkv'});await new Promise(setImmediate);await new Promise(setImmediate);a.equal([...h.results.values()][0].cards.length,2,'Late mirror retained after first-ready response');
 }finally{release(null);await h.close();}
});
test('DT actual addon uses new same-count generation keys rather than serving previous-generation result cards',{timeout:3000},async()=>{
 const h=harness();try{const before=await h.run();a.equal(before.length,2,h.errors.join('\n'));a.equal(h.results.size,1);h.runtime.state.generation='different-fixture-generation';const after=await h.run();a.equal(after.length,2);a.equal(h.results.size,2,'Same-count generation must miss old DT cache key');a.equal(h.calls.proof,4);a.equal(h.calls.network,0);a.equal(h.calls.gate,0);}finally{await h.close();}
});
test('DT actual addon settled-empty path skips the5.2s idle wait, never unlocks final file IDs or negative-caches an empty result',{timeout:3000},async()=>{
 const h=harness({proof:async()=>null,fastTimers:false});try{const at=Date.now(),cards=await h.run();a.equal(cards.length,0);a(Date.now()-at<1500,'Mocked already-settled stages must not idle5.2s');await new Promise(setImmediate);await new Promise(setImmediate);a.equal(h.calls.gate,0);a.equal(h.calls.network,0);a(![...h.results.values()].some(r=>!r.cards.length),'Empty result must not become a false30-minute hit');}finally{await h.close();}
});
