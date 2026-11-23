'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
const from=src.indexOf("    if ((m = p.match(/^\\/stream\\/movie\\/tmdb"),to=src.indexOf('    // ── subtitles-রিসোর্স',from);assert(from>0&&to>from);
const routes=src.slice(from,to);
const builder=src.slice(src.indexOf('function cjPFor('),src.indexOf('// CINEJOY-END'));
const paths=[['/stream/movie/tmdb27205.json','movie','27205',0,0],['/stream/series/tmdb1396:2:4.json','series','1396',2,4],['/stream/movie/tt1375666.json','movie','tt1375666',0,0],['/stream/series/tt0903747:3:7.json','series','tt0903747',3,7],['/stream/series/tt0903747.json','series','tt0903747',1,1]];
for(const[pathname,type,id,s,e]of paths)test('actual addon route wires CineJoy independently: '+pathname,async()=>{
 const calls=[],config=Object.fromEntries(['v','nx','tw','rt','mm','m4u','sky','hm','hd','bf','vsp','ott','az','mlb','mls','dt','nex'].map(k=>[k,0]));config.cj=1;
 let done;const sent=new Promise(r=>{done=r;});
 const ctx={console,process:{env:{}},Date,Promise,Number,String,Array,Math,Object,Buffer,config,pathname,DBG:false,RVA:'test',SDL_MS:12000,BF_ENABLED:false,TWBASE:'',RTBASE:'',
  CINEJOY:{streams:async o=>{calls.push(o);return[{url:'https://lightspeed.st/card.m3u8',bingeGroup:'cj|Light|1080'}];}},originOf:()=> 'https://addon.example',
  nameForTmdb:async()=>type==='movie'?'Inception':'Breaking Bad',yearForTmdb:async()=>2010,suggName:async()=>type==='movie'?'Inception':'Breaking Bad',
  nexPFor:()=>null,kickSubs:()=>{},twRtPrewarm:()=>{},dtPrewarm:()=>{},nxPrewarm:()=>{},mlbdOn:()=>false,mlsOn:()=>false,dtOn:()=>false,
  withSources:async(cardsP,srcs)=>{const active=srcs.filter(x=>x.p);assert.deepEqual(Array.from(active,x=>x.key),['cj']);return(await Promise.all(active.map(x=>x.p))).flat();},withDeadline:p=>p,
  unifyCards:async c=>c,sendStreams:(res,skey,p,ms,cards)=>done(cards),logReq:()=>{},sendJson:(res,status,obj)=>done(obj),raceObjP:async p=>p?await p:null};
 vm.runInNewContext(builder+'\nasync function route(req,res){const cfg=config,p=pathname;let m;'+routes+'}\nglobalThis.route=route;',ctx);
 await ctx.route({url:pathname,headers:{host:'addon.example'}},{});const cards=await sent;
 assert.equal(cards.length,1);assert.equal(calls.length,1);const got=calls[0];assert.equal(got.type,type);assert.equal(String(got.id),id);assert.equal(got.season,s);assert.equal(got.episode,e);assert.equal(got.config.cj,1);
});
test('CineJoy route helper returns null before any extraction when disabled',()=>{const c={CINEJOY:{streams:()=>assert.fail('disabled source must not run')}};vm.runInNewContext(builder+';globalThis.build=cjPFor;',c);assert.equal(c.build('movie','27205',0,0,{}, {cj:0}),null);});
test('actual addon formatter preserves CineJoy source/server labels and source captions in final JSON',()=>{
 const a=src.indexOf('const FMT_JUNK ='),b=src.indexOf('const YEAR_CACHE =',a);assert(a>0&&b>a);
 const ctx={console,process:{env:{}},URL,Map,Set,Buffer};vm.runInNewContext(src.slice(a,b)+';globalThis.format=fmtCards;globalThis.strip=stripCards;',ctx);
 const {cardsFor}=require('../vidy-runtime/cinejoy.cjs'),{result,sample}=require('./addon-helpers.cjs');
 const cards=cardsFor(result(),sample,'https://addon.example',{});ctx.format(cards);const out=ctx.strip(cards);
 assert(out.every(c=>c.title.includes('⌘ CineJoy')&&c.title.endsWith('• Light')));assert(out.every(c=>c.subtitles.length===1&&c.subtitles[0].lang==='eng'));assert(out.every(c=>!('_src'in c)&&!('_srv'in c)&&!('quality'in c)));
});
test('actual addon final URL wrapper never mutates a CineJoy signed CDN URL',()=>{
 const a=src.indexOf('const REL_ON ='),b=src.indexOf('const REL_C =',a);const ctx={process:{env:{}},require,URL,Map,Set,Buffer,Date};vm.runInNewContext(src.slice(a,b)+';globalThis.wrap=relWrapBody;',ctx);
 const url='https://erebus.cursed.st/playlists/movie/27205/1080p.m3u8?token=a%2Fb',input=JSON.stringify({streams:[{url,bingeGroup:'cj|Polaris|1080'}]});assert.equal(ctx.wrap(input,'https://addon.example'),input);
});
