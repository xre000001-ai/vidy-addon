'use strict';
// Resolve only a Pixeldrain mirror linked by a MultiCloud view page. Never
// persist generated download URLs; the stable Pixeldrain file ID is derived at request time.
function findMirror(body,base) {
  const hrefs=[...String(body||'').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1].replace(/&amp;/gi,'&'));
  return hrefs.map(h=>{try{return new URL(h,base)}catch(_){return null}}).find(u=>u && u.protocol==='https:' && u.hostname.toLowerCase()==='pixeldra.multicloudlinks.com' && u.pathname==='/' && /^[A-Za-z0-9_-]{4,128}$/.test(u.searchParams.get('pid')||'')) || null;
}
// Require the actual file metadata in the winning redirect response.
function extractFile(body, effective) {
  const text=String(body||'');
  const og=(/<meta\s+[^>]*property=["']og:url["'][^>]*content=["']([^"']+)/i.exec(text)||[])[1]||'';
  let id='';
  for(const raw of [effective,og]) { try {const u=new URL(raw);const m=/^\/u\/([a-zA-Z0-9]+)\/?$/.exec(u.pathname);if(u.protocol==='https:' && u.hostname==='pixeldrain.com' && m){id=m[1];break}}catch(_){} }
  if(!id)return null;
  const match=/window\.viewer_data\s*=\s*(\{[^\n]*\})\s*;/i.exec(text);
  let obj;try{obj=match&&JSON.parse(match[1])}catch(_){}
  const file=obj && obj.type==='file' && obj.api_response;
  return file && file.id===id && /\.(mkv|mp4|m4v|avi|webm)$/i.test(file.name||'') ? {id,file} : null;
}
async function resolve(link, get, ms, report) {
  const note=x=>{try{if(report)report(x)}catch(_){}};
  try {
    const v=new URL(link);
    if(v.protocol!=='https:' || !/(^|\.)multicloudlinks\.com$/i.test(v.hostname) || !/^\/view\/[a-z0-9]+\/?$/i.test(v.pathname)) return null;
    const t=Date.now(), budget=Math.max(2500,Math.min(7000,ms||6000));
    // A valid MultiCloud HTML page can still omit the mirror. Within the
    // direct/proxy race, let a page containing the actual mirror beat a
    // faster page that has no useful Pixeldrain link.
    const page=await get(link,{ms:Math.min(4000,budget),referer:'https://savelinks.me/',accept:(body,url)=>!!findMirror(body,url||link)});
    const mirror=findMirror(page && page.body,(page && page.url)||link);
    if(!mirror){note('no-mirror-page');return null;}
    if(budget-(Date.now()-t)<300){note('budget-after-view');return null;}
    const r=await get(mirror.href,{ms:Math.max(1500,budget-(Date.now()-t)),referer:page.url||link,accept:(body,url)=>!!extractFile(body,url)});
    const extracted=extractFile(r && r.body,r && r.url);
    if(!extracted){note('no-pixeldrain-metadata');return null;}
    const {id,file}=extracted;
    const title=String(file.name), qm=/(2160|1080|720|480)p\b/i.exec(title), em=/\bS0*(\d{1,2})E0*(\d{1,4})(?!\d)(?:[-–]E?0*(\d{1,4}))?/i.exec(title);
    const q=qm?+qm[1]:(/\b4k\b/i.test(title)?2160:0);
    if(![720,1080,2160].includes(q)){note('quality-rejected');return null;}
    note('resolved-'+q);
    return {ok:true,direct:'https://pixeldrain.com/api/file/'+id,size:Number(file.size)||0,srv:'multicloud·pixeldrain',q,season:em?+em[1]:0,episode:em?+em[2]:0,episode_end:em?+(em[3]||em[2]):0,filename:title,fastWatch:true};
  } catch (_) { note('resolver-error');return null; }
}
module.exports={resolve};
