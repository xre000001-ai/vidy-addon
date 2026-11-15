'use strict';
const assert=require('assert'),{create}=require('./bounded_queue.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const q=create({limit:2,maxQueue:3,waitMs:40});let active=0,peak=0;
 const hold=()=>q.run(async()=>{active++;peak=Math.max(peak,active);await delay(75);active--;return 'done'});
 const p1=hold(),p2=hold();await delay(2);const waiting=Array.from({length:4},()=>q.run(async()=>{throw Error('should not run')}).then(()=>false,e=>e.message==='mlbd-queue-timeout'));
 assert((await Promise.all(waiting)).every(Boolean));await Promise.all([p1,p2]);assert.equal(peak,2);assert.equal(q.stats().active,0);assert.equal(q.stats().queued,0);assert.equal(q.stats().expired,3);assert.equal(q.stats().rejected,1);
 const q2=create({limit:1,maxQueue:3,waitMs:200});const order=[];const f=(id,ms)=>q2.run(async()=>{order.push(id);await delay(ms)});await Promise.all([f(1,20),f(2,10),f(3,1)]);assert.deepEqual(order,[1,2,3]);assert.equal(q2.stats().active,0);
 const q3=create({limit:1});await q3.run(async()=>{throw Error('oops')}).catch(()=>{});assert.equal(q3.stats().active,0);
 console.log('MovieLinkBD queue bounded, FIFO, expiration, overflow and error release passed');
})().catch(e=>{console.error(e);process.exitCode=1});
