'use strict';
// Collect completed token resolutions; once a usable result exists, wait a
// quiet window for siblings, but never extend the caller's source deadline.
function collect(jobs,{started=Date.now(),maxMs=10000,minMs=7000,quietMs=900,pollMs=80}={}){
 return new Promise(resolve=>{
  const out=[];let remaining=jobs.length,last=started,finished=false,timer;
  function done(){if(finished)return;finished=true;clearInterval(timer);resolve({results:out.slice(),partial:remaining>0});}
  function tick(){const now=Date.now();if(!remaining||now-started>=maxMs||(out.length&&now-started>=minMs&&now-last>=quietMs))done();}
  if(!remaining)return done();
  timer=setInterval(tick,pollMs);
  for(const job of jobs)Promise.resolve(job).then(r=>{if(finished)return;if(r){out.push(r);last=Date.now();}}).catch(()=>{}).finally(()=>{if(!finished){remaining--;tick();}});
  tick();
 });
}
module.exports={collect};
