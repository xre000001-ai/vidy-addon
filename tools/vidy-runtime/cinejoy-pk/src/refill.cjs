'use strict';
const {SERVERS}=require('./protocol.cjs'),{SAMPLES}=require('./samples.cjs'),{publicError,PKError}=require('./errors.cjs');
class Refiller{
 constructor(engine,{target=2,limit=10,parallel=2,intervalMs=90000,refreshBeforeMs=120000,budgetMs=65000}={}){
  this.engine=engine;Object.assign(this,{target,limit,parallel,intervalMs,refreshBeforeMs,budgetMs});this.cursor=0;this.pending=null;this.timer=null;this.controller=null;this.last=null;
  this.foregrounds=new Set();this.active=new Map();this.lastTried=new Map();this.sequence=0;this.singleTurn=0;this.queued=false;this.closed=false;
 }
 youngMs(){const p=this.engine.pool;return p.freshMs-Math.min(this.refreshBeforeMs,p.freshMs/2);}
 need(server){const p=this.engine.pool,now=p.clock();return p.ready(server,{includeBusy:true}).filter(n=>now-n.servers[server].proof.at<this.youngMs()).length<this.target;}
 due(node,server,now=this.engine.pool.clock()){
  const p=this.engine.pool;return (node.servers[server]?.coolUntil||0)<=now&&(!p.fresh(node,server,now)||now-node.servers[server].proof.at>=this.youngMs());
 }
 protected(node,server){
  const pool=this.engine.pool;if(!pool.fresh(node,server))return false;
  // Leave the last available serving endpoint to traffic. Do not suppress the
  // cold verification that must create an independent server's first proof.
  for(const request of this.foregrounds)for(const s of request)if(pool.fresh(node,s)&&pool.ready(s).length<=1)return true;
  return false;
 }
 enterForeground(servers){
  const request=SERVERS.filter(s=>servers.includes(s)),pool=this.engine.pool;this.foregrounds.add(request);let yielded=0,released=false;
  // Include leased proofs when deciding whether a refresh can safely yield.
  // Never cancel cold/partial-pool warming, and never cancel the whole batch.
  if(request.length&&request.every(s=>pool.ready(s,{includeBusy:true}).length)){
   for(const task of this.active.values()){
    if(task.refresh&&!task.controller.signal.aborted&&pool.fresh(task.node,task.server)&&request.some(s=>pool.fresh(task.node,s)&&!pool.ready(s).some(n=>n.id!==task.node.id))){
     task.controller.abort(new PKError('LOCAL_FOREGROUND','Yield blocking CineJoy refresh'));yielded++;
    }
   }
  }
  return {yielded,release:()=>{if(!released){released=true;this.foregrounds.delete(request);}}};
 }
 jobs(){
  const pool=this.engine.pool,now=pool.clock(),needed=SERVERS.filter(s=>this.need(s)),known=[],unknown=[];
  for(const id of this.lastTried.keys())if(!pool.nodes[id])this.lastTried.delete(id);
  for(const n of Object.values(pool.nodes)){
   if(pool.busy.has(n.id)||(n.globalCoolUntil||0)>now||!needed.some(s=>this.due(n,s,now)))continue;
   (Object.values(n.servers).some(b=>b.proof)?known:unknown).push(n);
  }
  const speed=n=>Math.min(...Object.values(n.servers).map(b=>b.ewmaMs||1e9));
  known.sort((a,b)=>(this.lastTried.get(a.id)||0)-(this.lastTried.get(b.id)||0)||speed(a)-speed(b));
  // Reserve exploration slots, including an early slot before slow known nodes
  // can exhaust the batch deadline. Cursor rotation is over addresses only.
  const explore=unknown.length?Math.min(unknown.length,known.length?(this.limit===1?this.singleTurn++%2:Math.max(1,Math.floor(this.limit/3))):this.limit):0;
  const selectedKnown=known.slice(0,this.limit-explore),take=Math.min(unknown.length,this.limit-selectedKnown.length),selectedUnknown=[];
  for(let i=0;i<take;i++)selectedUnknown.push(unknown[(this.cursor+i)%unknown.length]);this.cursor+=take;
  const jobs=[];while(selectedKnown.length||selectedUnknown.length){if(selectedKnown.length)jobs.push(selectedKnown.shift());if(selectedUnknown.length)jobs.push(selectedUnknown.shift());}
  return jobs;
 }
 tick(){if(this.closed)return Promise.resolve(null);if(this.pending){this.queued=true;return this.pending;}return this.run();}
 run(){
  if(this.closed)return Promise.reject(new PKError('LOCAL_CLOSED','Refiller stopped'));if(this.pending)return this.pending;
  this.pending=this._run().finally(()=>{
   this.pending=null;this.controller=null;
   // A bounded batch can slightly exceed the interval. Coalesce an overlapping
   // tick once, rather than silently idling for the entire next interval.
   if(this.queued&&!this.closed){this.queued=false;this.run().catch(e=>{this.last={at:Date.now(),error:publicError(e)};});}
  });return this.pending;
 }
 async _run(){
  const pool=this.engine.pool,jobs=this.jobs(),began=Date.now(),rows=[];let next=0;
  const controller=this.controller=new AbortController(),signal=controller.signal,timer=setTimeout(()=>controller.abort(new PKError('LOCAL_DEADLINE','Refill batch deadline')),this.budgetMs);timer.unref?.();
  try{
   const workers=await Promise.allSettled(Array.from({length:this.parallel},async()=>{
    while(next<jobs.length&&!signal.aborted&&SERVERS.some(s=>this.need(s))){
     const n=jobs[next++],row={proxyId:n.id,servers:{}};
     // Foreground work may have changed leases or cooldowns since jobs() ran.
     if(pool.busy.has(n.id)||(n.globalCoolUntil||0)>pool.clock())continue;
     const counts=Object.fromEntries(SERVERS.map(s=>[s,pool.ready(s,{includeBusy:true}).length])),order=SERVERS.slice().sort((a,b)=>counts[a]-counts[b]);
     for(const server of order){
      if(signal.aborted||(n.globalCoolUntil||0)>pool.clock())break;
      if(pool.busy.has(n.id)||!this.need(server)||!this.due(n,server)||this.protected(n,server))continue;
      const task={node:n,server,refresh:pool.fresh(n,server),controller:new AbortController()};this.active.set(n.id,task);this.lastTried.set(n.id,++this.sequence);
      try{const proof=await this.engine.verify(n.proxy,server,SAMPLES[0],{signal:AbortSignal.any([signal,task.controller.signal]),timeout:20000});row.servers[server]={verified:true,ms:proof.ms};}
      catch(e){row.servers[server]={verified:false,...publicError(e)};}
      finally{this.active.delete(n.id);}
     }
     if(Object.keys(row.servers).length){rows.push(row);pool.save();}
    }
   }));
   // Keep single-flight ownership and the deadline until every verifier drains,
   // including when one worker encounters a local persistence failure.
   const failed=workers.find(r=>r.status==='rejected');if(failed)throw failed.reason;
   this.last={at:Date.now(),elapsedMs:Date.now()-began,attempted:rows.length,rows,pool:pool.summary()};return this.last;
  }finally{clearTimeout(timer);}
 }
 start(){if(this.timer||this.closed)return;this.timer=setInterval(()=>{this.tick().catch(e=>{this.last={at:Date.now(),error:publicError(e)};});},this.intervalMs);this.timer.unref?.();}
 status(){return{enabled:!!this.timer,running:!!this.pending,queued:this.queued,targetPerServer:this.target,intervalMs:this.intervalMs,refreshBeforeMs:this.refreshBeforeMs,activeVerifications:this.active.size,foregroundRequests:this.foregrounds.size,last:this.last?{at:this.last.at,elapsedMs:this.last.elapsedMs,attempted:this.last.attempted,error:this.last.error}:null};}
 async close(){this.closed=true;this.queued=false;clearInterval(this.timer);this.timer=null;this.controller?.abort(new PKError('ABORTED','Refiller stopped'));if(this.pending)await this.pending.catch(()=>{});}
}
module.exports={Refiller};
