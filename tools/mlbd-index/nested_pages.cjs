'use strict';
// Prefer the site's explicitly identified MP4 and FSL pages over unrelated
// nested file links, preserving the bounded legacy fallback for older pages.
function choose(html){
 const entries=[];for(const m of String(html||'').matchAll(/<a\b[^>]*>/ig)){
  const tag=m[0],h=(/\bhref\s*=\s*["']?(\/file\/[A-Za-z0-9_-]{16,})["']?/i.exec(tag)||/\bhref\s*=\s*["']?(\/file\/[A-Za-z0-9_-]{6,})["']?/i.exec(tag)),k=/\bdata-host\s*=\s*["']([^"']+)["']/i.exec(tag);
  if(h&&!entries.some(x=>x.p===h[1]))entries.push({p:h[1],kind:(k&&k[1]||'').toLowerCase()});
 }
 const chosen=[];for(const kind of ['mp4-entry','fsl']){const e=entries.find(x=>x.kind===kind);if(e&&!chosen.includes(e.p))chosen.push(e.p)}
 for(const e of entries){if(chosen.length>=2)break;if(!chosen.includes(e.p))chosen.push(e.p)}
 return chosen.slice(0,2);
}
module.exports={choose};
