'use strict';const assert=require('assert');const {create,markUnique}=require('./playback_resolution_cache');
(async()=>{
 const seen=new Set();assert(markUnique(seen,'https://one.workers.dev/one/My'));assert(markUnique(seen,'https://one.workers.dev/two/My'));assert(!markUnique(seen,'https://one.workers.dev/one/My'));
 let now=1700000000000,calls=0;const c=create({ttlMs:300000,now:()=>now});
 const f=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {ok:true,direct:'https://cdn.example/v?exp=1700000120',q:720}};
 const [a,b]=await Promise.all([c.get('a',f),c.get('a',f)]);assert.equal(calls,1);assert.equal(a.q,720);assert.equal(b.q,720);await c.get('a',f);assert.equal(calls,1);
 now+=91000;await c.get('a',f);assert.equal(calls,2,'expires 30 seconds before token expiry');
 let failures=0;await c.get('bad',async()=>{failures++;return null});await c.get('bad',async()=>{failures++;return null});assert.equal(failures,2);
 console.log('playback resolution cache coalescing, expiry and failed-result safety passed');
})().catch(e=>{console.error(e);process.exit(1)});
