'use strict';
// A depleted request can wait briefly for an in-flight bench refill; it never
// ignores health, quota, group capacity, or the foreground deadline.
async function pick(group,srv,excluded,usable,deadline,clock=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))){
 for (;;) {
  if(group.refresh)group.refresh();
  const px=group.pick(srv,excluded,usable);if(px)return px;
  const left=deadline-clock();if(left<=0)return undefined;
  await wait(Math.min(200,left));
 }
}
module.exports={pick};
