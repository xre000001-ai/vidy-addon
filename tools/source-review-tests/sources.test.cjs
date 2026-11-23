'use strict';
// G-Direct was explicitly removed by the user. Independence/identity fixtures
// now use retained GDFlix/VCloud paths; g-direct.test.cjs asserts exclusion.
const test=require('node:test'),assert=require('node:assert/strict');
const {plain,m4u,hd,source,Clock,base,common,namedFunction}=require('./helpers.cjs');
const {harness}=require('../card-text-tests/card-helpers.cjs');
const card=(url,q='1080',srv='FSL')=>({url,quality:q,_srv:srv,title:'⧉ Example | 2020 |\n⊞ Movies4u ⌗ English · 1 GB',behaviorHints:{filename:'Example.2020.1080p.mkv'}});
for(const [key,label] of [['hm','HindMovie'],['hd','HDHub4u']])test('full provider name survives unify, formatter and sender: '+label,async t=>{
 const h=harness(source(),[],{title:'Example',year:2020});t.after(()=>h.close());const c={...card('https://media.example/video.mkv'),_src:key,bingeGroup:key+'|example',subtitles:[{id:'s',url:'https://subs.example/a.vtt',lang:'eng'}],headers:{Referer:'https://source.example/'}};
 c.description=c.title;const before=plain(c);await h.unify([c],{tmdbId:1,title:'Example',type:'movie',year:2020});
 for(const f of ['url','quality','bingeGroup','behaviorHints','subtitles','headers'])assert.deepEqual(plain(c[f]),before[f],f);
 const out=h.send([c]).streams[0];assert(out.title.includes('⌘ '+label+' ⌗'),out.title);assert(!/⌘ (?:Hm|Hd)\b/.test(out.title));
 for(const f of ['url','bingeGroup','behaviorHints'])assert.deepEqual(plain(out[f]),before[f],f);
});
test('URL/file identity, not rounded size, preserves same-quality alternatives',()=>{
 const h=m4u(['_m4uMerge']);const a=card('https://a.example/file.mkv?token=one'),b=card('https://a.example/other.mkv?token=two'),c=card('https://b.example/file.mkv?token=three');const out=h.api._m4uMerge([a,b],[c,a]);assert.equal(out.length,3);assert.deepEqual(new Set(out.map(x=>x.url)),new Set([a.url,b.url,c.url]));assert.equal(out[0],a);
});
test('M4U initial union waits for delayed selected branches after MoviesHunt settles',async()=>{
 const h=m4u(['m4uStreams']);h.ctx.m4uTdStreams=()=>h.clock.sleep(1000,[card('td')]);h.ctx.m4uRevive=()=>h.clock.sleep(5000,[card('revive')]);h.ctx.m4uMhStreams=()=>h.clock.sleep(100,[]);
 const out=await h.clock.finish(h.api.m4uStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+6000}));assert.deepEqual(new Set(out.map(x=>x.url)),new Set(['td','revive']));assert.equal(h.clock.now,1005000);
});
test('M4U deadline returns already resolved partials even when a branch hangs',async()=>{
 const h=m4u(['m4uStreams']);h.ctx.process.env.M4UUNI='600';h.ctx.m4uTdStreams=(...args)=>{h.clock.set(()=>{if(args[7]&&args[7].cards)args[7].cards.push(card('ready'));},200);return new Promise(()=>{});};h.ctx.m4uRevive=()=>new Promise(()=>{});h.ctx.m4uMhStreams=async()=>[];
 const out=await h.clock.finish(h.api.m4uStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+600}));assert.deepEqual(Array.from(out,x=>x.url),['ready']);assert.equal(out.$pend,true);assert(h.clock.now<=1000600);
});
test('M4U branch switches do not start disabled TD or MoviesHunt work',async()=>{
 const h=m4u(['m4uStreams']);Object.assign(h.ctx.process.env,{M4UTD:'0',M4UMH:'0'});h.ctx.m4uTdStreams=()=>assert.fail('disabled TD');h.ctx.m4uMhStreams=()=>assert.fail('disabled MH');h.ctx.m4uRevive=async()=>[card('revive')];const out=await h.clock.finish(h.api.m4uStreams(1,'Example','movie',0,0,'https://addon.example',0));assert.equal(out.length,1);
});
test('Revive returns the selected-post union, not only the first successful post',async()=>{
 const h=m4u(['m4uRevive']);h.ctx.m4uHSearch=async()=>[{url:'a',slug:'example-2020-a'},{url:'b',slug:'example-2020-b'}];h.ctx.m4uPostCards=(hit)=>h.clock.sleep(hit.url==='a'?200:600,[card(hit.url)]);
 const out=await h.clock.finish(h.api.m4uRevive(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.deepEqual(new Set(out.map(x=>x.url)),new Set(['a','b']));
});
function postHarness(){const h=m4u(['m4uPostCards']);h.ctx.M4U_PGC.set('post',{ts:h.clock.now,ents:[{q:'1080',size:'1 GB',href:'https://nexdrive.example/a'},{q:'1080',size:'1 GB',href:'https://nexdrive.example/b'}]});return h;}
test('Revive keeps distinct entry URLs with identical resolution and size',async()=>{
 const h=postHarness();h.ctx.m4uHFast=async u=>({url:'https://media.example/'+u.split('/').pop()+'.mkv'});const out=await h.clock.finish(h.api.m4uPostCards({url:'post',slug:'example-2020'},'Example',2020,false,0,0,0,h.clock.now,6,'https://addon.example',{deadline:h.clock.now+1000}));assert.equal(out.length,2);assert(out.every(c=>!c._lazy));
});
test('Revive does not turn unresolved entries into playable lazy cards or lose fast siblings',async()=>{
 const h=postHarness();h.ctx.M4U_PGC.get('post').ents[1].size='2 GB';h.ctx.m4uHFast=u=>u.endsWith('/a')?h.clock.sleep(200,{url:'https://media.example/a.mkv'}):new Promise(()=>{});const out=await h.clock.finish(h.api.m4uPostCards({url:'post',slug:'example-2020'},'Example',2020,false,0,0,0,h.clock.now,6,'https://addon.example',{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0]._direct,'https://media.example/a.mkv');assert(!out.some(c=>c._lazy));assert(h.clock.now<=1001000);
});
function tdHarness(twoPosts=false){
 const h=m4u(['m4uTdStreams']);const posts=[{url:'post-a',slug:'example-2020-a'}];if(twoPosts)posts.push({url:'post-b',slug:'example-2020-b'});
 h.ctx.M4U_TD_S.set('Example season 1',{ts:h.clock.now,posts});h.ctx.M4U_TD_S.set('Example',{ts:h.clock.now,posts});
 for(const p of posts)h.ctx.M4U_TD_CACHE.set(p.url,{ts:h.clock.now,list:[{q:'1080',size:'1 GB',mdisk:p.url+'-1',title:'1080p'},{q:'1080',size:'1 GB',mdisk:p.url+'-2',title:'1080p'}]});
 h.ctx.m4uTdMdisk=async u=>[{href:u,srv:'GDFlix',rank:2}];h.ctx.m4uTdResolve=async l=>({url:'https://media.example/'+l.href+'.mkv',srv:'GDFlix'});return h;
}
test('TD distinct same-size mdisk entries both survive',async()=>{
 const h=tdHarness();const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,2);
});
test('TD completed-card cache is isolated by exact episode, quality and origin',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);let episode=1;h.ctx.m4uTdResolve=async()=>({url:'https://media.example/e'+episode+'.mkv',srv:'FSL'});
 const run=(e,q=0,o='https://addon.example')=>h.clock.finish(h.api.m4uTdStreams(1,'Example','series',1,e,o,q,{deadline:h.clock.now+1000}));
 const one=await run(1);episode=2;const two=await run(2);assert.equal(one.length,1);assert.equal(two.length,1);assert.notEqual(one[0].url,two[0].url);assert(two[0].bingeGroup.endsWith('S1E2'));
 assert.equal((await run(2,720)).length,0,'1080p cached cards must not bypass a 720p filter');
 h.ctx.m4uTdResolve=async()=>({url:'https://media.example/gdrive.mkv',srv:'GDFlix'});const other=await run(2,0,'https://other-addon.example');assert(other[0].url.startsWith('https://other-addon.example/'));
});
test('TD second exact candidate can contribute even if the first post stalls',async()=>{
 const h=tdHarness(true);h.ctx.m4uTdMdisk=u=>u.startsWith('post-a')?new Promise(()=>{}):Promise.resolve([{href:u,srv:'GDFlix'}]);const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert(out.some(x=>x.url.includes(Buffer.from('post-b-1').toString('base64url'))));assert(h.clock.now<=1001000);
});
test('TD never substitutes other explicitly numbered episodes when the requested episode is absent',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.forEach((x,i)=>{x.title='Episode '+(i+1)+' 1080p';});const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','series',1,3,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,0);
});
for(const success of [true,false])test('cold HubCloud same-tap proof '+(success?'is awaited':'failure stays empty'),async()=>{
 const h=m4u(['hubLazyOk','m4uHubCard']);let calls=0;h.ctx.m4uHubFinal=async u=>{calls++;await h.clock.sleep(300);if(success)h.ctx.HUB_R2.set(u,{pf:h.clock.now,pv:1});return success?'https://media.example/f.mkv':'';};
 const out=await h.clock.finish(h.api.m4uHubCard({href:'https://hubcloud.pw/drive/one'},'Example',2020,false,0,0,true,'https://addon.example/m4d/proved/v.mkv',{deadline:h.clock.now+800}));assert.equal(!!out,success);assert.equal(calls,1);if(out)assert.equal(out.url,'https://addon.example/m4d/proved/v.mkv');
});
function movieHarness(post){const h=hd();h.api.setMocks({text:async u=>({st:200,t:u.endsWith('/example/')?post:'<title>Example.2020.1080p.mkv</title> https://hubcloud.pw/drive/wrapped'}),drive:async u=>({fn:'Example.2020.1080p.mkv',cands:[{u:'https://media.example/'+u.split('/').pop()+'.mkv',k:'s3'}]})});return h;}
test('HD direct links do not suppress separate wrapper chains or same-quality alternatives',async()=>{
 const h=movieHarness('<a href="https://hubcloud.pw/drive/direct">1080p</a><a href="https://hblinks.lol/archives/123">1080p other file</a>');const out=await h.clock.finish(h.api.hdStreams('tt123','Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+3000}));assert.deepEqual(new Set(out.map(c=>c.url)),new Set(['https://media.example/direct.mkv','https://media.example/wrapped.mkv']));
});
test('HD wrapper parsing retains every distinct HubCloud link, not only the first',async()=>{
 const h=movieHarness('<a href="https://hblinks.lol/archives/123">1080p</a>');h.api.setMocks({text:async u=>({st:200,t:u.endsWith('/example/')?'<a href="https://hblinks.lol/archives/123">1080p</a>':'<title>Example.2020.1080p.mkv</title> https://hubcloud.pw/drive/one https://hubcloud.pw/drive/two'})});const out=await h.clock.finish(h.api.hdStreams('tt123','Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+3000}));assert.equal(out.length,2);
});
test('HD a stalled drive cannot hide a fast resolved mirror behind the all-drive barrier',async()=>{
 const h=movieHarness('https://hubcloud.pw/drive/fast https://hubcloud.pw/drive/slow');h.ctx.process.env.HDRACE='1000';h.api.setMocks({drive:u=>u.endsWith('/slow')?new Promise(()=>{}):h.clock.sleep(100,{fn:'Example.2020.1080p.mkv',cands:[{u:'https://media.example/ready.mkv',k:'s3'}]})});const out=await h.clock.finish(h.api.hdStreams('tt123','Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1800}));assert.deepEqual(Array.from(out,c=>c.url),['https://media.example/ready.mkv']);assert(out.every(c=>!c._lazy));assert(h.clock.now<=1001800);
});
test('HD no resolved media or all rejected media cannot become unproven fallback cards',async()=>{
 const h=movieHarness('https://hubcloud.pw/drive/one');h.api.setMocks({drive:async()=>({fn:'Example.1080p.mkv',cands:[]})});const out=await h.clock.finish(h.api.hdStreams('tt123','Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1800}));assert.equal(out.length,0);
});
test('HD rejects explicit archive filenames even when a mirror URL is opaque',async()=>{
 const h=movieHarness('https://hubcloud.pw/drive/one');h.api.setMocks({drive:async()=>({fn:'Example.2020.1080p.zip',cands:[{u:'https://media.example/opaque',k:'s3'}]})});const out=await h.clock.finish(h.api.hdStreams('tt123','Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1800}));assert.equal(out.length,0);
});
test('HD actual S3 proof rejects HTML, error JSON and archives rather than URL-shape green',async()=>{
 const h=hd();let requests=0;h.ctx.fetch=async()=>{requests++;return {status:200,headers:{get:n=>({'content-type':'text/html','content-length':'8000'}[n]||'')},body:{cancel(){}}};};const out=await h.clock.finish(h.api.hdProbe('https://media.example/file.mkv',1000));assert.equal(out.ok,false);assert.equal(requests,1);
});
test('function extraction cannot execute neighboring module boot code',()=>{
 const code='async function selected(){\n return {value:1};\n}\nconst BAD=require("not-allowed");\nasync function later(){\n}\n';const x=namedFunction(code,'selected');assert(!x.includes('require'));assert(x.endsWith('}'));
});
test('M4U candidate matching rejects sequels, wrong release years and wrong seasons before union',()=>{
 const h=m4u(['m4uHToks','m4uHPickAll']);const p=slug=>({slug,url:'https://source.example/'+slug});
 const movies=h.api.m4uHPickAll(['toy-story-1995-bluray-dual-audio','toy-story-2-1999-bluray','toy-story-5-2026-bluray','toy-story-2025-bluray'].map(p),'Toy Story',1995,0);
 assert.deepEqual(Array.from(movies,x=>x.slug),['toy-story-1995-bluray-dual-audio']);
 const series=h.api.m4uHPickAll(['example-season-1-8-dual-audio','example-season-4-dual-audio','example-season-1-dual-audio'].map(p),'Example',0,1);assert.equal(series.length,2);assert(!series.some(x=>x.slug==='example-season-4-dual-audio'));
 const chapters=h.api.m4uHPickAll(['john-wick-chapter-2-2017-bluray','john-wick-chapter-4-2023-bluray'].map(p),'John Wick Chapter 4',2023,0);assert.equal(chapters.length,1);assert(chapters[0].slug.includes('chapter-4'));
});
test('HD series returns a fast exact-episode mirror despite an unrelated stalled drive',async()=>{
 const h=hd();const page='<h3>EPiSODE 2</h3><a href="https://hubcloud.pw/drive/fast">Episode 2</a><a href="https://hubcloud.pw/drive/slow">Episode 2</a>';
 h.api.HD_S.set('hs:tt123:1',{ts:h.clock.now,v:{url:'https://hdhubinfo.com/example-series/',title:'Example (Season 1)'}});h.ctx.NOCACHE=false;
 h.api.setMocks({text:async u=>({st:200,t:u.includes('example-series')?page:'<title>Example.S01E02.1080p.mkv</title>'}),drive:u=>u.endsWith('/slow')?new Promise(()=>{}):h.clock.sleep(100,{fn:'Example.S01E02.1080p.mkv',cands:[{u:'https://media.example/Example.S01E02.1080p.mkv',k:'s3'}]})});
 const out=await h.clock.finish(h.api.hdSeries('tt123','Example',1,2,'https://addon.example',0,{deadline:h.clock.now+1800}));assert.equal(out.length,1);assert(out[0].url.includes('S01E02'));assert(h.clock.now<=1001800);
});
for(const hubReady of [true,false])test('TD cold HubCloud '+(hubReady?'and fast fallback are both retained':'cannot block a ready fallback'),async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);
 h.ctx.m4uTdMdisk=async()=>[{href:'https://hubcloud.pw/drive/cold',srv:'HubCloud'},{href:'gdflix-ready',srv:'GDFlix'}];
 h.ctx.hubAwaitProof=()=>hubReady?h.clock.sleep(700,true):new Promise(()=>{});
 h.ctx.m4uHubCard=()=>hubReady?h.clock.sleep(700,{q:'1080',size:'1 GB',url:'https://addon.example/m4d/cold/v.mkv',name:'Example.2020.1080p.mkv'}):new Promise(()=>{});
 const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert(out.some(x=>x._srv==='GDFlix'),'fast fallback should not wait behind cold Hub proof');assert.equal(out.some(x=>x._srv==='FSL'),hubReady);assert(h.clock.now<=1001000);
});
test('TD pack proof warm-up does not block a ready GDFlix sibling',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list=[{q:'',size:'',mdisk:'pack',title:'All Links',pack:true}];h.ctx.m4uTdMdisk=async()=>[{href:'https://hubcloud.pw/drive/cold',srv:'HubCloud'},{href:'https://gdflix.example/file/good',srv:'GDFlix'}];h.ctx.m4uHubCard=()=>new Promise(()=>{});h.ctx.m4uGfInfo=async()=>({q:'1080',size:'1 GB',name:'Example.2020.1080p.mkv'});
 const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert(out.some(x=>x._srv==='GDFlix'));assert.equal(h.ctx.M4U_TD_DONE.size,0,'partial selected-post union must not pin a positive DONE entry');
});
function mhHarness(){const h=m4u(['m4uMhStreams']);const posts=[{url:'post-a',slug:'example-2020'},{url:'post-b',slug:'example-2020-dual'}];h.ctx.MH_S.set('Example',{ts:h.clock.now,posts});for(const p of posts){h.ctx.MH_PC.set(p.url,{ts:h.clock.now,list:[{url:p.url+'-entry',q:'1080',size:'1 GB'}]});h.ctx.MH_AC.set(p.url+'-entry',{ts:h.clock.now,list:[{q:'1080',size:'1 GB',gf:'https://gdflix.example/file/'+p.url}]});}h.ctx.m4uGfInfo=async()=>({q:'1080',size:'1 GB',name:'Example.2020.1080p.mkv'});h.ctx.m4uTdResolve=async l=>({url:'https://media.example/'+l.href.split('/').pop()+'.mkv',srv:'GDFlix'});return h;}
test('MoviesHunt second exact post is not held behind a stalled first post',async()=>{
 const h=mhHarness();h.ctx.MH_PC.delete('post-a');h.ctx.mhFetch=u=>u==='post-a'?new Promise(()=>{}):Promise.resolve({st:200,body:'{}'});const out=await h.clock.finish(h.api.m4uMhStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert(out.some(c=>c.url.includes(Buffer.from('https://gdflix.example/file/post-b').toString('base64url'))));assert.equal(out.$pend,true);assert(h.clock.now<=1001000);
});
test('MoviesHunt cold HubCloud resolution cannot block a ready GDFlix in the same row',async()=>{
 const h=mhHarness();h.ctx.MH_S.get('Example').posts.splice(1);h.ctx.MH_AC.get('post-a-entry').list[0].hub='https://hubcloud.pw/drive/cold';h.ctx.mhHubServers=()=>new Promise(()=>{});const out=await h.clock.finish(h.api.m4uMhStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert(out.some(c=>c._srv==='GDFlix'));assert(h.clock.now<=1001000);
});
test('M4U series season identity does not confuse season release year with first-air year',()=>{
 const h=m4u(['m4uHToks','m4uHPickAll']);const posts=['example-season-2-2024-webrip','example-season-1-2020-webrip'].map(slug=>({slug}));const out=h.api.m4uHPickAll(posts,'Example',2020,2);assert.deepEqual(Array.from(out,c=>c.slug),['example-season-2-2024-webrip']);
});
test('M4U numeric movie titles are not stripped as DLE post IDs',()=>{
 const h=m4u(['m4uHToks','m4uHPickAll']);for(const [title,year,slug]of [['1917',2019,'1917-2019-bluray'],['2012',2009,'98765-2012-2009-bluray']])assert.equal(h.api.m4uHPickAll([{slug}],title,year,0).length,1);
});
test('M4U duplicate keys retain distinct request headers and native subtitle choices',()=>{
 const h=m4u(['_m4uMerge']);const a=card('https://media.example/video.mkv'),b=plain(a),c=plain(a);a.headers={Referer:'https://one.example/'};b.headers={Referer:'https://two.example/'};c.headers=plain(a.headers);c.subtitles=[{id:'eng',url:'https://subs.example/eng.vtt',lang:'eng'}];assert.equal(h.api._m4uMerge([a,b,c]).length,3);
});
test('M4U filename validation rejects standalone episode ranges, ZIPs and explicit contradictory season/episode',()=>{
 const h=m4u(['m4uFileOk']);for(const f of ['Show.Episode.2-3.1080p.mkv','Show.S01E02-E03.mkv','Show.S02E02.1080p.mkv','Show.S01E03.1080p.mkv','Show.1080p.zip'])assert.equal(h.api.m4uFileOk(f,true,1,2),false,f);for(const f of ['Show.S01E02.1080p.mkv','Show.E02.1080p.mkv','opaque-token'])assert.equal(h.api.m4uFileOk(f,true,1,2),true,f);
});
function proofResponse(status=206,ct='video/x-matroska',data=Buffer.from('1a45dfa30000000000000000','hex'),extra={}){
 return {status,headers:{get:n=>({'content-type':ct,'content-range':'bytes 0-11/1000000','content-length':'12',...extra}[n.toLowerCase()]||'')},body:{cancel(){},getReader(){return {read:async()=>({value:data,done:false}),cancel:async()=>{}};}}};
}
test('M4U proof makes a real bounded request; media-shaped HTTP errors and HTML/JSON/archives cannot pass',async()=>{
 const h=m4u(['m4uProof']);let calls=0;for(const [status,ct]of [[403,'application/xml'],[200,'text/html'],[206,'application/json'],[200,'application/zip'],[206,'text/plain']]){h.ctx.fetch=async()=>{calls++;return proofResponse(status,ct);};assert.equal(await h.api.m4uProof('https://media.example/file.mkv?signature=keep'),false,status+' '+ct);}assert.equal(calls,5);
 h.ctx.fetch=async()=>{calls++;return proofResponse();};assert.equal(await h.api.m4uProof('https://media.example/file.mkv'),true);assert.equal(calls,6);
});
test('M4U strict media proof rejects ZIP magic disguised as octet-stream and accepts MKV/MP4',async()=>{
 const h=m4u(['m4uProof']);for(const [hex,ok]of [['504b03040000000000000000',false],['7b226572726f72223a227822',false],['1a45dfa30000000000000000',true],['000000186674797069736f6d',true]]){h.ctx.fetch=async()=>proofResponse(206,'application/octet-stream',Buffer.from(hex,'hex'));assert.equal(await h.api.m4uProof('https://media.example/opaque',true),ok,hex);}
});
test('M4U old URL-shape cache stamps are re-proved, not silently adopted as media evidence',async()=>{
 const h=m4u(['hubLazyOk','m4uHubFinal','m4uProof']);const drive='https://hubcloud.pw/drive/old',url='https://media.example/signed';h.ctx.HUB_R2.set(drive,{u:url,pf:h.clock.now,ts:h.clock.now});h.ctx.m4uHubFsl=async()=>url;h.ctx.m4uHubPdFinal=async()=>'';h.ctx.hubR2Save=()=>{};h.ctx.fetch=async()=>proofResponse(403,'application/xml');assert.equal(h.api.hubLazyOk(drive),false,'legacy pf alone is not a verified proof');const result=await h.clock.finish(h.api.m4uHubFinal(drive));assert.equal(result,'');
});
test('cold HubCloud metadata and existing proof warm-up overlap inside the same tap deadline',async()=>{
 const h=m4u(['hubLazyOk','m4uHubCard']);const drive='https://hubcloud.pw/drive/parallel';h.ctx.m4uHubFinal=async()=>{await h.clock.sleep(700);h.ctx.HUB_R2.set(drive,{u:'https://media.example/file.mkv',pf:h.clock.now,pv:1});return 'https://media.example/file.mkv';};h.ctx.m4uHubInfo=()=>h.clock.sleep(700,{q:'1080',size:'1 GB',name:'Example.2020.1080p.mkv'});
 const out=await h.clock.finish(h.api.m4uHubCard({href:drive},'Example',2020,false,0,0,true,'https://addon.example/proven',{deadline:h.clock.now+1000}));assert(out&&out.url);assert(h.clock.now<=1001000,'sequential metadata must not turn a valid 700ms cold result into a missed tap');
});
test('HD Pixeldrain must make an actual response check rather than trust the shared legacy URL-shape stub',async()=>{
 const h=movieHarness('https://hubcloud.pw/drive/one');let calls=0;h.ctx.fetch=async()=>{calls++;return proofResponse(404,'application/json');};h.api.setMocks({probe:h.api.hdProbe,drive:async()=>({fn:'Example.2020.1080p.mkv',cands:[{u:'https://pixeldrain.dev/api/file/dead',k:'pd'}]})});const out=await h.clock.finish(h.api.hdStreams('tt123','Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1800}));assert.equal(out.length,0);assert.equal(calls,1);
});
test('HD series fast exact-episode wrapper is not held behind an unrelated stalled wrapper',async()=>{
 const h=hd();h.ctx.NOCACHE=false;h.api.HD_S.set('hs:tt123:1',{ts:h.clock.now,v:{url:'https://hdhubinfo.com/example-series/',title:'Example (Season 1)'}});const page='<h3>EPiSODE 2</h3><a href="https://hblinks.lol/archives/111">1080p Episode 2</a><a href="https://hblinks.lol/archives/222">720p Episode 2</a>';
 h.api.setMocks({text:u=>u.endsWith('/222')?new Promise(()=>{}):Promise.resolve({st:200,t:u.includes('example-series')?page:'<title>Example.S01E02.1080p.mkv</title> https://hubcloud.pw/drive/fast'}),drive:async()=>({fn:'Example.S01E02.1080p.mkv',cands:[{u:'https://media.example/Example.S01E02.1080p.mkv',k:'s3'}]})});const out=await h.clock.finish(h.api.hdSeries('tt123','Example',1,2,'https://addon.example',0,{deadline:h.clock.now+1800}));assert.equal(out.length,1);assert(out.$pend);assert(h.clock.now<=1001800);
});
const tdCatalog=require('./fixtures/td-catalog.json');
test('TD recognizes only observed compatible mdrive.sbs aliases and keeps explicit Batch/Zip evidence',()=>{
 const h=m4u(['m4uTdEntries']);const movie=h.api.m4uTdEntries(tdCatalog['td-inception-post'].html);assert.equal(movie.length,3);assert.deepEqual(Array.from(movie,x=>x.q),['480','720','1080']);const show=h.api.m4uTdEntries(tdCatalog['td-got-post'].html);assert(show.some(x=>x.batch));assert.equal(h.api.m4uTdEntries('<h3>1080p</h3><a href="https://mdrive.sbs.evil.example/mdisk/12">Download</a>').length,0);
});
test('TD real mdisk fixture preserves each quality and episode context while recognizing the observed VCloud alias',async()=>{
 const h=m4u(['m4uTdMdisk']);h.ctx.M4U_TD_BAD=/(?:filebee|filepress|viking|gofile|megaup|gdtot|gdxfiles|pixeldra|10\s*gbps)/i;h.ctx.m4uHubHost=()=>false;h.ctx.m4uHReq=async()=>({st:200,body:tdCatalog['mdisk-100710'].html});let out=await h.clock.finish(h.api.m4uTdMdisk('https://mdrive.sbs/mdisk/100710'));assert.deepEqual(new Set(out.map(x=>x.q)),new Set(['480','720','1080']));assert(out.some(x=>x.srv==='V-Cloud'&&x.href.includes('vcloud.my/')));
 h.ctx.m4uHReq=async()=>({st:200,body:tdCatalog['mdisk-10592'].html});out=await h.clock.finish(h.api.m4uTdMdisk('https://mdrive.sbs/mdisk/10592'));assert.equal(out.length,10);assert.deepEqual(Array.from(out,x=>x.ep),[1,2,3,4,5,6,7,8,9,10]);
});
test('M4U filename/heading identity rejects contradictory standalone season evidence',()=>{
 const h=m4u(['m4uFileOk']);for(const text of ['Example S02 1080p','Season 8 1080p BluRay','Season 2 Episode 1'])assert.equal(h.api.m4uFileOk(text,true,1,1),false,text);assert.equal(h.api.m4uFileOk('Season 1 1080p',true,1,1),true);
});
test('TD a ready mdisk in the same post is harvested even when its sibling never settles',async()=>{
 const h=tdHarness();h.ctx.m4uTdMdisk=u=>u.endsWith('-1')?new Promise(()=>{}):Promise.resolve([{href:u,srv:'GDFlix',rank:2}]);const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert(out.$pend);assert(h.clock.now<=1001000);
});
test('TD a stalled VCloud is independent of the ready GDFlix mirror for the same selected file',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);h.ctx.m4uTdMdisk=async()=>[{href:'https://vcloud.my/file-one',srv:'V-Cloud',rank:1},{href:'https://gdflix.example/file/ready',srv:'GDFlix',rank:2}];h.ctx.m4uVcloudResolve=()=>new Promise(()=>{});const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0]._srv,'GDFlix');
});
test('TD exact episode and row quality choose a stable source-specific playback target, never the first file in a season mdisk',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list=[{q:'1080',size:'1 GB',mdisk:'season-mdisk',title:'Season 1 1080p'}];h.ctx.m4uTdMdisk=async()=>[1,2].map(ep=>({href:'https://gdflix.example/file/ep'+ep,srv:'GDFlix',rank:2,q:'1080',ep,title:'Episodes: '+ep}));const seen=[];h.ctx.m4uTdResolve=async l=>{seen.push(l.href);return{url:'https://media.example/Example.S01E02.1080p.mkv',srv:'GDFlix'};};const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','series',1,2,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.deepEqual(seen,['https://gdflix.example/file/ep2']);assert(out[0].url.includes(Buffer.from(seen[0]).toString('base64url')),'playback must refresh this exact episode link, not the entire season mdisk');
});
function targetHarness(){return m4u(['m4uFinalForInner'],{M4U_TD_USED:new Map(),m4uHostOf:u=>new URL(u).hostname,m4uIsMediaUrl:u=>/^https:\/\/media\.example\//.test(u)});}
test('exact TD GDFlix playback refreshes the selected stable source and retains the full signed result',async()=>{
 const h=targetHarness(),target='https://gdflix.example/file/episode2',signed='https://media.example/Show.S01E02.mkv?token=a%2Fb&keep=1';let calls=0;h.ctx.m4uHFast=()=>assert.fail('must not mistake the selected GDFlix for a legacy Nexdrive page');h.ctx.m4uTdResolve=async l=>{calls++;assert.equal(l.href,target);assert.equal(l.srv,'GDFlix');return{url:signed};};assert.equal(await h.api.m4uFinalForInner(target),signed);assert.equal(await h.api.m4uFinalForInner(target),signed);assert.equal(calls,1);
});
test('exact TD VCloud playback retains its selected file and server preference instead of substituting another result',async()=>{
 const h=targetHarness(),target='https://vcloud.my/selected-episode';let calls=0;h.ctx.m4uVcloudResolve=async u=>{calls++;assert.equal(u,target);return[{srv:'FSL',url:'https://media.example/fsl.mkv?sig=one'},{srv:'Pixeldrain',url:'https://media.example/pd.mkv?sig=two'}];};assert.equal(await h.api.m4uFinalForInner(target+'#vcPixeldrain'),'https://media.example/pd.mkv?sig=two');assert.equal(await h.api.m4uFinalForInner(target+'#vcMissing'),'','no arbitrary mirror substitution');assert.equal(calls,2);
});
test('TD exact-source serving retains redirect headers and the unchanged Range-capable relay',async()=>{
 const h=m4u(['m4uTdServe'],{m4uHostOf:u=>new URL(u).hostname,m4uFinalFor:async()=> 'https://media.example/video.mkv?sig=retain',m4uDirectOk:()=>true});const req={headers:{range:'bytes=1000-1999'}};let status,headers,ended=false;const res={writeHead(s,x){status=s;headers=x;},end(){ended=true;}};await h.api.m4uTdServe(req,res,'https://vcloud.my/selected-ep2');assert.equal(status,302);assert.equal(headers.location,'https://media.example/video.mkv?sig=retain');assert.equal(headers['access-control-allow-origin'],'*');assert(ended);
 h.ctx.m4uDirectOk=()=>false;let relayed=false;h.ctx.bfServeGeneric=async(r,s,u)=>{assert.equal(r,req);assert.equal(s,res);assert.equal(r.headers.range,'bytes=1000-1999');assert.equal(u,'https://media.example/video.mkv?sig=retain');relayed=true;};await h.api.m4uTdServe(req,res,'https://vcloud.my/selected-ep2');assert(relayed);
});
test('a TD worker that settles after the tap deadline cannot pin its truncated prefix later',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);h.ctx.m4uTdResolve=()=>h.clock.sleep(1100,{url:'https://media.example/late.mkv',srv:'GDFlix'});const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert(out.$pend);await h.clock.finish(h.clock.sleep(200));assert.equal(h.ctx.M4U_TD_DONE.size,0);
});
test('TD does not publish a resolved-looking direct URL when its actual media proof fails',async()=>{
 const h=tdHarness();h.ctx.m4uProof=async()=>false;const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,0);
});
test('TD VCloud sub-mirrors are individually proved and a stalled proof cannot hide a ready sibling',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);h.ctx.m4uTdMdisk=async()=>[{href:'https://vcloud.my/episode',srv:'V-Cloud'}];h.ctx.m4uVcloudResolve=async()=>[{srv:'FSL',url:'https://media.example/stall.mkv'},{srv:'Pixeldrain',url:'https://media.example/ready.mkv'}];h.ctx.m4uProof=u=>u.includes('stall')?new Promise(()=>{}):Promise.resolve(true);const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0]._direct,'https://media.example/ready.mkv');
});
test('TD pack metadata does not manufacture an unresolved GDFlix playable card',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list=[{q:'',size:'',mdisk:'pack',title:'All Links',pack:true}];h.ctx.m4uTdMdisk=async()=>[{href:'https://gdflix.example/file/empty',srv:'GDFlix'}];h.ctx.m4uGfInfo=async()=>({q:'1080',size:'1 GB',name:'Example.2020.1080p.mkv'});h.ctx.m4uTdResolve=async()=>({url:''});const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,0);
});
test('MoviesHunt GDFlix metadata alone is not resolved/verified playback evidence',async()=>{
 const h=mhHarness();h.ctx.m4uTdResolve=async()=>({url:''});const out=await h.clock.finish(h.api.m4uMhStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,0);
});
test('MoviesHunt a fast proved sub-mirror survives a stalled proof in the same row',async()=>{
 const h=mhHarness();h.ctx.MH_S.get('Example').posts.splice(1);const row=h.ctx.MH_AC.get('post-a-entry').list[0];delete row.gf;row.hub='https://hubcloud.pw/drive/one';h.ctx.mhHubServers=async()=>[{srv:'FSL',url:'https://media.example/stall.mkv'},{srv:'Pixeldrain',url:'https://media.example/ready.mkv'}];h.ctx.m4uProof=u=>u.includes('stall')?new Promise(()=>{}):Promise.resolve(true);const out=await h.clock.finish(h.api.m4uMhStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0].url,'https://media.example/ready.mkv');
});
test('TD removed G-Direct cannot create a playable route or seed an exact final',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);const selected='https://fastdl.beer/embed?download=exact-episode2';h.ctx.m4uTdMdisk=async()=>[{href:selected,srv:'G-Direct',rank:2}];h.ctx.m4uTdResolve=()=>assert.fail('disabled G-Direct must not resolve');const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','series',1,2,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,0);assert.equal(h.ctx.M4U_TD_USED.has('td-source:'+selected),false);
});

test('TD a stalled GDFlix of the same quality cannot suppress a ready GDFlix alternative',async()=>{
 const h=tdHarness();h.ctx.M4U_TD_CACHE.get('post-a').list.splice(1);h.ctx.m4uTdMdisk=async()=>[{href:'https://gdflix.example/file/stall',srv:'GDFlix'},{href:'https://gdflix.example/file/ready',srv:'GDFlix',rank:2}];h.ctx.m4uTdResolve=l=>l.href.endsWith('/stall')?new Promise(()=>{}):Promise.resolve({url:'https://media.example/ready.mkv',srv:'GDFlix'});const out=await h.clock.finish(h.api.m4uTdStreams(1,'Example','movie',0,0,'https://addon.example',0,{deadline:h.clock.now+1000}));assert.equal(out.length,1);assert.equal(out[0]._srv,'GDFlix');
});
test('M4U real response filenames cannot contradict the requested standalone season/episode',async()=>{
 const h=m4u(['m4uProof']);for(const filename of ['Show.S02E02.1080p.mkv','Show.S01E03.1080p.mkv','Show.Episode.2-3.mkv']){h.ctx.fetch=async()=>proofResponse(206,'video/x-matroska',undefined,{'content-disposition':'attachment; filename="'+filename+'"'});assert.equal(await h.api.m4uProof('https://media.example/opaque',true,{isSeries:true,season:1,episode:2}),false,filename);}h.ctx.fetch=async()=>proofResponse(206,'video/x-matroska',undefined,{'content-disposition':'attachment; filename="Show.S01E02.1080p.mkv"'});assert.equal(await h.api.m4uProof('https://media.example/opaque',true,{isSeries:true,season:1,episode:2}),true);
});
