'use strict';
// First success wins; failure starts one alternate promptly, or hedge if first hangs.
// Both failures are returned only after both attempts finish.
function run(first, second, delay=4300) {
 return new Promise(resolve=>{
  let settled=false,started=false,completed=0,last, timer;
  const finish=r=>{
   if(settled)return;
   if(r && r.ok){settled=true;clearTimeout(timer);resolve(r);return;}
   completed++;last=r;
   if(!started)startSecond();
   if(completed===2){settled=true;clearTimeout(timer);resolve(last);}
  };
  const invoke=fn=>Promise.resolve().then(fn).then(finish,e=>finish({err:e}));
  const startSecond=()=>{if(started||settled)return;started=true;clearTimeout(timer);invoke(second);};
  timer=setTimeout(startSecond,Math.max(0,delay));
  invoke(first);
 });
}
module.exports={run};
