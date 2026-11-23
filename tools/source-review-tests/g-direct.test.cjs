'use strict';
// User-requested G-Direct exclusion, not a ban on Google Drive or shared GU.
const test=require('node:test'),assert=require('node:assert/strict');
const {m4u,plain,source,namedFunction}=require('./helpers.cjs');
const catalog=require('./fixtures/td-catalog.json');
const target='https://fastdl.beer/embed?download=selected-file';
const gu='https://video-downloads.googleusercontent.com/fixture-selected-token';
const card=(srv,url)=>({_srv:srv,_src:'Movies4u',quality:'720',url,title:'Example | 2020',headers:{Referer:'https://source.example/'},subtitles:[{id:'eng',url:'https://subs.example/native.vtt',lang:'eng'}],behaviorHints:{filename:'Example.S01E02.720p.mkv',proxyHeaders:{request:{'User-Agent':'preserved'}}}});
function td(){
 const h=m4u(['m4uTdStreams']);h.ctx.M4U_TD_S.set('Example',{ts:h.clock.now,posts:[{url:'post-a',slug:'example-2020'}]});h.ctx.M4U_TD_CACHE.set('post-a',{ts:h.clock.now,list:[{q:'720',size:'1 GB',mdisk:'https://mdrive.sbs/mdisk/1',title:'720p'}]});
 return h;
}
function vc(){return m4u(['m4uVcloudResolve'],{M4U_VC_CACHE:new Map(),M4U_VC_BG:new Set(),_vcAccept1:()=>true,_vcAccept2:()=>true});}
function response(){return{status:0,headers:{},body:'',writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b||'';}};}

 test('observed movie MDisk drops Fastdl G-Direct but retains every VCloud quality',async()=>{
 const h=m4u(['m4uTdMdisk'],{M4U_TD_BAD:/(?:filebee|filepress|viking|gofile|megaup|gdtot|gdxfiles|pixeldra|10\s*gbps)/i,m4uHubHost:()=>false,m4uHReq:async()=>({st:200,body:catalog['mdisk-100710'].html})});
 const out=await h.clock.finish(h.api.m4uTdMdisk('https://mdrive.sbs/mdisk/100710'));
 assert(out.every(x=>x.srv!=='G-Direct'&&!x.href.includes('fastdl.beer')));assert.deepEqual(Array.from(out,x=>x.srv),['V-Cloud','V-Cloud','V-Cloud']);assert.deepEqual(Array.from(out,x=>x.q),['480','720','1080']);
});

test('disabled G-Direct resolve exits before wrapper requests, even when stale input changes its server label',async()=>{
 const h=m4u(['m4uTdResolve']);h.ctx.m4uHReq=()=>assert.fail('disabled source must not perform network');
 for(const l of [{href:target,srv:'G-Direct',rank:2},{href:target,srv:'FSL',rank:0},{href:'https://mirror.example/opaque',srv:'G-Direct',rank:2}]){const out=await h.api.m4uTdResolve(l,false);assert.equal(out.url,'');assert.equal(out.why,'disabled-g-direct');}
});

test('GDFlix keeps the same rank-two resolution and signed URL; it is not renamed into G-Direct',async()=>{
 const url='https://media.example/Example.2020.720p.mkv?token=a%2Fb&keep=1';const h=m4u(['m4uTdResolve'],{mlsGd:async()=>({ok:true,direct:url})});const out=await h.api.m4uTdResolve({href:'https://gdflix.example/file/selected',srv:'GDFlix',rank:2},false);assert.equal(out.url,url);assert.equal(out.srv,'GDFlix');
});

test('cached VCloud list excludes only G-Direct, preserving allowed sibling objects and transport metadata',async()=>{
 const h=vc(),fsl={srv:'FSL',url:'https://media.example/a.mkv',cl:12345,ct:'video/x-matroska',headers:{Referer:'keep'}},pd={srv:'Pixeldrain',url:'https://pixeldrain.dev/api/file/retained',cl:67890};h.ctx.M4U_VC_CACHE.set('https://vcloud.my/file',{ts:h.clock.now,list:[{srv:'G-Direct',url:gu},fsl,pd]});
 const out=await h.api.m4uVcloudResolve('https://vcloud.my/file');assert.deepEqual(plain(out),[fsl,pd]);assert.equal(out[0],fsl);assert.equal(out[1],pd);
});

test('new VCloud HTML cannot emit raw Google G-Direct; FSL/Pixeldrain extraction remains available',async()=>{
 const h=vc();h.ctx.m4uVcFetch=async()=>({body:'<a href="'+gu+'">G-Direct</a><a href="https://pub-file.r2.dev/Example.2020.mkv">FSL</a><a href="https://pixeldrain.com/u/retained">Pixeldrain</a>'});
 const out=await h.clock.finish(h.api.m4uVcloudResolve('https://vcloud.my/file'));assert.equal(out.length,2);assert.deepEqual(new Set(out.map(x=>x.srv)),new Set(['FSL','Pixeldrain']));assert(!out.some(x=>x.url===gu));
});

test('M4U final union drops cached G-Direct without changing Google Drive, FSL or transport-distinct alternatives',()=>{
 const h=m4u(['_m4uMerge']),a=card('FSL','https://media.example/a.mkv?token=one'),b=card('FSL','https://media.example/a.mkv?token=one');b.headers.Referer='https://other.example/';const drive=card('Google Drive','https://addon.example/m4g/legacy/v.m3u8');
 const out=h.api._m4uMerge([card('G-Direct',gu),a,b,drive]);assert.equal(out.length,3);for(const c of [a,b,drive])assert(out.includes(c));assert.deepEqual(plain(out.find(c=>c===a)),a);
});

test('TD stale DONE union cannot resurrect G-Direct or alter its retained FSL sibling',async()=>{
 const h=td(),fsl=card('FSL','https://media.example/a.mkv');h.ctx.M4U_TD_DONE.set('1:m:m:0:https://addon.example',{ts:h.clock.now,cards:[card('G-Direct',gu),fsl]});
 const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0],fsl);
});

test('a stale G-Direct-only DONE entry does not suppress fresh allowed mirrors for ten minutes',async()=>{
 const h=td();h.ctx.M4U_TD_DONE.set('1:m:m:0:https://addon.example',{ts:h.clock.now,cards:[card('G-Direct',gu)]});h.ctx.m4uTdMdisk=async()=>[{href:'https://vcloud.my/selected',srv:'V-Cloud',rank:1,q:'720'}];h.ctx.m4uVcloudResolve=async()=>[{srv:'FSL',url:'https://media.example/Example.2020.720p.mkv?keep=1'}];
 const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0]._srv,'FSL');assert.equal(out[0].url,'https://media.example/Example.2020.720p.mkv?keep=1');
});

test('cached MDisk G-Direct links consume no resolver or proof work and cannot hide allowed VCloud',async()=>{
 const h=td(),mdisk='https://mdrive.sbs/mdisk/1';h.ctx.M4U_TD_LOC.set(mdisk,{ts:h.clock.now,links:[{href:target,srv:'G-Direct',rank:2,q:'720'},{href:'https://vcloud.my/selected',srv:'V-Cloud',rank:1,q:'720'}]});h.ctx.m4uTdResolve=()=>assert.fail('G-Direct resolver must not start');h.ctx.m4uVcloudResolve=async()=>[{srv:'FSL',url:'https://media.example/Example.2020.720p.mkv'}];
 const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0]._srv,'FSL');
});

test('a stale VCloud G-Direct sub-mirror cannot occupy the three allowed mirror slots',async()=>{
 const h=td();h.ctx.m4uTdMdisk=async()=>[{href:'https://vcloud.my/selected',srv:'V-Cloud',rank:1}];const allowed=[1,2,3].map(i=>({srv:i===1?'FSL':'Pixeldrain',url:'https://media.example/Example.2020.720p-'+i+'.mkv'}));h.ctx.m4uVcloudResolve=async()=>[{srv:'G-Direct',url:gu},...allowed];
 const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,3);assert(!out.some(x=>x._srv==='G-Direct'));assert.deepEqual(new Set(out.map(x=>x._direct)),new Set(allowed.map(x=>x.url)));
});

for(const url of [target,'https://vcloud.my/selected#vcG-Direct','https://mdrive.sbs/mdisk/1#vcG-Direct'])test('old disabled playback target stops before resolution, with no silent source substitution: '+url,async()=>{
 const h=m4u(['m4uTdServe'],{m4uHostOf:u=>new URL(u).hostname,m4uFinalFor:()=>assert.fail('disabled target must not resolve')});const res=response();await h.api.m4uTdServe({method:'GET',headers:{range:'bytes=1000-1999'}},res,url);assert.equal(res.status,410);assert.equal(JSON.parse(res.body).error,'g-direct-disabled');assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['access-control-allow-origin'],'*');
});

test('an old exact G-Direct in-flight/final cache cannot bypass the playback policy',async()=>{
 const h=m4u(['m4uFinalFor','m4uFinalForInner'],{M4U_FIN_FLIGHT:new Map([[target,Promise.resolve(gu)]]),m4uHostOf:u=>new URL(u).hostname});h.ctx.M4U_TD_USED.set('td-source:'+target,{ts:h.clock.now,final:gu});assert.equal(await h.api.m4uFinalFor(target),'');assert.equal(await h.api.m4uFinalForInner(target),'');
});

test('blocking is exact: G-Direct aliases and Fastdl are excluded; Google Drive/GDFlix/native mirrors are not globally banned',()=>{
 const h=m4u(['m4uTdBlocked']);for(const [url,srv]of [[target,'FSL'],['https://media.example/file','G-Direct'],['https://media.example/file','G Direct'],['https://vcloud.my/selected#vcG-Direct','']])assert.equal(h.api.m4uTdBlocked(url,srv),true,url+' '+srv);
 for(const [url,srv]of [[gu,'Google Drive'],['https://gdflix.example/file/selected','GDFlix'],['https://pixeldrain.dev/api/file/retained','Pixeldrain'],['https://fastdl.beer.evil.example/file','FSL']])assert.equal(h.api.m4uTdBlocked(url,srv),false,url+' '+srv);
});

test('a G-Direct-only VCloud cache is refreshed rather than suppressing newly available native mirrors',async()=>{
 const h=vc();h.ctx.M4U_VC_CACHE.set('https://vcloud.my/file',{ts:h.clock.now,list:[{srv:'G-Direct',url:gu}]});let calls=0;h.ctx.m4uVcFetch=async()=>{calls++;return{body:'<a href="https://pub-file.r2.dev/Example.2020.mkv">FSL</a>'};};
 const out=await h.clock.finish(h.api.m4uVcloudResolve('https://vcloud.my/file'));assert.equal(calls,1);assert.equal(out.length,1);assert.equal(out[0].srv,'FSL');
});

test('only the declared G-Direct functions changed after the previously reviewed stable local source',()=>{
 const crypto=require('node:crypto'),edits=require('./fixtures/authorized-edits.json');let prior=require('./rereview-preservation.cjs').beforeRereview('server.js').toString('utf8');const undo=edits.filter(e=>e.file==='server.js'&&e.reason.startsWith('User G-Direct removal:')).reverse();assert(undo.length>0);
 for(const e of undo){assert.equal(prior.split(e.new).length-1,e.count,e.reason);prior=prior.split(e.new).join(e.old);}
 assert.equal(crypto.createHash('sha256').update(prior).digest('hex'),'588192cb70d7bbbbec74611315f50bcb676e09b75e59bc8f22c13d32fbd79639');
 for(const name of ['bfServeGeneric','bfGuStart','bfGuServe','bfGuAdopt','bfGuAdoptStream','bfGuSlotWait','bfGuSlotFree','bfGuReserved','bfUpSize','bfSniffCt','gdWarmQueue','gdWarmDrain','m4uPostCards','m4uHFast'])assert.equal(namedFunction(source(),name),namedFunction(prior,name),name+' must retain its previously reviewed behavior');
});
