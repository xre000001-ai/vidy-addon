'use strict';
// Exercise the real catalog/slice/artifact/merge/publisher CLI contracts, with
// the API client replaced BEFORE loading the CLI. All git remotes are local.
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const C=require('./core.cjs'),{materialize}=require('./cli.cjs'),{publish}=require('./publish.cjs');
test('DT whole offline pipeline: one real catalog artifact, four CLI slice artifacts, snapshot binding, retained rows and atomic publication',{timeout:20000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt419-pipeline-')),repo=path.join(dir,'data'),source=path.join(dir,'source'),plan=path.join(dir,'plan'),results=path.join(dir,'results'),aggregate=path.join(dir,'aggregate'),mock=path.join(dir,'client.cjs');
 fs.mkdirSync(repo);const git=(...args)=>cp.execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();git('init','--initial-branch='+C.DATA_BRANCH);
 const slugs=Array.from({length:10},(_,i)=>'title-'+i),baseRows=Object.fromEntries(slugs.map(slug=>[slug,[[1,1,1,720,'old-'+slug]]]));
 const env={...process.env,GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ID:'offline-fixture',NODE_OPTIONS:'--require='+mock};delete env.GITHUB_STEP_SUMMARY;
 fs.writeFileSync(mock,`'use strict';const n=require(${JSON.stringify(path.join(__dirname,'network.cjs'))});global.fetch=async()=>{throw Error('NO REAL NETWORK IN QUALIFICATION');};const slugs=${JSON.stringify(slugs)};n.create=()=>({left:()=>Infinity,stats:{fixture:true},request:async p=>{if(p.includes('?'))return {data:slugs.map(slug=>({slug,type:'tv',anime_name:slug})),count:slugs.length};if(/\\/episode\\/1$/.test(p))return {links:[{quality:'1080p',servers:[{name:'HubCloud',link_server_id:'hub-'+p.split('/')[2]},{name:'Pixeldrain',link_server_id:'pd-'+p.split('/')[2]}]}]};if(/\\/season\\/1$/.test(p))return {episodes:[{episode_number:1}]};return {type:'tv',anime_name:p.split('/')[2],release_date:'2002-01-01',seasons:[{season_number:1,episode_count:1}]};},unlock:async id=>id.startsWith('hub-')?'https://hubcloud.pw/drive/'+id:'https://pixeldrain.com/u/'+id});\n`);
 const cli=(...args)=>cp.spawnSync(process.execPath,[path.join(__dirname,'cli.cjs'),...args],{encoding:'utf8',env,timeout:8000});
 const ok=r=>a.equal(r.status,0,r.stderr+'\n'+r.stdout);
 try{
  materialize(source,baseRows,{ver:4,complete:false,at:0,shows:[]},{},{kind:'fixture-seed'});const seed=await publish({repo,source});
  ok(cli('catalog','--data='+repo,'--out='+plan,'--budget=60'));const cat=C.read(path.join(plan,'catalog.json'));a(cat.complete);a.equal(C.units(cat).length,10);
  for(let i=0;i<4;i++)ok(cli('slice','--data='+repo,'--plan='+plan,'--out='+path.join(results,'dt-slice-'+i),'--slice='+i,'--slices=4','--budget=90'));
  const badPath=path.join(results,'dt-slice-0/result.json'),saved=fs.readFileSync(badPath),bad=JSON.parse(saved);bad.base='f'.repeat(40);C.write(badPath,bad);
  const foreign=cli('merge','--data='+repo,'--plan='+plan,'--results='+results,'--out='+aggregate,'--slices=4');a.equal(foreign.status,1);a(foreign.stderr.includes('foreign'));a(!fs.existsSync(path.join(aggregate,'dti/manifest.json')));fs.writeFileSync(badPath,saved);
  ok(cli('merge','--data='+repo,'--plan='+plan,'--results='+results,'--out='+aggregate,'--slices=4'));const m=C.read(path.join(aggregate,'dti/manifest.json'));a.equal(m.n,30);a.equal(m.units.done,10);a.equal(m.units.total,10);
  for(const [slug,rr]of Object.entries(C.load(aggregate,C.SHARDS,{strict:true})))a(rr.some(r=>r[4]==='old-'+slug));
  ok(cli('publish','--data='+repo,'--out='+aggregate,'--expected='+seed.commit));const receipt=C.read(path.join(aggregate,'publication.json'));a.equal(receipt.published,false);a.equal(receipt.commit,git('rev-parse','HEAD'));a.equal(receipt.snapshot,git('rev-parse','HEAD^'));a.equal(git('status','--porcelain'),'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
