'use strict';
// Downstream mirror selection only. Does not change main-site or sticky sessions.
// One recently successful host-specific proxy, plus one rotating candidate.
function proxyKey(p){
 const v=String(p||'').trim();if(!v)return '';
 // Plain ip:port and explicit HTTP describe the same transport; retain SOCKS.
 return v.replace(/^http:\/\//i,'').toLowerCase();
}
function select({ranked=[],extra=[],entries,now=Date.now(),turn=0,count=2}={}) {
 const all=[],seen=new Set(),records=new Map();
 if(entries)for(const [px,e] of entries) {const k=proxyKey(px), old=records.get(k);if(!old)records.set(k,{...e});else {old.ban=Math.max(old.ban||0,e.ban||0);old.lastOk=Math.max(old.lastOk||0,e.lastOk||0);old.cons=Math.max(old.cons||0,e.cons||0)}}
 for(const px of [...ranked,...extra]) {
  const k=proxyKey(px),record=records.get(k);
  if(!k || seen.has(k) || (record && record.ban>now))continue;
  seen.add(k);all.push({px,record});
 }
 if(!all.length || count<1)return [];
 const proven=all.filter(x=>x.record && x.record.lastOk && now-x.record.lastOk<20*60e3 && !x.record.cons);
 const chosen=[]; if(proven.length)chosen.push(proven[0].px);
 const rest=all.filter(x=>!chosen.includes(x.px));
 if(rest.length){const offset=((Number(turn)||0)%rest.length+rest.length)%rest.length;
  for(let i=0;i<rest.length && chosen.length<count;i++)chosen.push(rest[(offset+i)%rest.length].px);
 }
 return chosen;
}
module.exports={select,proxyKey};
