'use strict';
function canonicalMirror(candidate,fallback){
 try{const u=new URL(candidate);if(u.protocol==='https:' && !u.username && !u.password && !u.port && /^(?:[a-z0-9]{4,12}\.)?movielinkbd\.(?:com|at|app|cc)$/i.test(u.hostname))return u.origin;}catch(_){}return fallback;
}
function valid(body,url){
 const s=String(body||'');if(s.length<200||/just a moment|enable javascript and cookies|_cf_chl_opt|cf-error-details|access denied/i.test(s.slice(0,5000)))return false;
 let path='';try{path=new URL(url).pathname}catch(_){return false}
 if(path==='/search-suggest/manifest'){try{const x=JSON.parse(s);return +x.ready===1&&typeof x.schema==='string'&&typeof x.v==='string'}catch(_){return false}}
 if(/^\/search-suggest\//.test(path)){try{return Array.isArray(JSON.parse(s))}catch(_){return false}}
 if(/^\/search/.test(path))return /\/(?:movie|series|drama|anime)\/[A-Za-z0-9_-]{10,}/i.test(s);
 if(/^\/(?:movie|series|drama|anime)\//.test(path))return /data-dl\s*=|data-ep\s*=/.test(s);
 if(/^\/file\//.test(path))return /dlh-htitle|\/file\/|fsldownload|hubcloud|instantcloud|mks-lukatube/i.test(s);
 return /<html|<!doctype|<title|href\s*=/i.test(s);
}
module.exports={valid,canonicalMirror};
