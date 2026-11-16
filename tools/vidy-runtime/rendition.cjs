'use strict';
function choose(sources,quality,signature,sig) {
 const q=String(quality||''); if(!q)return null;
 const matches=sources.filter(x=>x&&x.url&&String(x.quality||'')===q);
 if(signature){const exact=matches.filter(x=>sig(x.url)===signature);if(exact.length===1)return exact[0]; return null;}
 // For unsigned identities, only a single same-quality candidate is safe.
 return matches.length===1?matches[0]:null;
}
module.exports={choose};
