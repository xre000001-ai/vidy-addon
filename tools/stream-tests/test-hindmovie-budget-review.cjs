'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8'),delay=(ms,val)=>new Promise(r=>setTimeout(()=>r(val),ms));
function scheduler(env={}){
 const a=src.indexOf('async function withSources('),b=src.indexOf('// ---------- sources ----------',a);
 const ctx={console,process:{env:{SCUT:'200',VSCAP:'200',NXW:'200',SPAT:'20',VFLOOR:'1',...env}},Promise,Map,Set,Object,Number,Date,Math,String,Array,setTimeout,setInterval,clearTimeout,clearInterval,DBG:false,NXDEADLINE:22000,VRC_TTL:0,
 SRC_CAP_DEF:{hm:12000,nx:12000,dt:12000,cj:12000},SRC_STATS:new Map(),srcCapFor:(k,b)=>b,srcStatRec:()=>{},diag:()=>{},stashPut:()=>{},stashGet:()=>null,LR:{sr:[]},PART_WHY:{nulls:0,err:0,timed:0,stash:0,pend:0,rtw:0},qToList:()=>[],qPass:()=>true,nxLangPass:()=>true,rtLangPass:()=>true,hmForegroundWindow:()=>600};
 vm.runInNewContext(src.slice(a,b)+';globalThis.run=withSources;',ctx);return ctx.run;
}
function helpers(extra={}){
 const a=src.indexOf('function hmForegroundWindow('),b=src.indexOf('async function hmPool(',a);assert(a>=0&&b>a,'HindMovie needs its own absolute foreground budget helper');
 const ctx={process:{env:{}},console,Date,Math,Number,String,Array,Promise,setTimeout,clearTimeout,originOf:()=> 'https://addon.example',suggName:async()=> 'Example',...extra};
 vm.runInNewContext(src.slice(a,b)+';globalThis.windowMs=hmForegroundWindow;globalThis.build=hmPFor;',ctx);return ctx;
}
test('HM budget review: only HindMovie can finish after the old 8.6-equivalent source cut',async()=>{
 const run=scheduler(),began=Date.now(),out=await run(Promise.resolve([{url:'vidy'}]),[{key:'cj',p:delay(30,[{url:'cinejoy'}])},{key:'hm',p:delay(400,[{url:'hm'}])},{key:'dt',p:delay(400,[{url:'other-late'}])}],{},began,'',null);
 assert.deepEqual(Array.from(out,c=>c.url),['vidy','cinejoy','hm']);assert(Date.now()-began>=350);assert(Date.now()-began<900);
});
test('HM budget review: disabling HindMovie preserves every other source cutoff',async()=>{
 const run=scheduler(),began=Date.now(),out=await run(Promise.resolve([]),[{key:'cj',p:delay(25,[{url:'cinejoy'}])},{key:'dt',p:delay(450,[{url:'other-late'}])}],{hm:0},began,'',null);assert.deepEqual(Array.from(out,c=>c.url),['cinejoy']);assert(Date.now()-began<400);
});
test('HM budget review: a hanging HindMovie still has a strict same-request ceiling',async()=>{
 const run=scheduler(),began=Date.now(),out=await run(Promise.resolve([{url:'vidy'}]),[{key:'hm',p:new Promise(()=>{})}],{},began,'',null);assert.deepEqual(Array.from(out,c=>c.url),['vidy']);assert(Date.now()-began>=550);assert(Date.now()-began<1000);
});
test('HM budget review: reserve room inside twelve seconds for formatting and sending, never raise global SCUT/SDL',()=>{
 const c=helpers();assert.equal(c.windowMs(),10500);c.process.env.HM_WINDOW_MS='999999';assert(c.windowMs()<=10800);c.process.env.SDL='9000';assert(c.windowMs()<=7500);assert(src.includes('const SDL_MS = Number(process.env.SDL || 12000)'));assert(src.includes('Number(process.env.SCUT || 8600)'));
});
test('HM budget review: HM-only IMDb requests do not depend on Vidy or another source enabling TMDB',async()=>{
 const calls=[],c=helpers({hmStreams:async(...args)=>{calls.push(args);return[{url:'hm',quality:'1080'}];}}),began=Date.now(),out=await c.build('movie','tt1234567',0,0,{}, {v:0,hm:1},began,null,Promise.resolve('Example'));
 assert.equal(out.length,1);assert.equal(calls.length,1);assert.equal(calls[0][1],'Example');assert.equal(calls[0][7].imdb,'tt1234567');assert(calls[0][7].deadline<=began+10500);assert(calls[0][7].deadline>began+10000);
});
test('HM budget review: a slow global ID lookup cannot hold a known IMDb title out of the HM pipeline',async()=>{
 let called=false;const c=helpers({hmStreams:async()=>{called=true;return[{url:'hm'}];}}),out=await c.build('series','tt1234567',2,4,{}, {hm:1},Date.now(),new Promise(()=>{}),Promise.resolve('Example'));
 assert.equal(called,true);assert.equal(out.length,1);
});
test('HM budget review: metadata time is deducted rather than restarting the source clock',async()=>{
 const c=helpers({process:{env:{HM_WINDOW_MS:'200'}},hmStreams:()=>assert.fail('expired metadata must not start extraction')});const out=await c.build('movie','tt1234567',0,0,{}, {hm:1},Date.now()-500,null,Promise.resolve('Example'));assert.equal(out.length,0);
});
test('HM budget review: disabled HM is zero lookup/extraction work',()=>{
 const c=helpers({suggName:()=>assert.fail('disabled'),hmStreams:()=>assert.fail('disabled')});assert.equal(c.build('movie','tt1234567',0,0,{}, {hm:0},Date.now(),null),null);
});
test('HM budget review: the real server wrapper retains pending state and never stores a partial positive HM cache',async()=>{
 const a=src.indexOf('function hmStreams('),b=src.indexOf('async function hmStreamsRaw(',a),cache=new Map(),ctx={Map,Date,Promise,String,Number,console,NOCACHE:false,DBG:false,HM_RC:cache,HM_INF:new Map(),HM_RC_TTL:1000,
 HM_UPGRADE:{cards:async()=>Object.assign([{url:'ok',quality:'1080'}],{$pend:true}),last:()=>({})},tmdbToImdb:async()=>'',hmCard:()=>null,hmStreamsRaw:()=>assert.fail('legacy'),diag:()=>{}};
 vm.runInNewContext(src.slice(a,b)+';globalThis.run=hmStreams;',ctx);const out=await ctx.run(1,'Example','movie',0,0,'',0,{imdb:'tt1234567',deadline:Date.now()+1000});assert.equal(out.length,1);assert.equal(out.$pend,true);assert.equal(cache.size,0);
});
for(const [pathname,type,s,e] of [['/stream/movie/tmdb27205.json','movie',0,0],['/stream/series/tmdb1396:2:4.json','series',2,4],['/stream/movie/tt1375666.json','movie',0,0],['/stream/series/tt0903747:3:7.json','series',3,7],['/stream/series/tt0903747.json','series',1,1]])test('HM budget review: actual source-only addon route '+pathname,async()=>{
 const start=src.indexOf("    if ((m = p.match(/^\\/stream\\/movie\\/tmdb"),end=src.indexOf('    // ── subtitles-রিসোর্স',start),calls=[];
 const config=Object.fromEntries(['v','nx','tw','rt','mm','m4u','sky','hm','hd','bf','vsp','ott','az','mlb','mls','dt','nex','cj'].map(k=>[k,0]));config.hm=1;
 let done;const sent=new Promise(r=>{done=r;});
 const ctx=helpers({Object,Buffer,config,pathname,DBG:false,RVA:'test',SDL_MS:12000,BF_ENABLED:false,TWBASE:'',RTBASE:'',
  hmStreams:async(...args)=>{calls.push(args);return[{url:'https://hub.workers.dev/0:/Example.1080p.mkv',bingeGroup:'hm|example',quality:'1080'}];},
  nameForTmdb:async()=> 'Example',yearForTmdb:async()=>2020,suggName:async()=> 'Example',findTmdbInfo:()=>assert.fail('HM-only routes must not force the other-source mapping path'),
  nexPFor:()=>null,cjPFor:()=>null,kickSubs:()=>{},twRtPrewarm:()=>{},dtPrewarm:()=>{},nxPrewarm:()=>{},mlbdOn:()=>false,mlsOn:()=>false,dtOn:()=>false,
  withSources:async(cardsP,srcs)=>{const active=srcs.filter(x=>x.p);assert.deepEqual(Array.from(active,x=>x.key),['hm']);return(await Promise.all(active.map(x=>x.p))).flat();},withDeadline:p=>p,
  unifyCards:async c=>c,sendStreams:(res,skey,p,ms,cards)=>done(cards),logReq:()=>{},sendJson:(res,status,obj)=>done(obj),raceObjP:async p=>p?await p:null});
 vm.runInContext('async function route(req,res){const cfg=config,p=pathname;let m;'+src.slice(start,end)+'}\nglobalThis.route=route;',ctx);
 await ctx.route({url:pathname,headers:{host:'addon.example'}},{});const cards=await sent;assert.equal(cards.length,1);assert.equal(calls.length,1);assert.equal(calls[0][2],type);assert.equal(calls[0][3],s);assert.equal(calls[0][4],e);assert(calls[0][7].deadline>Date.now());
});
