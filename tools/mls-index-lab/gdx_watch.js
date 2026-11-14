'use strict';
// Resolve public, stable GDxFiles page references; signed media URLs are never indexed.
function safePage(raw, base){
 try { const u=new URL(raw,base); if(u.protocol!=='https:' || u.hostname!=='gdxfiles.com' || !/^\/file\/[A-Za-z0-9]+(?:\/watch)?$/.test(u.pathname)) return ''; return u.href; }catch(_){return ''}
}
function watchPage(body,base){
 for(const m of String(body||'').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
  const u=safePage(m[1].replace(/&amp;/g,'&'),base); if(u && /\/watch(?:\?|$)/.test(u))return u;
 }
 return '';
}
function video(body){
 const m=/\b(?:const|let|var)\s+(?:videoUrl|SRC)\s*=\s*("(?:\\.|[^"\\])*")/.exec(String(body||''));
 if(!m)return '';try {const u=new URL(JSON.parse(m[1]));if(u.protocol!=='https:' || !/^[a-z0-9]+\.r2\.cloudflarestorage\.com$/i.test(u.hostname))return '';return u.href}catch(_){return ''}
}
async function resolve(link,get,ms){
 const page=safePage(link);if(!page)return null;
 const a=await get(page,{ms:Math.min(ms||6000,4000)});const watch=watchPage(a&&a.body,(a&&a.url)||page);if(!watch)return null;
 const b=await get(watch,{ms:Math.min(ms||6000,4000),referer:page});const direct=video(b&&b.body);if(!direct)return null;
 let filename='';try{filename=decodeURIComponent(new URL(direct).pathname.split('/').pop()||'')}catch(_){}
 const q=(/\b(2160|1080|720|480)p\b/i.exec(filename)||[])[1] || (/\b4k\b/i.test(filename)?'2160':'0');
 const ep=/\bS0*(\d{1,2})E0*(\d{1,4})(?!\d)(?:[-–]E?0*(\d{1,4}))?/i.exec(filename);
 return {ok:true,direct,srv:'gdx·watch',size:0,ct:'',unverified:true,q:Number(q),season:ep?Number(ep[1]):0,episode:ep?Number(ep[2]):0,episode_end:ep?Number(ep[3]||ep[2]):0,filename};
}
module.exports={safePage,watchPage,video,resolve};
