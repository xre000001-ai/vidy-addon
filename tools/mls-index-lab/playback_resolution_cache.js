'use strict';
// Temporary resolver/token cache, never a stream-card cache. Failures are not cached.
function create({ttlMs=300000,max=250,now=()=>Date.now()}={}) {
 const entries=new Map(),flight=new Map();
 function expiry(result,at){
  let until=at+ttlMs;
  try {
   const u=new URL(result.direct);
   for(const k of ['exp','expires','expiry']){
    const x=Number(u.searchParams.get(k));if(x>1e9){const ms=x>1e12?x:x*1000;until=Math.min(until,ms-30000);}
   }
   const amz=u.searchParams.get('X-Amz-Date'),secs=Number(u.searchParams.get('X-Amz-Expires'));
   if(amz && secs>0 && /^\d{8}T\d{6}Z$/.test(amz)){
    const d=Date.UTC(+amz.slice(0,4),+amz.slice(4,6)-1,+amz.slice(6,8),+amz.slice(9,11),+amz.slice(11,13),+amz.slice(13,15));until=Math.min(until,d+secs*1000-30000);
   }
  }catch(_) {return 0}
  return until;
 }
 async function get(key,resolve){
  const hit=entries.get(key),t=now();if(hit && t<hit.until)return {...hit.result};if(hit)entries.delete(key);
  if(flight.has(key))return flight.get(key);
  const p=Promise.resolve().then(resolve).then(r=>{if(r&&r.ok===true&&typeof r.direct==='string'&&/^https:\/\//i.test(r.direct)){
   const until=expiry(r,now());if(until>now()){if(entries.size>=max)entries.delete(entries.keys().next().value);entries.set(key,{until,result:{...r}});}}
   return r;
  }).finally(()=>flight.delete(key));flight.set(key,p);return p;
 }
 return {get,stats:()=>({entries:entries.size,inflight:flight.size})};
}
function markUnique(seen,url){if(!url || seen.has(url))return false;seen.add(url);return true;}
module.exports={create,markUnique};
