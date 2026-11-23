'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const C=require('./core.cjs'),B=require('./build.cjs'),N=require('./network.cjs'),R=require('./runtime.cjs'),{materialize}=require('./cli.cjs'),{publish}=require('./publish.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'dt419-review-'));
const catalog=(slugs=['naruto'])=>({ver:4,at:100,complete:true,shows:slugs.map(slug=>({slug,name:slug,type:'tv',year:2002,metaComplete:true,complete:true,seasons:[{s:1,n:1,episodes:[1],complete:true,episodeOffset:0}]}))});
const detail={links:[{quality:'1080p',servers:[{name:'HubCloud',link_server_id:'newhub'},{name:'Pixeldrain',link_server_id:'pd'}]}]};
function unitClient(unlock=async id=>id==='pd'?'https://pixeldrain.com/u/pd':'https://hubcloud.pw/drive/newhub'){
 const calls=[];return {calls,left:()=>Infinity,stats:{},request:async p=>{calls.push(p);return structuredClone(detail);},unlock:async id=>{calls.push('unlock:'+id);return unlock(id);}};
}
function runtimeData(rows,cat=catalog(Object.keys(rows))){
 const dir=temp();C.split(rows).forEach((p,i)=>C.write(path.join(dir,'dti',C.filename(i)),p));
 const source={rows,cat,t:10000,hook:null,manifestHook:null},calls=[];
 const manifest=()=>C.manifest(source.rows,source.cat,{now:source.t,ref:'b'.repeat(40)});
 const runtime=R.create({seedDir:dir,mirrors:['https://raw.githubusercontent.com/o/r/deadtoons-index/dti'],clock:()=>source.t,fetch:async url=>{
  calls.push(url);if(url.includes('manifest.json'))return {ok:true,text:async()=>C.json(source.manifestHook?source.manifestHook(manifest()):manifest())};
  const file=new URL(url).pathname.split('/').pop();if(source.hook)await source.hook(file);
  return {ok:true,text:async()=>C.json(C.split(source.rows)[Number(file.slice(1,3))])};
 }});
 return {source,calls,runtime,async close(){await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('DT real numbering regression: Naruto S2E1 uses the listed upstream27 endpoint, not the observed404 endpoint',async()=>{
 const cat=catalog();cat.complete=false;cat.shows[0].seasons=[{s:2,n:1,episodes:[27],episodeOffset:26,complete:true}];
 const client=unitClient(),r=await B.slice(client,{},cat,{}, {slices:1,now:()=>100000});
 a(client.calls.includes('/anime/naruto/season/2/episode/27'));a(!client.calls.includes('/anime/naruto/season/2/episode/1'));a(r.rows.naruto.every(row=>row[0]===2&&row[1]===1));
});
test('DT failed season metadata creates no fabricated1..count episode units or false catalog completion',async()=>{
 const client={left:()=>Infinity,request:async p=>{if(p.includes('?'))return {data:[{slug:'show',type:'tv'}],count:1};if(p.includes('/season/'))throw new N.UpstreamError('503',{status:503});return {type:'tv',seasons:[{season_number:1,episode_count:26}]};}};
 const cat=await B.catalog(client,{}, {now:()=>100000});a.equal(cat.complete,false);a.equal(C.units(cat).length,0);a.equal(cat.shows[0].seasons[0].complete,false);a.equal(C.metrics({},cat).units.total,null);
});
test('DT upstream declared catalog count mismatches stay unknown rather than pretending the short page is whole-site coverage',async()=>{
 const cat=await B.catalog({left:()=>Infinity,request:async p=>p.includes('?')?{data:[{slug:'film',type:'movie'}],count:2}:{type:'movie',seasons:[],links:null}}, {},{now:()=>100000});
 a(!cat.complete);a.equal(cat.stats.declared,2);a.equal(cat.shows.length,1);a.equal(C.metrics({},cat).units.total,null);
});
test('DT catalog persists fair metadata progress across bounded runs instead of restarting the same early titles',async()=>{
 const slugs=['aaa','bbb','ccc','ddd','eee'];let t=C.DAY;
 const client=()=>{let left=100000;const calls=[];return {calls,left:()=>left,request:async p=>{left-=20000;t+=100;calls.push(p);if(p.includes('?'))return {data:slugs.map(slug=>({slug,type:'tv'})),count:5};if(p.includes('/season/'))return {episodes:[{episode_number:1}]};return {type:'tv',seasons:[{season_number:1,episode_count:1}]};}};};
 const c1=client(),first=await B.catalog(c1,{}, {now:()=>t,concurrency:1});a(!first.complete);a(first.stats.queued>0);
 const c2=client(),second=await B.catalog(c2,first,{now:()=>t,concurrency:1});
 a(c2.calls.some(p=>p==='/anime/ccc'||p==='/anime/ddd'||p==='/anime/eee'));a(second.shows.filter(s=>s.metaComplete).length>first.shows.filter(s=>s.metaComplete).length);
});
test('DT confirmed zero-episode TV inventory is not turned into a phantom movie, while real movies retain root units',async()=>{
 const client={left:()=>Infinity,request:async p=>p.includes('?')?{data:[{slug:'tv',type:'tv'},{slug:'film',type:'movie'}],count:2}:{type:p.endsWith('/tv')?'tv':'movie',seasons:[],links:null}};
 const cat=await B.catalog(client,{}, {now:()=>100000});a(cat.complete);a.deepEqual(C.units(cat).map(u=>[u.slug,u.s,u.e]),[['film',0,0]]);
});
test('DT noncontiguous episode IDs are not compressed or assigned an unproved relative offset',async()=>{
 const client={left:()=>Infinity,request:async p=>p.includes('?')?{data:[{slug:'show',type:'tv'}],count:1}:p.includes('/season/')?{episodes:[{episode_number:5},{episode_number:7}]}:{type:'tv',seasons:[{season_number:1,episode_count:2}]}};
 const cat=await B.catalog(client,{}, {now:()=>100000});a.deepEqual(C.units(cat).map(u=>u.e),[5,7]);a.equal(cat.shows[0].seasons[0].episodeOffset,0);
});
test('DT changed link ID plus failed unlock never labels the prior host row as freshly unlocked for the new ID',async()=>{
 let now=2*C.DAY;const rows={naruto:[[1,1,1,720,'oldhub']]},state={'naruto|1|1':{checkedAt:1,nextAt:now-1,hosts:{1:{linkId:'old-link',row:[1,1,1,720,'oldhub'],unlockedAt:now-1000,nextAt:now+7*C.DAY}}}};
 const make=()=>unitClient(async id=>{if(id==='newhub')throw new N.UpstreamError('503',{status:503});return 'https://pixeldrain.com/u/pd';});
 const c1=make(),r1=await B.slice(c1,rows,catalog(),state,{slices:1,now:()=>now}),host=r1.state['naruto|1|1'].hosts[1];
 a.equal(host.linkId,'newhub');a.equal(host.row,undefined);a.equal(host.unlockedAt,undefined);a(r1.rows.naruto.some(r=>r[4]==='oldhub'));
 now=r1.state['naruto|1|1'].nextAt+1;const c2=make(),r2=await B.slice(c2,r1.rows,catalog(),r1.state,{slices:1,now:()=>now});
 a(c2.calls.includes('unlock:newhub'));a.equal(r2.state['naruto|1|1'].hosts[1].failures,2);
});
test('DT per-host link freshness reuses both unchanged sources without another gate',async()=>{
 const now=2*C.DAY,rows={naruto:[[1,1,1,1080,'newhub'],[1,1,0,1080,'pd']]},state={'naruto|1|1':{nextAt:now-1,hosts:{1:{linkId:'newhub',row:rows.naruto[0],unlockedAt:now-1000},0:{linkId:'pd',row:rows.naruto[1],unlockedAt:now-1000}}}};
 const client=unitClient(async()=>{throw Error('No gate should be started');}),r=await B.slice(client,rows,catalog(),state,{slices:1,now:()=>now});
 a.equal(client.calls.filter(x=>x.startsWith('unlock:')).length,0);a.equal(r.stats.unchanged,2);a.equal(r.rows.naruto.length,2);a.equal(r.state['naruto|1|1'].nextAt,now+C.DAY);
});
test('DT host-specific429 Retry-After survives publication state and cannot be shortened by the unit retry policy',async()=>{
 const now=2*C.DAY,client=unitClient(async id=>{if(id==='newhub')throw new N.UpstreamError('429',{status:429,retryAt:now+3*C.DAY});return 'https://pixeldrain.com/u/pd';});
 const r=await B.slice(client,{},catalog(),{}, {slices:1,now:()=>now});a.equal(r.state['naruto|1|1'].hosts[1].nextAt,now+3*C.DAY);a.equal(r.state['naruto|1|1'].nextAt,now+3*C.DAY);a.equal(r.state['naruto|1|1'].status,'partial-retry');
});
test('DT a new transient failure cannot leave an old confirmed-empty flag looking like current successful metadata',async()=>{
 const now=C.DAY,client={left:()=>Infinity,stats:{},request:async()=>{throw new N.UpstreamError('503',{status:503});}};
 const r=await B.slice(client,{},catalog(),{'naruto|1|1':{noSupportedHost:true,nextAt:now-1,checkedAt:1}}, {slices:1,now:()=>now});a.equal(r.state['naruto|1|1'].noSupportedHost,undefined);a.equal(r.state['naruto|1|1'].status,'transient-retry');
});
test('DT full URL preservation retains valid alternate hosts/signatures and rejects userinfo or unrelated hosts',()=>{
 const u={s:1,e:1};for(const url of ['https://hubcloud.xyz/drive/abc?signature=keep#here','https://pixeldrain.dev/u/abc?download=keep'])a.equal(B.fromURL(url,u,1080)[4],url);
 a.equal(B.fromURL('https://user:secret@hubcloud.pw/drive/id',u,1080),null);a.equal(B.fromURL('https://evil.example/drive/id',u,1080),null);
});
test('DT a lost start POST is not automatically retried into multiple gates',async()=>{
 let count=0;const client=N.create({fetch:async()=>{count++;throw new TypeError('fixture network');}});await a.rejects(client.unlock('id'),/Network/);a.equal(count,1);
});
test('DT a409 continuation rereads the same gate and honors its remaining timer without restarting it',async()=>{
 let t=0,starts=0,continues=0,gates=0;const calls=[],client=N.create({now:()=>t,sleep:async ms=>{t+=ms;},fetch:async url=>{
  calls.push({url,t});if(url.endsWith('/start')){starts++;return {ok:true,json:async()=>({redirect_url:'https://gate.example/token?no=fetch'})};}
  if(url.endsWith('/continue')){continues++;return continues===1?{ok:false,status:409,headers:{get:()=>null}}:{ok:true,json:async()=>({done:true})};}
  if(url.includes('/gate/')){gates++;return {ok:true,json:async()=>({remaining_seconds:gates===1?15:2})};}
  return {ok:true,json:async()=>({url:'https://hubcloud.pw/drive/id'})};
 }});a.equal(await client.unlock('id'),'https://hubcloud.pw/drive/id');a.equal(starts,1);a.equal(continues,2);a.equal(gates,2);a(calls.at(-1).t>=17800);
});
test('DT a declared wait longer than the remaining budget stays pending and never calls continue/callback early',async()=>{
 let t=0;const calls=[],client=N.create({now:()=>t,deadline:30000,sleep:async ms=>{t+=ms;},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/start')?{redirect_url:'https://gate.example/token'}:{remaining_seconds:60}};}});
 await a.rejects(client.unlock('id'),/Budget/);a.equal(calls.length,2);a(!calls.some(p=>p.includes('/continue')||p.includes('/callback/')));
});
test('DT background cancellation interrupts a gate sleep, not after the full declared delay', {timeout:2000}, async()=>{
 const controller=new AbortController();let gateSeen=false;
 const client=N.create({signal:controller.signal,fetch:async url=>{if(url.includes('/gate/')){gateSeen=true;setImmediate(()=>controller.abort());}return {ok:true,json:async()=>url.endsWith('/start')?{redirect_url:'https://gate.example/token'}:{remaining_seconds:15}};}});
 await a.rejects(client.unlock('id'),/aborted|Budget/);a(gateSeen);
});
test('DT runtime exact catalog aliases match suffix slugs without network; wrong year/type and ambiguous names do not guess',async()=>{
 const rows={'naruto-dubbed':[[1,1,1,1080,'a']]},cat=catalog(['naruto-dubbed']);cat.shows[0].name='Naruto';
 const f=runtimeData(rows,cat);try{a(await f.runtime.refresh());const n=f.calls.length;a.equal(f.runtime.resolve(['Naruto'],{type:'series',year:2002,s:1,e:1}).slug,'naruto-dubbed');a.equal(f.calls.length,n);a.equal(f.runtime.resolve(['Naruto'],{type:'movie',year:2002}),null);a.equal(f.runtime.resolve(['Naruto'],{type:'series',year:2020,s:1,e:1}),null);
  f.source.rows.other=[[1,1,1,1080,'b']];const other={...structuredClone(cat.shows[0]),slug:'other'};f.source.cat.shows.push(other);f.source.t++;a(await f.runtime.refresh());a.equal(f.runtime.resolve(['Naruto'],{type:'series',year:2002,s:1,e:1}),null);
 }finally{await f.close();}
});
test('DT runtime changes to catalog title identity invalidate generation even when no shard bytes changed',async()=>{
 const f=runtimeData({naruto:[[1,1,1,1080,'id']]});try{a(await f.runtime.refresh());const gen=f.runtime.generation,count=f.calls.filter(x=>!x.includes('manifest.json')).length;f.source.cat.shows[0].name='Naruto New Alias';f.source.t++;a(await f.runtime.refresh());a.notEqual(f.runtime.generation,gen);a.equal(f.calls.filter(x=>!x.includes('manifest.json')).length,count);}finally{await f.close();}
});
test('DT runtime swaps two changed shards together, never one new shard beside another old shard', {timeout:2000},async()=>{
 const slugs=['aaa','bbb'];a.notEqual(C.shard(slugs[0]),C.shard(slugs[1]));const f=runtimeData({aaa:[[1,1,1,1080,'aold']],bbb:[[1,1,1,1080,'bold']]});
 try{a(await f.runtime.refresh());const gen=f.runtime.generation;let release,seen;const reached=new Promise(r=>{seen=r;}),hold=new Promise(r=>{release=r;});const file=C.filename(C.shard('bbb'));
  f.source.rows={aaa:[[1,1,1,1080,'anew']],bbb:[[1,1,1,1080,'bnew']]};f.source.t++;f.source.hook=async f=>{if(f===file){seen();await hold;}};
  const pending=f.runtime.refresh();await reached;a.equal(f.runtime.generation,gen);a.equal(f.runtime.lookup('aaa')[0][4],'aold');a.equal(f.runtime.lookup('bbb')[0][4],'bold');release();a(await pending);a.equal(f.runtime.lookup('aaa')[0][4],'anew');a.equal(f.runtime.lookup('bbb')[0][4],'bnew');
 }finally{await f.close();}
});
test('DT runtime rejects empty/older/corrupt-count replacements and preserves all current rows',async()=>{
 const f=runtimeData({naruto:[[1,1,1,1080,'id']]});try{a(await f.runtime.refresh());const gen=f.runtime.generation;for(const transform of [m=>({...m,n:999}),m=>({...m,ref:'mutable-main'}),m=>({...m,ts:1})]){f.source.manifestHook=transform;a.equal(await f.runtime.refresh(),false);a.equal(f.runtime.generation,gen);a.equal(f.runtime.lookup('naruto')[0][4],'id');}
  f.source.manifestHook=null;f.source.rows={};f.source.t++;a.equal(await f.runtime.refresh(),false);a.equal(f.runtime.generation,gen);
 }finally{await f.close();}
});
test('DT runtime streaming size bounds cancel oversized responses instead of buffering them indefinitely',async()=>{
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(1025));},cancel(){cancelled=true;}});await a.rejects(R.text({body},1024),/Oversized/);a(cancelled);
});
test('DT final-file keys keep HubCloud and Pixeldrain IDs distinct from each other and from upstream link IDs',()=>{
 a.notEqual(R.linkKey(0,'same'),R.linkKey(1,'same'));a.notEqual(R.linkKey(0,'same'),'same');a(R.linkKey(1,'https://hubcloud.pw/drive/id').startsWith('dti:1:'));
});
test('DT publication refuses fabricated complete episode inventories before touching a clean data checkout',async()=>{
 const dir=temp(),repo=path.join(dir,'repo'),source=path.join(dir,'source');fs.mkdirSync(repo);cp.execFileSync('git',['init','--initial-branch='+C.DATA_BRANCH],{cwd:repo,stdio:'pipe'});
 try{const cat=catalog();delete cat.shows[0].seasons[0].episodes;materialize(source,{naruto:[[1,1,1,1080,'id']]},cat,{}, {kind:'fixture'});await a.rejects(publish({repo,source}),/inventory/);a.equal(cp.execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}),'');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('DT CLI real push failure exits nonzero and cannot create a successful-publication receipt',()=>{
 const dir=temp(),repo=path.join(dir,'repo'),source=path.join(dir,'source');fs.mkdirSync(repo);cp.execFileSync('git',['init','--initial-branch='+C.DATA_BRANCH],{cwd:repo,stdio:'pipe'});cp.execFileSync('git',['remote','add','origin',path.join(dir,'nonexistent.git')],{cwd:repo,stdio:'pipe'});
 try{materialize(source,{naruto:[[1,1,1,1080,'id']]},catalog(),{}, {kind:'fixture'});const r=cp.spawnSync(process.execPath,[path.join(__dirname,'cli.cjs'),'publish','--data='+repo,'--out='+source,'--push=1'],{encoding:'utf8',timeout:10000});a.equal(r.status,1);a(!fs.existsSync(path.join(source,'publication.json')));a(r.stderr.includes('[deadtoons-index]'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
