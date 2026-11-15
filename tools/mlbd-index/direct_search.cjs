'use strict';
// Uses only the site's public suggestion snapshot as a fallback, never builds
// or persists our own catalogue. Every returned path is revalidated by caller.
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function key(q){const words=norm(q).split(' ').filter(Boolean);for(let i=words.length-1;i>=0;i--)if(words[i].length>=2)return words[i].slice(0,2);return '';}
function rowsToItems(rows,query){
 const words=norm(query).split(' ').filter(Boolean);if(!words.length||!Array.isArray(rows))return [];
 const out=[],seen=new Set();
 for(const x of rows.slice(0,240)){
  if(!Array.isArray(x)||x.length<6||typeof x[0]!=='string'||typeof x[1]!=='string'||typeof x[3]!=='string')continue;
  const typ=x[3].toLowerCase(), slug=x[1];if(!/^(movie|series|drama|anime)$/.test(typ)||!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(slug))continue;
  const title=String(x[0]).slice(0,400),t=norm(title);if(!words.every(w=>t.includes(w)))continue;
  const path='/'+typ+'/'+slug;if(seen.has(path))continue;seen.add(path);
  const y=String(x[4]||'');out.push({path,title:title.replace(/\([^)]*\)/g,' ').trim(),year:/^(?:19|20)\d{2}$/.test(y)?y:'',type:typ==='movie'?'movie':'series'});
 }
 return out;
}
async function search(base,q,get,ms){
 const k=key(q);if(!k)return [];
 const start=Date.now(), budget=Math.max(1200,Math.min(ms||4000,4500));
 try{
  const m=await get(base+'/search-suggest/manifest',{ms:Math.min(2000,budget)});if(m.st!==200||!m.body||m.body.length>10000)return [];
  const manifest=JSON.parse(m.body);if(Number(manifest.ready)!==1||manifest.schema!=='77.90.62'||!/^[a-zA-Z0-9._-]{1,80}$/.test(String(manifest.v||'')))return [];
  const left=budget-(Date.now()-start);if(left<700)return [];
  const r=await get(base+'/search-suggest/'+encodeURIComponent(manifest.v)+'/'+k,{ms:left});if(r.st!==200||!r.body||r.body.length>1500000)return [];
  return rowsToItems(JSON.parse(r.body),q);
 }catch(_){return [];}
}
module.exports={key,rowsToItems,search};
