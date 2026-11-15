'use strict';
// Return a partial MLSBD result after parallel workers have had a minimum
// collection window and no new cards arrive for a short quiet period. Never
// treat an empty result as ready early: allow it the entire source budget.
function create({snapshot,started=Date.now(),minMs=5000,maxMs=7600,quietMs=1000,pollMs=100}) {
 let timer,resolve,done=false;
 const promise=new Promise(r=>{resolve=r;});
 const tick=()=>{
  if(done)return;
  const now=Date.now(),s=snapshot();
  if(now-started>=maxMs || (now-started>=minMs && s.count>0 && now-s.lastCard>=quietMs)){
   done=true;clearInterval(timer);resolve();
  }
 };
 timer=setInterval(tick,pollMs);tick();
 return {promise,cancel:()=>{done=true;clearInterval(timer);}};
}
module.exports={create};
