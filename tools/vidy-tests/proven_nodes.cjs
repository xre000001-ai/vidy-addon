'use strict';
// Preserve server-specific playlist proofs while spreading the shared fallback
// across servers, so concurrent races do not all reserve the same nodes.
function preferred(server,local=[],shared=[],limit=3){
 const uniq=a=>[...new Set(a.filter(Boolean))], own=uniq(local), all=uniq(shared).filter(x=>!own.includes(x));
 const order=['miami','boise','atlanta','munich','chicago'];let index=order.indexOf(String(server));if(index<0)index=[...String(server)].reduce((n,c)=>n+c.charCodeAt(0),0);
 const start=all.length?(index*3)%all.length:0;const rotated=all.slice(start).concat(all.slice(0,start));
 return uniq(own.slice(0,Math.min(2,limit)).concat(rotated,own)).slice(0,limit);
}
module.exports={preferred};
