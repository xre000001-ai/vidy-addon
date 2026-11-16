'use strict';
// Bounded single-flight replenishment. Candidate discovery and validation are
// supplied by the caller so the scheduler cannot bypass source-specific rules.
function create({ready,candidates,validate,now=Date.now,target=48,parallel=6,busyParallel=3,isBusy=()=>false,getParallel=null,cooldown=600000,limit=64}){
 let running=false;const seen=new Map();const stats={errors:0,runs:0,attempts:0,passed:0,failed:0,deferred:0,skippedBusy:0,lastReady:0,lastAt:0};
 async function tick(){
  if(running){stats.skippedBusy++;return;}running=true;
  try{
   stats.runs++;stats.lastAt=now();stats.lastReady=ready();if(stats.lastReady>=target)return;
   const t=now(),n=getParallel ? Math.max(1,Math.min(parallel,Math.floor(Number(getParallel()) || 1))) : (isBusy()?busyParallel:parallel);
   const todo=[...new Set(candidates())].filter(p=>p && (!seen.has(p) || t-seen.get(p)>=cooldown)).slice(0,Math.max(1,n));
   for(const px of todo)seen.set(px,t);
   while(seen.size>limit*100)seen.delete(seen.keys().next().value);
   await Promise.all(todo.map(async px=>{stats.attempts++;try{const result=await validate(px);if(result===null){seen.delete(px);stats.deferred++;}else if(result)stats.passed++;else stats.failed++;}catch(_){stats.failed++;}}));
  }catch(_){stats.errors=(stats.errors||0)+1;}
  finally{running=false;}
 }
 return {tick,stats:()=>({...stats,running})};
}
module.exports={create};
