'use strict';
function merge(groups,accept=()=>true,cap=20000){
 const out=[],seen=new Set();let more=true;
 // A deep group of dead nodes must not bury a shallow group of live ones.
 // Round-robin used to walk group #1 to exhaustion whenever it was the only
 // long list, so the newest source was effectively never tried.
 const stride=Math.max(1,Number(process.env.VYFCSTRIDE||8));
 for(let i=0;more&&out.length<cap;i++){
  if(i&&(i%stride)===0){let tail=false;for(const g of groups)if(i<g.length){tail=true;break;}if(!tail)break;}
  more=false;for(const g of groups){if(i>=g.length)continue;more=true;const p=g[i];if(!p||seen.has(p))continue;seen.add(p);if(accept(p))out.push(p);if(out.length>=cap)break;}
 }return out;
}
module.exports={merge};
