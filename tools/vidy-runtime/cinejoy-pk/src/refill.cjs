'use strict';
const {SERVERS}=require('./protocol.cjs'),{SAMPLES}=require('./samples.cjs'),{classify,publicError,PKError}=require('./errors.cjs');
class Refiller{
 constructor(engine,{target=2,limit=10,parallel=2,intervalMs=90000,refreshBeforeMs=120000,budgetMs=65000}={}){this.engine=engine;Object.assign(this,{target,limit,parallel,intervalMs,refreshBeforeMs,budgetMs});this.cursor=0;this.pending=null;this.timer=null;this.controller=null;this.last=null;}
 need(server){const p=this.engine.pool,now=p.clock();return p.ready(server).filter(n=>now-n.servers[server].proof.at<p.freshMs-this.refreshBeforeMs).length<this.target;}
 run(){if(this.pending)return this.pending;this.pending=this._run().finally(()=>{this.pending=null;this.controller=null;});return this.pending;}
 async _run(){
  const pool=this.engine.pool,all=Object.values(pool.nodes),known=all.filter(n=>Object.values(n.servers).some(b=>b.proof)).sort((a,b)=>Math.min(...Object.values(a.servers).map(x=>x.ewmaMs||1e9))-Math.min(...Object.values(b.servers).map(x=>x.ewmaMs||1e9))),unknown=all.filter(n=>!known.includes(n));
  const order=[...known];for(let i=0;i<Math.min(this.limit,unknown.length);i++)order.push(unknown[(this.cursor+i)%unknown.length]);this.cursor+=this.limit;
  const jobs=order.filter(n=>!pool.busy.has(n.id)&&(n.globalCoolUntil||0)<=pool.clock()).slice(0,this.limit),began=Date.now(),rows=[];let next=0;
  this.controller=new AbortController();const signal=this.controller.signal,timer=setTimeout(()=>this.controller?.abort(new PKError('LOCAL_DEADLINE','Refill batch deadline')),this.budgetMs);timer.unref?.();
  try{
   await Promise.all(Array.from({length:this.parallel},async()=>{
    while(next<jobs.length&&!signal.aborted&&SERVERS.some(s=>this.need(s))){
     const n=jobs[next++],row={proxyId:n.id,servers:{}};
     for(const server of SERVERS){
      if(signal.aborted)break;if(!this.need(server)||(n.servers[server]?.coolUntil||0)>pool.clock())continue;
      try{const proof=await this.engine.verify(n.proxy,server,SAMPLES[0],{signal,timeout:20000});row.servers[server]={verified:true,ms:proof.ms};}
      catch(e){row.servers[server]={verified:false,...publicError(e)};if(e.stage==='api'&&['transport','source-block','rate-limit'].includes(classify(e)))break;}
     }rows.push(row);pool.save();
    }
   }));
   this.last={at:Date.now(),elapsedMs:Date.now()-began,attempted:rows.length,rows,pool:pool.summary()};return this.last;
  }finally{clearTimeout(timer);}
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>{this.run().catch(e=>{this.last={at:Date.now(),error:publicError(e)};});},this.intervalMs);this.timer.unref?.();}
 status(){return{enabled:!!this.timer,running:!!this.pending,targetPerServer:this.target,intervalMs:this.intervalMs,refreshBeforeMs:this.refreshBeforeMs,last:this.last?{at:this.last.at,elapsedMs:this.last.elapsedMs,attempted:this.last.attempted,error:this.last.error}:null};}
 async close(){clearInterval(this.timer);this.timer=null;this.controller?.abort(new PKError('ABORTED','Refiller stopped'));if(this.pending)await this.pending.catch(()=>{});}
}
module.exports={Refiller};
