'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const C=require('./core.cjs'),B=require('./build.cjs'),N=require('./network.cjs'),{materialize}=require('./cli.cjs'),{publish}=require('./publish.cjs');
const now=4*C.DAY,show='five-centimeters';
const list=type=>({data:[{slug:show,type,anime_name:'5 Centimeters per Second'}],count:1});
function source({type='movie',seasons=null,episodes=[],n=episodes.length}={}){const calls=[];return {calls,left:()=>Infinity,stats:{},request:async p=>{calls.push(p);if(p.includes('?'))return list(type);if(/\/season\/\d+$/.test(p))return {episodes:episodes.map(episode_number=>({episode_number}))};return {type,anime_name:'5 Centimeters per Second',seasons:seasons==='fixture'?[{season_number:1,episode_count:n}]:seasons,links:type==='movie'?[{quality:'1080p',servers:[]}]:null};}};}
test('420 API movie contract: real seasons null means a valid movie root unit, not invalid metadata',async()=>{
 const client=source(),cat=await B.catalog(client,{}, {now:()=>now});a(cat.complete);a.equal(cat.stats.errors,0);a.equal(cat.shows[0].type,'movie');a.deepEqual(C.units(cat).map(u=>[u.slug,u.s,u.e]),[[show,0,0]]);
});
test('420 API TV contract: seasons null on TV remains incomplete rather than inventing movie links',async()=>{
 const cat=await B.catalog(source({type:'tv'}),{}, {now:()=>now});a(!cat.complete);a.equal(C.units(cat).length,0);a(cat.shows[0].lastError);
});
test('420 API episode zero contract: the real0..16 inventory is complete and retains its zero episode',async()=>{
 const episodes=Array.from({length:17},(_,i)=>i),cat=await B.catalog(source({type:'tv',seasons:'fixture',episodes}),{}, {now:()=>now});a(cat.complete);a.equal(C.units(cat).length,17);a(C.units(cat).some(u=>u.s===1&&u.e===0&&u.sourceEpisode===0));a.equal(cat.shows[0].seasons[0].episodeOffset,0);
});
test('420 API zero episode routing stays on the episode endpoint, not the movie root endpoint',async()=>{
 for(const s of [0,1]){
  const cat={ver:4,complete:true,shows:[{slug:show,type:'tv',complete:true,seasons:[{s,n:1,episodes:[0],episodeOffset:0,complete:true}]}]},calls=[];
  const client={left:()=>Infinity,stats:{},request:async p=>{calls.push(p);return {links:[{quality:'1080p',servers:[{name:'Pixeldrain',link_server_id:'id'}]}]};},unlock:async()=> 'https://pixeldrain.com/u/id'};
  const r=await B.slice(client,{},cat,{}, {slices:1,now:()=>now});a.deepEqual(calls,['/anime/'+show+'/season/'+s+'/episode/0']);a.deepEqual(r.rows[show],[[s,0,0,1080,'id']]);
 }
});
test('420 canonical publication accepts valid complete zero episode inventory with actual both-host coverage',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt420-publish-')),repo=path.join(dir,'repo'),out=path.join(dir,'aggregate');fs.mkdirSync(repo);cp.execFileSync('git',['init','--initial-branch='+C.DATA_BRANCH],{cwd:repo,stdio:'pipe'});
 try{const cat={ver:4,complete:true,shows:[{slug:show,type:'tv',name:show,complete:true,seasons:[{s:1,n:1,episodes:[0],episodeOffset:0,complete:true}]}]};materialize(out,{[show]:[[1,0,0,1080,'pd'],[1,0,1,1080,'hc']]},cat,{}, {kind:'zero-episode-fixture'});const r=await publish({repo,source:out});a.equal(r.units.done,1);a.equal(r.units.total,1);a.equal(r.n,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('420 automatic migration reopens only419 local movie-shape backoff so the valid format retries without waiting',async()=>{
 const client=source(),previous={ver:4,complete:false,shows:[{slug:show,type:'movie',name:show,seasons:[],root:false,metaComplete:false,complete:false,checkedAt:0,attemptAt:now-10,nextAt:now+C.DAY,failures:1,lastError:{status:0,message:'Invalid show metadata'}}]};
 const cat=await B.catalog(client,previous,{now:()=>now});a(cat.complete);a(client.calls.includes('/anime/'+show));a.equal(cat.contract,2);a.equal(cat.shows[0].lastError,undefined);
});
test('420 automatic migration reopens only419 local zero-inventory validation failure, keeping real upstream retry-after intact',async()=>{
 const client=source({type:'tv',seasons:'fixture',episodes:[0,1]}),previous={ver:4,complete:false,shows:[{slug:show,type:'tv',name:show,metaComplete:true,checkedAt:now-10,seasons:[{s:1,n:2,episodes:[],complete:false,nextAt:now+C.DAY,lastError:{status:0,message:'Invalid episode inventory'}}]}]};
 const cat=await B.catalog(client,previous,{now:()=>now});a(cat.complete);a(client.calls.includes('/anime/'+show+'/season/1'));a.equal(C.units(cat).length,2);
 const blocked=source(),genuine={ver:4,shows:[{slug:show,type:'movie',seasons:[],root:false,metaComplete:false,complete:false,nextAt:now+C.DAY,lastError:{status:429,message:'Upstream 429'}}]};
 const pending=await B.catalog(blocked,genuine,{now:()=>now});a(!pending.complete);a.equal(blocked.calls.length,1);a.equal(pending.shows[0].nextAt,now+C.DAY);
});
test('420 retained-catalog recovery refreshes due known movie metadata even when the current list request fails',async()=>{
 const client=source();const get=client.request;client.request=async p=>{if(p.includes('?'))throw new N.UpstreamError('503',{status:503});return get(p);};
 const old={ver:4,shows:[{slug:show,type:'movie',name:show,seasons:[],root:false,metaComplete:false,complete:false,lastError:{status:0,message:'Invalid show metadata'},nextAt:now+C.DAY}]};
 const cat=await B.catalog(client,old,{now:()=>now});a(!cat.complete);a(client.calls.includes('/anime/'+show));a.equal(C.units(cat).length,1);
});
test('420 exact preservation: all351 released419 files reconstruct; all non-DT runtime functions and settings remain as419/418',()=>{
 const {before420}=require('./preservation-420.cjs'),pins=require('./fixtures/baseline-419-sha256.json');a.equal(Object.keys(pins).length,351);
 for(const[file,h]of Object.entries(pins))a.equal(crypto.createHash('sha256').update(before420(file)).digest('hex'),h,file);
});
