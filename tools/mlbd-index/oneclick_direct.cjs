'use strict';
// Only links exposed by the website's explicit One Click button are accepted.
function attr(tag,n){const m=new RegExp('\\b'+n+'\\s*=\\s*["\']([^"\']*)["\']','i').exec(tag);return m?m[1].replace(/&amp;/g,'&'):''}
function path(html){for(const m of String(html).matchAll(/<a\b[^>]*>/ig)){const t=m[0];if(attr(t,'data-host')!=='oneclick')continue;const h=attr(t,'href');if(/^\/file\/[A-Za-z0-9_-]{40,}$/.test(h))return h}return ''}
function stem(s){return String(s||'').replace(/^MovieLinkBD\.com\s*[-–]\s*/i,'').replace(/&amp;/g,'&').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function media(html,rootName){
 const title=(/<title[^>]*>([^<]+)/i.exec(String(html))||[])[1]||'';if(!stem(rootName)||stem(title)!==stem(rootName))return [];
 const out=[];for(const m of String(html).matchAll(/<a\b[^>]*>/ig)){
  const tag=m[0],kind=attr(tag,'data-host'),href=attr(tag,'href');if(kind!=='instant'&&kind!=='ultra')continue;
  try{const u=new URL(href);if(u.protocol!=='https:'||u.username||u.password||u.port)continue;
   if(kind==='instant'&&!/^[a-z0-9]+\.r2\.cloudflarestorage\.com$/i.test(u.hostname))continue;
   if(kind==='ultra'&&!/^pub-[a-f0-9]{32}\.r2\.dev$/i.test(u.hostname))continue;
   if(!/^\/(?:movielinkbd\/)?media\/[a-z0-9]+\/main$/i.test(u.pathname))continue;
   out.push({u:u.href,s:kind==='instant'?'One Click Fast Cloud':'One Click Ultra'});
  }catch(_){}
 }return out;
}
module.exports={path,media};
