'use strict';
function merge(groups,accept=()=>true,cap=20000){
 const out=[],seen=new Set();let more=true;
 for(let i=0;more&&out.length<cap;i++){
  more=false;for(const g of groups){if(i>=g.length)continue;more=true;const p=g[i];if(!p||seen.has(p))continue;seen.add(p);if(accept(p))out.push(p);if(out.length>=cap)break;}
 }return out;
}
module.exports={merge};
