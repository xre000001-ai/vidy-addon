'use strict';
const {Pool}=require('./pool.cjs'),{Session}=require('./transport.cjs');
const protocol=require('./protocol.cjs'),hls=require('./hls.cjs');
const {PKError,publicError}=require('./errors.cjs');
const DELIVERY='API and manifest via selected source-verified proxy; client/CDN playback is direct';
function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(signal.reason);const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason||new PKError('ABORTED'));};signal?.addEventListener('abort',abort,{once:true});});}
class Engine{
 constructor({pool=new Pool(),sessionFactory=p=>new Session(p),resolveSource=protocol.resolve,verifyMedia=hls.verify,readPlaylist=hls.playlist}={}){this.pool=pool;this.sessionFactory=sessionFactory;this.resolveSource=resolveSource;this.verifyMedia=verifyMedia;this.readPlaylist=readPlaylist;this.events=[];this.controllers=new Set();this.pending=new Set();this.cleanups=new Set();this.closed=false;this.closing=null;}
 event(e){this.events.push({...e,at:Date.now()});if(this.events.length>250)this.events.shift();}
 track(work){
  if(this.closed)return Promise.reject(new PKError('LOCAL_CLOSED'));
  const promise=Promise.resolve().then(()=>{if(this.closed)throw new PKError('LOCAL_CLOSED');return work();});this.pending.add(promise);
  promise.then(()=>this.pending.delete(promise),()=>this.pending.delete(promise));return promise;
 }
 deadline(timeout,signal,label){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(new PKError('LOCAL_DEADLINE',label)),timeout);timer.unref?.();this.controllers.add(ctrl);
  return{ctrl,signal:signal?AbortSignal.any([signal,ctrl.signal]):ctrl.signal,clear:()=>{clearTimeout(timer);this.controllers.delete(ctrl);}};
 }
 verify(proxy,server,sample,options={}){return this.track(()=>this._verify(proxy,server,sample,options));}
 async _verify(proxy,server,sample,{timeout=22000,signal,session:external}={}){
  protocol.identity(sample);if(!protocol.SERVERS.includes(server))throw new PKError('INVALID_INPUT','Unknown PK server');
  if(!this.pool.node(proxy))this.pool.add([proxy],'verification-input');
  const slot=this.pool.reserveCandidate(proxy),scope=this.deadline(timeout,signal,'Verification budget elapsed'),began=Date.now();let stage='api',session;
  try{
   scope.signal.throwIfAborted();session=external||this.sessionFactory(proxy);
   const api=await this.resolveSource(session,server,sample,{signal:scope.signal});stage='hls';
   const media=await this.verifyMedia(session,api.streams[0].playlist,{signal:scope.signal,quality:1080,audio:true});
   scope.signal.throwIfAborted();const proof={api,hls:media,ms:Date.now()-began};this.pool.prove(proxy,server,proof);this.event({type:'verified',server,proxyId:session.id,ms:proof.ms});return proof;
  }catch(e){e.stage=e.stage||stage;this.pool.fail(proxy,server,e);this.event({type:'verify-failed',server,proxyId:slot.id,...publicError(e)});throw e;}
  finally{scope.clear();try{if(session&&!external)await session.close();}finally{slot.release();}}
 }
 resolve(server,sample,options={}){return this.track(()=>this._resolve(server,sample,options));}
 async _resolve(server,sample,{budgetMs=14000,hedgeDelayMs=450,maxLanes=2,excludeProxyIds=[],signal}={}){
  protocol.identity(sample);if(!protocol.SERVERS.includes(server))throw new PKError('INVALID_INPUT','Unknown PK server');
  if(!Number.isFinite(budgetMs)||budgetMs<20||budgetMs>30000||!Number.isFinite(hedgeDelayMs)||hedgeDelayMs<0||hedgeDelayMs>5000||!Number.isInteger(maxLanes)||maxLanes<1||maxLanes>3)throw new PKError('INVALID_INPUT','Invalid bounded extraction options');
  if(!Array.isArray(excludeProxyIds)||excludeProxyIds.length>3||excludeProxyIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{16}$/.test(id)))throw new PKError('INVALID_INPUT','Invalid bounded proxy exclusion');
  // No raw-candidate or hidden direct fallback. Missing/stale proof fails closed.
  const candidates=this.pool.ready(server).filter(n=>!excludeProxyIds.includes(n.id));if(!candidates.length){this.pool.metrics.noReady++;throw new PKError('NO_READY_PROXY','No fresh source-verified proxy for '+server+'; run the local trainer');}
  const scope=this.deadline(budgetMs,signal,'Foreground budget elapsed'),excluded=new Set(excludeProxyIds),subnets=new Set(),began=Date.now(),attempts=[];
  const lane=async index=>{
   if(index)await wait(hedgeDelayMs*index,scope.signal);scope.signal.throwIfAborted();
   const lease=this.pool.lease(server,{exclude:excluded,excludeSubnets:subnets});excluded.add(lease.id);subnets.add(lease.subnet);let session,stage='api';
   const attempt={index,proxyId:lease.id,startedMs:Date.now()-began};attempts.push(attempt);
   try{
    session=this.sessionFactory(lease.proxy);const api=await this.resolveSource(session,server,sample,{signal:scope.signal});stage='hls';
    const master=await this.readPlaylist(session,api.streams[0].playlist,scope.signal);scope.signal.throwIfAborted();
    Object.assign(attempt,{success:true,endedMs:Date.now()-began});this.event({type:'served',server,proxyId:lease.id,ms:Date.now()-began,lane:index});
    return {...api,master:master.response,manifest:{url:master.response.url,text:master.text,parsed:master.parsed},viaProxy:true,proxyId:lease.id,ms:Date.now()-began,lane:index,delivery:DELIVERY};
   }catch(e){e.stage=e.stage||stage;Object.assign(attempt,{success:false,endedMs:Date.now()-began,error:publicError(e)});this.pool.fail(lease.id,server,e);this.event({type:'serve-failed',server,proxyId:lease.id,lane:index,...publicError(e)});throw e;}
   finally{
    if(!attempt.success&&maxLanes>1){try{if(session)await session.close();}finally{lease.release();}}
    else{
     // A ready API+manifest result must not wait for winner socket teardown.
     // Single-lane failure also leaves room for its distinct verified backup.
     // Track both cleanups; keep the lease until close finishes and drain on stop.
     const cleanup=(async()=>{try{if(session)await session.close();}finally{lease.release();}})();
     this.cleanups.add(cleanup);cleanup.then(()=>this.cleanups.delete(cleanup),()=>this.cleanups.delete(cleanup));
    }
   }
  };
  const lanes=Array.from({length:Math.min(maxLanes,candidates.length)},(_,i)=>lane(i));
  try{
   const result=await Promise.any(lanes);if(result.lane)this.pool.metrics.failovers++;
   for(const a of attempts)if(a.index!==result.lane&&a.success===undefined)a.cancelRequestedAtMs=Date.now()-began;
   scope.ctrl.abort(new PKError('HEDGE_LOST','A successful sibling completed'));
   // A slow proxy CONNECT cancellation must not delay an already successful result.
   // Keep cleanup tracked, keep its lease until socket teardown, and drain it on shutdown.
   const cleanup=Promise.allSettled(lanes);this.cleanups.add(cleanup);cleanup.then(()=>this.cleanups.delete(cleanup));
   return {...result,attempts};
  }
  catch(e){const failure=e?.errors?.find(x=>x.code!=='NO_READY_PROXY')||e;failure.attempts=attempts;throw failure;}
  finally{scope.clear();scope.ctrl.abort(new PKError('ABORTED'));}
 }
 async drain(){while(this.cleanups.size)await Promise.allSettled([...this.cleanups]);}
 close(){
  if(this.closing)return this.closing;this.closed=true;
  this.closing=(async()=>{for(const c of this.controllers)c.abort(new PKError('ABORTED','Engine stopped'));await Promise.allSettled([...this.pending]);await this.drain();this.pool.close();})();return this.closing;
 }
}
module.exports={Engine,wait,DELIVERY};
