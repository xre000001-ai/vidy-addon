'use strict';
// Independent and bounded; remote lists provide candidates, never proof of health.
function create({fetchList, urls, now=Date.now, cap=6000, maxAge=600000}) {
 let pending=false,cursor=0;const lists=new Map();const stats={runs:0,ok:0,failed:0,lastAt:0,lastCount:0};
 function parse(text) {
  const seen=new Set(),out=[];const rx=/\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b/g;
  for(const value of String(text).match(rx)||[]) {
   const [host,port]=value.split(':'), oct=host.split('.').map(Number),p=Number(port);
   if(oct.some(x=>x>255)||p<20||p>65535||oct[0]===0||oct[0]===10||oct[0]===127||oct[0]>=224||oct[0]===169&&oct[1]===254||oct[0]===192&&oct[1]===168||oct[0]===172&&oct[1]>=16&&oct[1]<=31||seen.has(value))continue;
   seen.add(value);out.push(value);if(out.length>=cap)break;
  }return out;
 }
 async function tick() {
  if(pending||!urls.length)return;pending=true;stats.runs++;stats.lastAt=now();const url=urls[cursor++%urls.length];
  try {const list=parse(await fetchList(url));if(list.length){lists.set(url,{list,ts:now()});stats.ok++;stats.lastCount=list.length;}else stats.failed++;}
  catch(_){stats.failed++;}finally{pending=false;}
 }
 function candidates(){
  const groups=urls.map(u=>lists.get(u)).filter(e=>e&&now()-e.ts<maxAge).map(e=>e.list), out=[], seen=new Set();
  // Interleave lists, so a large slow source cannot starve a smaller fresh one.
  for(let i=0;groups.length&&out.length<cap;i++){
   let more=false;for(const g of groups)if(i<g.length){more=true;const p=g[i];if(!seen.has(p)){seen.add(p);out.push(p);if(out.length>=cap)break;}}
   if(!more)break;
  }return out;
 }
 return {tick,candidates,stats:()=>({...stats,pending,sources:lists.size,available:candidates().length})};
}
module.exports={create};
