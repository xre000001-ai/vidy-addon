'use strict';
// Season-only media has unknown episode coverage; never present it as an individual episode.
function seasonFile(title, season) {
 const t=String(title||'');
 const s=/\bS0*(\d{1,2})(?!\d)(?!\s*E\s*\d)/i.exec(t);
 if(!s || +s[1]!==Number(season) || /\bS\d{1,2}\s*E\s*\d/i.test(t))return null;
 if(!/\.(?:mkv|mp4)\b/i.test(t))return null;
 const q=/(2160|1080|720|480)p\b/i.exec(t);const quality=q?+q[1]:(/\b4k\b/i.test(t)?2160:0);
 return [720,1080,2160].includes(quality)?{season:+s[1],quality,title:t}:null;
}
module.exports={seasonFile};
