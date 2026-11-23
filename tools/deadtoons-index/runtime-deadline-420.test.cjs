'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const {create,text}=require('./runtime.cjs'),C=require('./core.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(p,ms=1600){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DT refresh did not settle within its independent wall-clock envelope')),ms);})]);}finally{clearTimeout(timer);}}
function make(fetcher,opts={}){const seedDir=fs.mkdtempSync(path.join(os.tmpdir(),'dt420-deadline-'));fs.mkdirSync(path.join(seedDir,'dti'));C.split({'retained-show':[[1,1,0,720,'retained']]}).forEach((p,i)=>fs.writeFileSync(path.join(seedDir,'dti',C.filename(i)),C.json(p)));const x=create({seedDir,mirrors:['https://fixture.invalid/a','https://fixture.invalid/b'],fetch:fetcher,timeout:20,...opts});return {x,clean:()=>fs.rmSync(seedDir,{recursive:true,force:true})};}
test('420 DT refresh deadline: a fetch ignoring AbortSignal cannot pin singleflight forever; next interval can retry',async()=>{
 const calls=[],{x,clean}=make((u,o)=>{calls.push(o.signal);return new Promise(()=>{});});try{const p=x.refresh();a.equal(x.refresh(),p);a.equal(await bounded(p),false);a.equal(calls.length,2);a(calls.every(s=>s.aborted));a.match(x.state.err,/deadline|timeout/i);a.equal(x.state.refreshing,false);a(x.state.attemptAt>0);a(x.state.finishedAt>=x.state.attemptAt);const next=x.refresh();a.notEqual(next,p);a.equal(await bounded(next),false);a.equal(calls.length,4);await bounded(x.close());}finally{clean();}
});
test('420 DT refresh deadline: a stalled body read ignoring abort cannot prevent a later mirror or next refresh',async()=>{
 let cancels=0;const {x,clean}=make(async()=>({ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{cancels++;}})}}));try{a.equal(await bounded(x.refresh()),false);a.equal(x.state.refreshing,false);a.match(x.state.err,/deadline|timeout/i);await bounded(x.close());a.equal(cancels,2);a.deepEqual(x.lookup('retained-show'),[[1,1,0,720,'retained']]);}finally{clean();}
});
test('420 DT bounded stream cleanup: a broken cancel promise cannot hold a complete validated response hostage',async()=>{
 let read=false;const b=Buffer.from('{"complete":true}');const r={body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:b}),cancel:()=>new Promise(()=>{})})}};a.equal(await bounded(text(r,100)),b.toString());
});
test('420 DT late network response after timeout is discarded and its body cancelled, never adopted',async()=>{
 const resolves=[];let cancelled=0;const {x,clean}=make(()=>new Promise(r=>resolves.push(r)));try{a.equal(await bounded(x.refresh()),false);const generation=x.generation;for(const resolve of resolves)resolve({ok:true,body:{cancel:async()=>{cancelled++;}},text:async()=>{throw Error('Late response must not be parsed');}});await delay(8);a.equal(cancelled,2);a.equal(x.generation,generation);a.equal(x.state.refreshing,false);await bounded(x.close());}finally{clean();}
});
test('420 DT abort-safe close: even a fetch ignoring abort settles refresh immediately and cannot schedule another mirror',async()=>{
 let calls=0;const {x,clean}=make(()=>{calls++;return new Promise(()=>{});},{timeout:60000});try{const p=x.refresh();await delay(1);await bounded(x.close());a.equal(await bounded(p),false);a.equal(calls,1);a.equal(x.state.refreshing,false);a.deepEqual(x.lookup('retained-show'),[[1,1,0,720,'retained']]);a.equal(await x.refresh(),false);}finally{clean();}
});
test('420 DT automatic fallback: stalled first manifest cannot prevent validating and adopting the next mirror generation',async()=>{
 const rows={'retained-show':[[1,1,0,720,'retained']],'new-show':[[1,0,1,1080,'new']]},cat={complete:false,shows:[]},m=C.manifest(rows,cat,{now:20,ref:'a'.repeat(40)}),pieces=C.split(rows);const {x,clean}=make(async url=>{const u=new URL(url);if(u.pathname.startsWith('/a/'))return new Promise(()=>{});return new Response(u.pathname.endsWith('manifest.json')?C.json(m):C.json(pieces[Number(path.basename(u.pathname).match(/\d+/)[0])]));});try{a.equal(await bounded(x.refresh()),true);a.equal(x.generation,m.generation);a.equal(x.state.n,2);a.equal(x.state.refreshing,false);a.equal(x.state.err,'');a.deepEqual(x.lookup('retained-show'),rows['retained-show']);a.deepEqual(x.lookup('new-show'),rows['new-show']);await bounded(x.close());}finally{clean();}
});
