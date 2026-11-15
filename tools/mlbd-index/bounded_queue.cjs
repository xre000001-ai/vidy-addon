'use strict';
// A bounded FIFO semaphore: timeout removes waiters, and release hands a slot
// directly to the next waiter so new arrivals cannot starve the queue.
function create({limit=4,maxQueue=24,waitMs=2500}={}){
 let active=0,expired=0,rejected=0;const queue=[];
 function acquire(ms){
  if(active<limit){active++;return Promise.resolve(true)}
  if(queue.length>=maxQueue){rejected++;return Promise.resolve(false)}
  return new Promise(resolve=>{
   const item={resolve,timer:null};item.timer=setTimeout(()=>{const i=queue.indexOf(item);if(i>=0){queue.splice(i,1);expired++;resolve(false)}},Math.max(1,Math.min(waitMs,ms||waitMs)));queue.push(item);
  });
 }
 function release(){
  const next=queue.shift();if(next){clearTimeout(next.timer);next.resolve(true)}else active=Math.max(0,active-1);
 }
 async function run(fn,ms){if(!await acquire(ms))throw new Error('mlbd-queue-timeout');try{return await fn()}finally{release()}}
 return {run,stats:()=>({active,queued:queue.length,expired,rejected,limit})};
}
module.exports={create};
