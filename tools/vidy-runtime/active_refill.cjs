'use strict';
// Bounded single-flight replenishment. Candidate discovery and validation are
// supplied by the caller so the scheduler cannot bypass source-specific rules.
function create({ready,candidates,validate,now=Date.now,target=48,parallel=6,busyParallel=3,isBusy=()=>false,cooldown=600000,limit=64}){
 let running=false;const seen=new Map();const stats={runs:0,attempts:0,passed:0,failed:0,skippedBusy:0,lastReady:0,lastAt:0};
 async function tick(){
  if(running){stats.skippedBusy++;return;}running=true;
  try{
   stats.runs++;stats.lastAt=now();stats.lastReady=ready();if(stats.lastReady>=target)return;
   const t=now(),n=isBusy()?busyParallel:parallel;
   const todo=[...new Set(candidates())].filter(p=>p && (!seen.has(p) || t-seen.get(p)>=cooldown)).slice(0,Math.max(1,n));
   for(const px of todo)seen.set(px,t);
   while(seen.size>limit*100)seen.delete(seen.keys().next().value);
   await Promise.all(todo.map(async px=>{stats.attempts++;try{if(await validate(px))stats.passed++;else stats.failed++;}catch(_){stats.failed++;}}));
  }finally{running=false;}
 }
 return {tick,stats:()=>({...stats,running})};
}
module.exports={create};
