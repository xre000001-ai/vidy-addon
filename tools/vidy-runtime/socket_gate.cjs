'use strict';
// One queued connect is cancelled when its socket closes; never reconnect a
// timed-out/destroyed socket and never count a closed socket as live.
function schedule({socket,allowed,open,drop,onQueue,onDequeue,maxWait=6000,step=20}){
 let queued=false,finished=false,timer=null,start=Date.now();
 function cleanup(){if(timer)clearTimeout(timer);timer=null;socket.removeListener('close',cancel);if(queued){queued=false;socket.__sockGateQueued=false;onDequeue();}}
 function cancel(){if(finished)return;finished=true;cleanup();}
 function attempt(){
  if(finished)return;
  if(socket.destroyed){cancel();return;}
  if(allowed()){finished=true;cleanup();return open();}
  if(Date.now()-start>=maxWait){finished=true;cleanup();return drop();}
  if(!queued){queued=true;socket.__sockGateQueued=true;onQueue();socket.once('close',cancel);}
  timer=setTimeout(attempt,step);timer.unref?.();
 }
 attempt();return socket;
}
module.exports={schedule};
