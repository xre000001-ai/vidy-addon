'use strict';
// A bounded FIFO semaphore: timeout removes waiters, and release hands a slot
// directly to the next waiter so new arrivals cannot starve the queue.
function create({limit=4,maxQueue=24,waitMs=2500}={}){
 let active=0,expired=0,rejected=0,taskTimeout=0;const queue=[];
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
 async function run(fn,ms,taskMs){
  if(!await acquire(ms))throw new Error('mlbd-queue-timeout');
  const controller=new AbortController();let timer;
  try {
   const work=Promise.resolve().then(()=>fn(controller.signal));
   if(!taskMs)return await work;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{taskTimeout++;controller.abort();reject(new Error('mlbd-task-timeout'))},Math.max(1,taskMs))});
   return await Promise.race([work,timeout]);
  } finally {clearTimeout(timer);release()}
 }
 return {run,stats:()=>({active,queued:queue.length,expired,rejected,taskTimeout,limit})};
}
module.exports={create};
