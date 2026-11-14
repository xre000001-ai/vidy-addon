'use strict';
// Public metadata only: never store playback URLs or stream-card responses.
const {find}=require('./lookup');
const repo='xre000001-ai/vidy-addon';
let current=null,inflight=null,lastAttempt=0;
async function load(){
 const shaRes=await fetch('https://api.github.com/repos/'+repo+'/commits/mls-index-sandbox-data',{headers:{'User-Agent':'Vidy-MLSBD-Index','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(7000)});
 if(!shaRes.ok)throw Error('index reference unavailable');
 const sha=(await shaRes.json()).sha;if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('invalid index revision');
 const base='https://raw.githubusercontent.com/'+repo+'/'+sha+'/data/';
 const get=async file=>{const r=await fetch(base+file,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('index shard unavailable');return r.json()};
 const manifest=await get('manifest.json');
 if(manifest.schema!==1||!Number.isInteger(manifest.posts)||manifest.posts<100||!Array.isArray(manifest.shards)||manifest.shards.length!==16)throw Error('invalid index manifest');
 const shards=await Promise.all(manifest.shards.map((x,i)=>{if(x.file!=='s'+String(i).padStart(2,'0')+'.json')throw Error('invalid shard name');return get(x.file)}));
 if(shards.some(a=>!Array.isArray(a))||shards.reduce((n,a)=>n+a.length,0)!==manifest.posts)throw Error('incomplete index');
 // Optional mirror metadata, pinned to the same immutable revision.
 const mirrorData=await get('mirrors.json').catch(()=>({}));
 const mirrors=mirrorData && typeof mirrorData==='object' && !Array.isArray(mirrorData) ? mirrorData : {};
 const rows=shards.flat();if(rows.some(r=>!r||!Number.isSafeInteger(r.id)||typeof r.title!=='string'||!Array.isArray(r.sav)))throw Error('invalid indexed post');
 current={rows,mirrors,sha,at:Date.now()};return current;
}
function start(){
 if(inflight || Date.now()-lastAttempt<(current?120000:15000) || (current && Date.now()-current.at<1800000))return inflight;
 lastAttempt=Date.now();inflight=load().catch(()=>null).finally(()=>{inflight=null});return inflight;
}
async function candidates(names,year,type,season,episode,waitMs=1000){
 const p=start();
 if(!current && p)await Promise.race([p,new Promise(r=>setTimeout(r,Math.max(0,Math.min(1500,waitMs))))]);
 if(!current)return [];
 const byId=new Map();
 for(const name of names||[]){
  for(const r of find(current.rows,{name,year,type,season:Number(season||1),episode:Number(episode||1)}))byId.set(r.id,r);
 }
 return [...byId.values()].sort((a,b)=>b.id-a.id).slice(0,12).map(r=>({id:r.id,title:r.title,link:r.url,html:'',date:'',_sav:r.sav.filter(s=>!s.page || s.page==='https://savelinks.me/view/'+s.id || s.page==='https://joya9links.com/view/'+s.id).map(s=>({id:(String(s.page||'').startsWith('https://joya9links.com/view/')?'joya9links.com/':'')+s.id,q:Number(s.q)||0,ep:Number(s.ep)||0,ep_end:Number(s.ep_end)||0}))})).filter(p=>p._sav.length);
}
function mirror(id){
 const entry=current && current.mirrors && current.mirrors[id];
 if(!entry || !Array.isArray(entry.pages) || !Number.isFinite(entry.checked) || (Date.now()/1000-entry.checked)>7*86400 || entry.checked>Date.now()/1000+300)return null;
 const out={gd:[],mcl:[],gdx:[],hosts:[]};
 for(const raw of entry.pages){try{const u=new URL(raw);const h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.search||u.hash)continue;
  if(h==='gdxfiles.com' && /^\/file\/[a-z0-9]+\/?$/i.test(u.pathname))out.gdx.push(u.href);
  else if(/(^|\.)(gdflix|ddflix|gdlink)\.[a-z.]+$/i.test(h)&&/^\/file\/[a-z0-9]+\/?$/i.test(u.pathname))out.gd.push(u.href);
  else if(/(^|\.)(multicloudlinks|multidownload|fsldownload)\.[a-z.]+$/i.test(h)&&/^\/view\/[a-z0-9]+\/?$/i.test(u.pathname))out.mcl.push(u.href);
 }catch(_){}}
 if(!(out.gd.length||out.gdx.length||out.mcl.length))return null;
 out.hosts=[...new Set([...out.gd,...out.gdx,...out.mcl].map(u=>new URL(u).hostname))];return out;
}
function stats(){return {posts:current?current.rows.length:0,mirrors:current?Object.keys(current.mirrors||{}).length:0,revision:current?current.sha.slice(0,12):'',ageSeconds:current?Math.round((Date.now()-current.at)/1000):null,loading:!!inflight};}
module.exports={candidates,start,stats,mirror};
