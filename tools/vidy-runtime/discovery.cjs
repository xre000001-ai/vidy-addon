'use strict';
// Independent, bounded discovery; every result remains an untrusted candidate.
function create({fetchList, urls, now=Date.now, cap=6000}) {
 let pending=false, nodes=[],cursor=0; const stats={runs:0,ok:0,failed:0,lastAt:0,lastCount:0};
 function parse(text) {
  const seen=new Set(), out=[]; const rx=/\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b/g;
  for(const value of String(text).match(rx)||[]) {
   const [host,port]=value.split(':'); const oct=host.split('.').map(Number), p=Number(port);
   if(oct.some(x=>x>255)||p<20||p>65535||oct[0]===0||oct[0]===10||oct[0]===127||oct[0]>=224||oct[0]===169&&oct[1]===254||oct[0]===192&&oct[1]===168||oct[0]===172&&oct[1]>=16&&oct[1]<=31||seen.has(value))continue;
   seen.add(value);out.push(value);if(out.length>=cap)break;
  } return out;
 }
 async function tick() {
  if(pending||!urls.length)return;pending=true;stats.runs++;stats.lastAt=now();
  const url=urls[cursor++%urls.length];
  try { const list=parse(await fetchList(url)); if(list.length){nodes=list;stats.ok++;stats.lastCount=list.length;}else stats.failed++; }
  catch(_){stats.failed++;}finally{pending=false;}
 }
 return {tick,candidates:()=>nodes,stats:()=>({...stats,pending})};
}
module.exports={create};
