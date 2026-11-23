'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine,wait}=require('../vidy-runtime/cinejoy-pk/src/engine.cjs'),{proxyId}=require('../vidy-runtime/cinejoy-pk/src/policy.cjs'),{fixture,proof,P1,P2}=require('./helpers.cjs');
test('successful foreground response never waits for deliberately slow loser teardown; shutdown still drains it',async()=>{
 const f=fixture();let releaseTeardown;const teardown=new Promise(r=>{releaseTeardown=r;});
 try{
  f.pool.add([P1,P2]);for(const p of [P1,P2])f.pool.prove(p,'Light',proof(p));
  const e=new Engine({pool:f.pool,sessionFactory:p=>({id:proxyId(p),close:async()=>{if(p===P1)await teardown;}}),resolveSource:async(s,server,sample,{signal})=>{await wait(s.id===proxyId(P1)?500:1,signal);return{server,proxyId:s.id,streams:[{playlist:'https://lightspeed.st/master'}]};},readPlaylist:async(s,url)=>({response:{url,proxyId:s.id}})});
  const response=await Promise.race([e.resolve('Light',{tmdb:27205},{hedgeDelayMs:1}),wait(250).then(()=>{throw Error('Winner incorrectly waited for uncompleted loser teardown');})]);
  assert.equal(response.proxyId,proxyId(P2));assert.equal(e.cleanups.size,1);assert.equal(f.pool.busy.has(proxyId(P1)),true);
  const closing=e.close();releaseTeardown();await closing;assert.equal(e.cleanups.size,0);assert.equal(f.pool.summary().busy,0);assert.equal(f.pool.closed,true);
 }finally{releaseTeardown?.();f.close();}
});
