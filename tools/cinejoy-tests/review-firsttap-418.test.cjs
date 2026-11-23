'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {app,result,proof,P1,P2,proxyId,wait,SERVERS}=require('./addon-helpers.cjs');
const {Refiller}=require('../vidy-runtime/cinejoy-pk/src/refill.cjs');
const {PKError}=require('../vidy-runtime/cinejoy-pk/src/errors.cjs');
const keepAlive=setInterval(()=>{},1000);after(()=>clearInterval(keepAlive));
const one={type:'movie',id:'tt1375666',season:0,episode:0,origin:'https://addon.example',config:{cjsrv:['nebula','sirius','polaris']}};
function makeCold(a){for(const n of Object.values(a.pool.nodes))for(const b of Object.values(n.servers))b.proof=null;}
function warmFixture(a,{stall=false}={}){
 let release,started;const gate=new Promise(r=>{release=r;}),began=new Promise(r=>{started=r;});let first=true;
 const original=a.engine.resolveSource;
 a.engine.resolveSource=async(session,server,input,options)=>{if(first){first=false;started();if(stall)await wait(10000,options.signal);else await gate;}return original(session,server,input,options);};
 a.engine.verifyMedia=async()=>proof(P1).hls;
 const refiller=a.source.refiller=new Refiller(a.engine,{target:1,limit:1,parallel:1});
 return {refiller,release,began,start:()=>refiller.run()};
}
test('418 CJ: the first call uses a fresh own-source proof produced by an already-running cold verifier',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'600'},delay:1});makeCold(a);const f=warmFixture(a);
 try{const work=f.start();await f.began;const cardsP=a.source.streams(one);await wait(20);f.release();const cards=await cardsP;await work;assert.equal(cards.length,3);assert.equal(a.pool.busy.size,0);assert.equal(f.refiller.controller,null);assert(!a.source.events.some(e=>e.type==='source-error'));}finally{f.release();await a.close();}
});
test('418 CJ: cold warming can supply all four servers inside the same existing request deadline',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'600'},delay:1});makeCold(a);const f=warmFixture(a);
 try{const work=f.start();await f.began;const cardsP=a.source.streams({...one,config:{cjq:[1080]}});await wait(15);f.release();const cards=await cardsP;await work;assert.equal(cards.length,4);assert.deepEqual([...new Set(cards.map(c=>c._srv))],SERVERS);assert.equal(a.pool.busy.size,0);}finally{f.release();await a.close();}
});
test('418 CJ: a cold verifier that cannot finish is not cancelled, and cannot extend the source budget',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'180'},delay:1});makeCold(a);const f=warmFixture(a,{stall:true});
 try{const work=f.start();await f.began;const began=Date.now(),cards=await a.source.streams(one);assert.equal(cards.length,0);assert.equal(cards.$pend,true);assert(Date.now()-began<500);assert.equal(f.refiller.controller.signal.aborted,false);assert.equal(a.pool.metrics.selections,0,'unverified candidates cannot become extraction leases');await f.refiller.close();await work;}finally{f.release();await a.close();}
});
test('418 CJ: stopping a cold verifier ends readiness waiting without an unbounded trainer or raw fallback',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'600'}});makeCold(a);const f=warmFixture(a,{stall:true});
 try{const work=f.start();await f.began;const began=Date.now(),cardsP=a.source.streams(one);await wait(15);await f.refiller.close();const cards=await cardsP;await work;assert.equal(cards.length,0);assert(Date.now()-began<400);assert.equal(a.pool.metrics.selections,0);}finally{f.release();await a.close();}
});
test('418 CJ: an idle or missing refiller never turns a cold pool into a foreground trainer',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'600'}});makeCold(a);const r=a.source.refiller=new Refiller(a.engine);
 try{assert.equal(r.warming('Light'),false);const began=Date.now(),cards=await a.source.streams(one);assert.equal(cards.length,0);assert(Date.now()-began<250);assert.equal(a.calls.length,0);assert.equal(r.pending,null);}finally{await a.close();}
});
test('418 CJ: cancelled/cooled active candidates do not count as possible source readiness',async()=>{
 const a=app({proxies:[P1]});makeCold(a);const r=a.source.refiller=new Refiller(a.engine);const node=a.pool.node(P1),controller=new AbortController();r.pending=Promise.resolve();r.controller=new AbortController();r.active.set(node.id,{node,server:'Light',controller});
 try{assert.equal(r.warming('Light'),true);node.globalCoolUntil=a.pool.clock()+1000;assert.equal(r.warming('Light'),false);node.globalCoolUntil=0;controller.abort();assert.equal(r.warming('Light'),false);assert.equal(r.warming('unknown'),false);}finally{r.active.clear();await a.close();}
});
test('418 CJ: a successful manifest returns before winner cleanup, retaining its lease until cleanup drains',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'180'},delay:1});let release;const gate=new Promise(r=>{release=r;});a.engine.sessionFactory=p=>({id:proxyId(p),close:async()=>gate});
 try{const began=Date.now(),cards=await a.source.streams(one);assert.equal(cards.length,3);assert(Date.now()-began<150);assert.equal(a.pool.busy.size,1);assert(a.engine.cleanups.size>0);release();await a.engine.drain();assert.equal(a.pool.busy.size,0);}finally{release();await a.close();}
});
test('418 CJ: rejected winner cleanup cannot erase a successful manifest or penalize a proven endpoint',async()=>{
 const a=app({proxies:[P1],delay:1});a.engine.sessionFactory=p=>({id:proxyId(p),close:async()=>{throw Error('deliberate teardown failure');}});
 try{assert.equal((await a.source.streams(one)).length,3);await a.engine.drain();assert.equal(a.pool.busy.size,0);assert.equal(a.pool.node(P1).servers.Light.fail,0);assert.equal(a.engine.cleanups.size,0);}finally{await a.close();}
});
test('418 CJ: graceful shutdown still waits for tracked winner teardown before closing its pool',async()=>{
 const a=app({proxies:[P1],env:{CINEJOY_BUDGET_MS:'180'},delay:1});let release,closed=false;const gate=new Promise(r=>{release=r;});a.engine.sessionFactory=p=>({id:proxyId(p),close:async()=>gate});
 try{assert.equal((await a.source.streams(one)).length,3);const stopping=a.source.close().then(()=>{closed=true;});await wait(15);assert.equal(closed,false);assert.equal(a.pool.closed,false);release();await stopping;assert.equal(a.pool.closed,true);assert.equal(a.pool.busy.size,0);}finally{release();await a.close();}
});
test('418 CJ: transient upstream/availability errors are pending metadata without changing the JSON array contract',async()=>{
 let fail=true;const a=app({proxies:[P1,P2],resolve:async(session,server)=>{if(fail)throw new PKError('HTTP_502','upstream',{status:502});return {...result(server),proxyId:session.id};}});
 try{const cards=await a.source.streams(one);assert.equal(cards.length,0);assert.equal(cards.$pend,true);assert.equal(JSON.stringify(cards),'[]');assert.deepEqual(Object.keys(cards),[]);assert.equal(a.calls.length,2);fail=false;assert.equal((await a.source.streams(one)).length,3);}finally{await a.close();}
});
test('418 CJ: a conclusive content miss is not pending, and a ready sibling is never discarded',async()=>{
 const a=app({resolve:async(session,server)=>{if(server==='Light')throw new PKError('HTTP_404','missing',{status:404});return {...result(server),proxyId:session.id};}});
 try{const cards=await a.source.streams({...one,config:{cjq:[1080]}});assert.equal(cards.length,3);assert.equal(!!cards.$pend,false);assert(!cards.some(c=>c._srv==='Light'));}finally{await a.close();}
});
test('418 CJ: foreground successes do not renew media-proof timestamps or borrow another source pool',async()=>{
 const a=app({proxies:[P1],delay:1});
 try{const before=Object.fromEntries(SERVERS.map(s=>[s,a.pool.node(P1).servers[s].proof.at]));assert.equal((await a.source.streams({...one,config:{cjq:[1080]}})).length,4);for(const s of SERVERS)assert.equal(a.pool.node(P1).servers[s].proof.at,before[s]);await a.engine.drain();assert.equal(a.pool.busy.size,0);}finally{await a.close();}
});
