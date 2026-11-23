'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const C=require('./core.cjs'),B=require('./build.cjs'),N=require('./network.cjs'),R=require('./runtime.cjs'),{materialize}=require('./cli.cjs'),{publish}=require('./publish.cjs');
const cat=(slugs=['naruto'],n=1)=>({ver:4,at:100,complete:true,shows:slugs.map(slug=>({slug,type:'tv',seasons:[{s:1,n,episodes:Array.from({length:n},(_,i)=>i+1),complete:true,episodeOffset:0}],metaComplete:true,complete:true}))});
function fixture({fail=false,noHosts=false}={}){
 const calls=[],client={left:()=>Infinity,stats:{},request:async p=>{calls.push(p);if(fail)throw new N.UpstreamError('fixture503',{status:503});return {links:noHosts?[]:[{quality:'1080p x264',servers:[{name:'HubCloud',link_server_id:'hub-'+p.split('/')[2]},{name:'Pixeldrain',link_server_id:'pixel-'+p.split('/')[2]}]}]};},unlock:async id=>{calls.push('unlock:'+id);return id.startsWith('hub-')?'https://hubcloud.pw/drive/'+id:'https://pixeldrain.com/u/'+id;}};return {client,calls};
}
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'dt419-'));}
function runtimeFixture(initial={naruto:[[1,1,1,1080,'oldid']]}){
 const dir=temp(),clock={t:10000};C.split(initial).forEach((j,i)=>C.write(path.join(dir,'dti',C.filename(i)),j));
 let data=initial,manifest=C.manifest(data,cat(),{now:clock.t,ref:'a'.repeat(40)}),mode='',calls=[];
 const fetcher=async url=>{
  calls.push(url);a(!/deadbase|unlock|\.workers\.dev/.test(url),'Index requests only');
  if(url.includes('manifest.json'))return {ok:true,text:async()=>C.json(manifest)};
  const file=new URL(url).pathname.split('/').pop(),i=Number(file.slice(1,3));let body=C.json(C.split(data)[i]);
  if(mode==='bad-hash'&&i===C.shard('naruto'))body+=' ';
  if(mode==='http-fail')return {ok:false,status:503};
  return {ok:true,text:async()=>body};
 };
 const runtime=R.create({seedDir:dir,mirrors:['https://raw.githubusercontent.com/fixture/repo/deadtoons-index/dti'],fetch:fetcher,clock:()=>clock.t});
 return {dir,runtime,calls,update(next){data=next;clock.t++;manifest=C.manifest(next,cat(),{now:clock.t,ref:'b'.repeat(40)});},mode(x){mode=x;},manifest:()=>manifest};
}
test('DT canonical rows deduplicate exact successes and never promote negative markers/placeholders',()=>{
 const raw={naruto:[[1,1,1,1080,'id'],[1,1,1,1080,'id'],[1,2,-1,0,''],[1,2,0,720,'pd']]};
 a.deepEqual(C.normalize(raw),{naruto:[[1,1,1,1080,'id'],[1,2,0,720,'pd']]});a.equal(C.row([1,2,1,720,'https://evil.example/file']),null);a.equal(C.row([1,2,1,720,'https://hubcloud.pw/drive/id?token=keep'])[4],'https://hubcloud.pw/drive/id?token=keep');
});
test('DT shard and work ownership agree for all80 titles and arbitrary1/3/4/5/7/16 slice counts',()=>{
 for(const slices of [1,3,4,5,7,16])for(let i=0;i<80;i++){const slug='fixture-'+i;const selected=Array.from({length:slices},(_,s)=>s).filter(s=>C.owner(slug,slices)===s);a.deepEqual(selected,[C.shard(slug)%slices]);}
});
test('DT full builder fixture: all80 successful units survive five-slice aggregation, not13',async()=>{
 const slugs=['one-piece','naruto',...Array.from({length:78},(_,i)=>'fixture-'+i)],results=[];
 for(let slice=0;slice<5;slice++){const f=fixture();results.push(await B.slice(f.client,{},cat(slugs),{},{slice,slices:5,now:()=>100000}));}
 const rows=C.mergeResults({},results,5);a.equal(Object.keys(rows).length,80);a.equal(C.metrics(rows,cat(slugs),2).units.done,80);a.equal(Object.values(rows).flat().length,160);
});
test('DT distinct-host completion never mistakes two HubCloud qualities for both mirrors',async()=>{
 const f=fixture(),result=await B.slice(f.client,{naruto:[[1,1,1,720,'old1'],[1,1,1,1080,'old2']]},cat(),{},{slices:1,now:()=>100000});
 a.equal(new Set(result.rows.naruto.map(r=>r[2])).size,2);a(result.rows.naruto.some(r=>r[4]==='old1'));a.equal(C.metrics(result.rows,cat(),2).units.done,1);
});
test('DT transient metadata503 retains all successful rows, adds no no-host markers and schedules retry',async()=>{
 const f=fixture({fail:true}),old={naruto:[[1,1,1,720,'oldid']]},r=await B.slice(f.client,old,cat(),{},{slices:1,now:()=>100000});
 a.deepEqual(r.rows,C.normalize(old));a.equal(r.stats.metadataOK,0);a.equal(r.stats.errors,1);a(r.state['naruto|1|1'].nextAt>100000);a.equal(r.state['naruto|1|1'].noSupportedHost,undefined);a.equal(C.metrics(r.rows,cat(),2).units.done,0);
});
test('DT confirmed no-supported-host result is retry metadata, not an accumulating negative row',async()=>{
 const f=fixture({noHosts:true}),r=await B.slice(f.client,{},cat(),{},{slices:1,now:()=>100000});a.deepEqual(r.rows,{});a(r.state['naruto|1|1'].noSupportedHost);a.equal(C.plan({},cat(),r.state,{now:100001,slices:1}).length,0);a.equal(C.metrics(r.rows,cat(),2).units.done,0);
});
test('DT complete units are automatically refreshed when due; old valid mirrors remain',async()=>{
 const now=2*C.DAY,f=fixture(),old={naruto:[[1,1,1,720,'keep-hub'],[1,1,0,720,'keep-pd']]},state={'naruto|1|1':{checkedAt:1,nextAt:now-1}};
 const r=await B.slice(f.client,old,cat(),state,{slices:1,now:()=>now});a(f.calls.some(p=>p.includes('/episode/1')));a.equal(r.rows.naruto.length,4);a.equal(r.state['naruto|1|1'].nextAt,now+C.DAY);
});
test('DT unit planning rotates attempted failures behind unseen units and honors explicit backoff',()=>{
 const c=cat(['aaa','bbb','ccc']),state={'aaa|1|1':{attemptAt:90},'ccc|1|1':{attemptAt:2,nextAt:200}};
 a.deepEqual(C.plan({},c,state,{now:100,slices:1}).map(x=>x.slug),['bbb','aaa']);
});
test('DT generation follows content, not row count; status-only refresh keeps cache generation stable',()=>{
 const x={naruto:[[1,1,1,1080,'old']]},y={naruto:[[1,1,1,1080,'new']]};a.notEqual(C.manifest(x,cat()).generation,C.manifest(y,cat()).generation);a.equal(C.manifest(x,cat(),{now:1}).generation,C.manifest(x,cat(),{now:2}).generation);
});
test('DT global manifest counters equal actual deduplicated successes, never attempted/slice counts',()=>{
 const m=C.manifest({naruto:[[1,1,1,1080,'a'],[1,1,0,1080,'b'],[1,1,0,1080,'b'],[1,2,-1,0,'']]},cat(['naruto'],2));a.equal(m.n,2);a.equal(m.units.done,1);a.equal(m.units.covered,1);a.equal(m.units.total,2);a.equal(Object.keys(m.files).length,16);
});
test('DT aggregation rejects absent slices, foreign shard work and duplicate slice artifacts',()=>{
 a.throws(()=>C.mergeResults({},[],4),/Missing/);const slice=C.owner('naruto',4);a.throws(()=>C.mergeResults({},[{slice:(slice+1)%4,slices:4,rows:{naruto:[[1,1,1,720,'x']]}}],4),/Foreign/);a.throws(()=>C.mergeResults({},[{slice:0,slices:1,rows:{}},{slice:0,slices:1,rows:{}}],1),/duplicate/);
});
test('DT catalog is shared/persistable and preserves exact requested season counts without treating failures as movies',async()=>{
 const calls=[],client={left:()=>Infinity,request:async p=>{calls.push(p);if(p.includes('?'))return {data:[{slug:'naruto',type:'tv'}],count:1};if(/\/season\/[12]$/.test(p)){const offset=p.endsWith('/2')?26:0;return {episodes:Array.from({length:26},(_,i)=>({episode_number:offset+i+1}))};}return {type:'tv',seasons:[{season_number:1,episode_count:26},{season_number:2,episode_count:26}]};}};
 const c=await B.catalog(client,{}, {now:()=>100000});a(c.complete);a.equal(C.units(c).length,52);a.equal(calls.length,4);a.equal(C.units(c).find(u=>u.s===2&&u.e===1).sourceEpisode,27);
 const failed=await B.catalog({left:()=>Infinity,request:async p=>{if(p.includes('?'))return {data:[{slug:'new-show'}]};throw Error('503');}}, {},{now:()=>100000});a(!failed.complete);a.equal(C.units(failed).length,0);
});
test('DT cooldown honors declared15seconds and never calls callback before continue is done',async()=>{
 let t=0;const calls=[],client=N.create({now:()=>t,sleep:async ms=>{t+=ms;},fetch:async(url)=>{calls.push({url,t});const p=new URL(url).pathname;return {ok:true,json:async()=>p.endsWith('/start')?{redirect_url:'https://gate.fixture/token'}:p.endsWith('/continue')?{done:true}:p.includes('/gate/')?{remaining_seconds:15}:{url:'https://hubcloud.pw/drive/id'}};}});
 a.equal(await client.unlock('id'),'https://hubcloud.pw/drive/id');a.equal(client.stats.gateWaitMs,15400);a(calls.at(-1).t>=15400);a(calls.at(-2).url.endsWith('/continue'));
});
test('DT429 honors Retry-After and retries boundedly; too-short budgets return pending instead of bypass',async()=>{
 let t=0,count=0;const times=[],client=N.create({now:()=>t,sleep:async ms=>{t+=ms;},fetch:async()=>{times.push(t);return ++count===1?{ok:false,status:429,headers:{get:()=> '45'}}:{ok:true,json:async()=>({ok:true})};}});a.deepEqual(await client.request('/anime?page=1'),{ok:true});a.equal(count,2);a(times[1]-times[0]>=45000);
 let n=0;const limited=N.create({now:()=>0,deadline:1000,sleep:async()=>{},fetch:async()=>{n++;return {ok:false,status:429,headers:{get:()=> '45'}};}});await a.rejects(limited.request('/anime?page=1'),e=>e.status===429&&e.retryAt>=45000);a.equal(n,1);
});
test('DT malformed upstream JSON and non-API request targets fail visibly, not as empty titles',async()=>{
 const client=N.create({sleep:async()=>{},fetch:async()=>({ok:true,json:async()=>{throw Error('bad JSON');}})});await a.rejects(client.request('/anime?page=1'),/Invalid upstream JSON/);await a.rejects(client.request('https://media.example/file'),/Invalid/);
});
test('DT runtime starts ready and lookup is synchronous/memory-only even if the network is unavailable',async()=>{
 const f=runtimeFixture();try{const rows=f.runtime.lookup('naruto');a(Array.isArray(rows));a.equal(rows.length,1);a.equal(f.calls.length,0);a.equal(f.runtime.state.src,'bundled');a.equal(f.runtime.lookup('absent'),null);}finally{await f.runtime.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('DT runtime newer same-count generation replaces old rows atomically at an immutable ref',async()=>{
 const f=runtimeFixture();try{const first=f.runtime.generation;f.update({naruto:[[1,1,1,1080,'newid']]});a(await f.runtime.refresh());a.notEqual(f.runtime.generation,first);a.equal(f.runtime.lookup('naruto')[0][4],'newid');a(f.calls.some(x=>x.includes('/'+'b'.repeat(40)+'/dti/')));}finally{await f.runtime.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('DT runtime status-only updates do not redownload all unchanged shards or invalidate generation',async()=>{
 const f=runtimeFixture();try{const first=f.runtime.generation;a(await f.runtime.refresh());a.equal(f.runtime.generation,first);a.equal(f.calls.filter(x=>!x.includes('manifest.json')).length,0);}finally{await f.runtime.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('DT runtime checksum/HTTP failure retains the entire last good generation',async()=>{
 for(const mode of ['bad-hash','http-fail']){const f=runtimeFixture();try{const first=f.runtime.generation;f.update({naruto:[[1,1,1,1080,'newid']]});f.mode(mode);a.equal(await f.runtime.refresh(),false);a.equal(f.runtime.generation,first);a.equal(f.runtime.lookup('naruto')[0][4],'oldid');a(f.runtime.state.err);}finally{await f.runtime.close();fs.rmSync(f.dir,{recursive:true,force:true});}}
});
test('DT runtime refresh is single-flight and legacy statistics cannot overwrite active shard generation',async()=>{
 const f=runtimeFixture();try{const p=f.runtime.refresh();a.equal(f.runtime.refresh(),p);await p;const gen=f.runtime.generation;f.runtime.noteLegacy({n:9435,ts:1});a.equal(f.runtime.state.n,1);a.equal(f.runtime.generation,gen);a.equal(f.runtime.state.legacy.n,9435);}finally{await f.runtime.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('DT raw/CDN immutable URL builders use the selected data snapshot, not mutable main',()=>{
 const ref='a'.repeat(40);a.equal(R.immutable('https://raw.githubusercontent.com/o/r/deadtoons-index/dti',ref,'s00.json'),'https://raw.githubusercontent.com/o/r/'+ref+'/dti/s00.json');a.equal(R.immutable('https://cdn.jsdelivr.net/gh/o/r@deadtoons-index/dti',ref,'s00.json'),'https://cdn.jsdelivr.net/gh/o/r@'+ref+'/dti/s00.json');
});
test('DT publisher creates one atomic data-branch head pointing to its immutable parent snapshot',async()=>{
 const dir=temp(),repo=path.join(dir,'repo'),remote=path.join(dir,'remote.git'),source=path.join(dir,'source');fs.mkdirSync(repo);const git=(cwd,...args)=>cp.execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 try{
  git(dir,'init','--bare',remote);git(repo,'init','--initial-branch='+C.DATA_BRANCH);git(repo,'remote','add','origin',remote);materialize(source,{naruto:[[1,1,1,1080,'id']]},cat(),{}, {kind:'offline-fixture'});
  const result=await publish({repo,source,push:true});a.equal(git(repo,'ls-remote','origin','refs/heads/'+C.DATA_BRANCH).split(/\s/)[0],result.commit);const m=JSON.parse(git(repo,'show','HEAD:dti/manifest.json'));a.equal(m.ref,git(repo,'rev-parse','HEAD^'));a.equal(m.n,1);
  for(const[file,h]of Object.entries(m.files)){const raw=cp.execFileSync('git',['show',m.ref+':dti/'+file],{cwd:repo});a.equal(C.digest(raw),h);}
  a.equal(git(repo,'status','--porcelain'),'');await a.rejects(publish({repo,source,expected:'f'.repeat(40),push:true}),/advanced/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('DT data publication fails on bad aggregate hashes and never reports a successful push',async()=>{
 const dir=temp(),repo=path.join(dir,'repo'),source=path.join(dir,'source');fs.mkdirSync(repo);cp.execFileSync('git',['init','--initial-branch='+C.DATA_BRANCH],{cwd:repo,stdio:'pipe'});
 try{materialize(source,{naruto:[[1,1,1,1080,'id']]},cat(),{}, {kind:'offline-fixture'});fs.appendFileSync(path.join(source,'dti',C.filename(C.shard('naruto'))),' ');await a.rejects(publish({repo,source}),/digest|Noncanonical/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
