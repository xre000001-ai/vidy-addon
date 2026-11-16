'use strict';
// Website's xcloud branch is only followed through explicit host/path allowlists.
// Generated media URLs stay in memory and must pass a real byte-range check.
function attr(tag,name){const m=new RegExp('\\b'+name+'\\s*=\\s*["\']([^"\']*)["\']','i').exec(tag);return m?m[1].replace(/&amp;/g,'&'):''}
function goInfo(html,base){
 const k=/\bvar\s+K\s*=\s*["']([a-f0-9]{8,64})["']/i.exec(html);if(!k)return null;
 for(const m of String(html).matchAll(/<a\b[^>]*>/ig)){
  const tag=m[0];if(attr(tag,'data-host').toLowerCase()!=='xcloud')continue;
  const enc=attr(tag,'data-g');if(!/^[A-Za-z0-9_-]{10,2048}$/.test(enc))continue;
  try{const data=Buffer.from(enc.replace(/-/g,'+').replace(/_/g,'/'),'base64'),key=k[1];const s=Buffer.from(data.map((x,i)=>x^key.charCodeAt(i%key.length))).toString('utf8');
   if(!/^\/go\/[A-Za-z0-9_-]+(?:\?[A-Za-z0-9_=&%-]+)?$/.test(s))continue;
   const u=new URL(s,base),b=new URL(base);if(u.origin!==b.origin || !/(^|\.)movielinkbd\.(?:com|at|app|cc)$/i.test(u.hostname))continue;
   return {url:u.href,key};
  }catch(_){}
 }
 return null;
}
function landing(loc){try{const u=new URL(loc);if(u.protocol!=='https:'||!/^mlbd\.xcloud\.asia$/i.test(u.hostname)||!/^\/[a-z0-9]{8,40}\/?$/i.test(u.pathname))return '';return 'https://xcloud.tattoo'+u.pathname}catch(_){return ''}}
function anchors(html){return [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/ig)].map(m=>({href:attr(m[0],'href'),text:m[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}))}
function movieIdentity(name){return String(name||'').trim().replace(/^MovieLinkBD\.com\s*[-–]\s*/i,'').split(/\b(?:19|20)\d{2}\b/)[0].toLowerCase().replace(/[^a-z0-9]+/g,'')}
async function resolve({html,base,name,quality,cookie,get,probe,trace}){
 const fail=reason=>{if(typeof trace==='function')trace(reason);return null};
 try{
  const info=goInfo(html,base);if(!info)return fail('go-decode');
  const g2=/^mlbd_g2=[a-f0-9]{8,64}$/i.test(String(cookie||''))?'; '+cookie:'';
  const r=await get(info.url,{noRedirect:true,cookie:'mlbd_gk='+info.key+g2});const land=landing(r&&r.location);if(!land)return fail('go-redirect');
  const pg=await get(land,{});if(!pg || pg.st!==200)return fail('landing-http');
  const title=(/<title[^>]*>([^<]+)/i.exec(pg.body||'')||[])[1]||'';
  const stem=movieIdentity(name);if(stem.length<4 || movieIdentity(title)!==stem)return fail('identity');
  const ny=(/\b(?:19|20)\d{2}\b/.exec(String(name||''))||[])[0],ty=(/\b(?:19|20)\d{2}\b/.exec(title)||[])[0];if(ny && (!ty||ny!==ty))return fail('year');
  const qa=+((/(2160|1080|720)p/i.exec(title)||[])[1]||0);if(!qa || qa!==Number(quality))return fail('quality');
  const gen=anchors(pg.body).find(x=>/generate direct download link/i.test(x.text));if(!gen)return fail('generate-missing');
  const gu=new URL(gen.href,land);if(gu.protocol!=='https:'||!/^xcloud1\.lol$/i.test(gu.hostname)||!/^\/[A-Za-z0-9_-]{8,40}\/?$/i.test(gu.pathname))return fail('generate-url');
  const generated='https://xcloud.tattoo'+gu.pathname+gu.search;const g=await get(generated,{referer:land});if(!g||g.st!==200 || movieIdentity((/<title[^>]*>([^<]+)/i.exec(g.body||'')||[])[1]||'')!==stem)return fail('generate-page');
  const cloud=anchors(g.body).find(x=>/download\s*\[cloud\]/i.test(x.text));if(!cloud)return fail('cloud-missing');
  const cu=new URL(cloud.href,generated);if(cu.protocol!=='https:'||cu.hostname!=='xcloud.tattoo'||!/^\/apis\/cloud\//.test(cu.pathname))return fail('cloud-url');
  const red=await get(cu.href,{noRedirect:true,referer:generated});const u=new URL(red&&red.location||'');if(u.protocol!=='https:'||!/^[a-z0-9]+\.r2\.cloudflarestorage\.com$/i.test(u.hostname))return fail('media-host');
  const ok=await probe(u.href);if(!ok)return fail('range');
  return {u:u.href,s:'XCloud Cloud',name:title.trim().replace(/^MovieLinkBD\.com\s*[-–]\s*/i,'').trim()};
 }catch(_){return fail('network-or-queue')}
}
module.exports={goInfo,landing,movieIdentity,resolve};
