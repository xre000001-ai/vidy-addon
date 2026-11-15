'use strict';
// Labels are tied to the provider's own nested server page, not merely R2:
// an R2 URL alone is not enough to assert MP4 or the server's identity.
function classify(body,url){
 const s=String(body||''); let host='';try{host=new URL(url).hostname.toLowerCase()}catch(_){return 'FSL'}
 if(/(?:^|\.)r2\.cloudflarestorage\.com$/.test(host) && /Download\s+MP4\s*(?:—|–|-)\s*Fast\s+Cloud/i.test(s))return 'MP4 Fast Cloud';
 return 'FSL';
}
function filename(name,kind){
 const s=String(name||'movielinkbd.mkv');return kind==='MP4 Fast Cloud'?s.replace(/\.(?:mkv|avi|webm|mp4)$/i,'')+'.mp4':s;
}
module.exports={classify,filename};
