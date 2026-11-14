'use strict';
// Season media has unknown episode coverage; never imply an individual episode.
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function seasonFile(title, season, opts={}) {
 const t=String(title||'');
 if(!/\.(?:mkv|mp4)\b/i.test(t))return null;
 const q=/(2160|1080|720|480)p\b/i.exec(t),quality=q?+q[1]:(/\b4k\b/i.test(t)?2160:0);
 if(![720,1080,2160].includes(quality))return null;
 if(/\bS\d{1,2}\s*E\s*\d|\b(?:episode|ep|epi)[\s._-]*\d/i.test(t))return null;
 const s=/\bS0*(\d{1,2})(?!\d)(?!\s*E\s*\d)/i.exec(t);
 if(s)return +s[1]===Number(season)?{season:+s[1],quality,title:t,unmarked:false}:null;
 // Unmarked filenames: only season 1, single-season post, exact full title and year.
 // The file's season and episode coverage remain unverified in the label.
 if(Number(season)!==1 || !opts.name || !opts.year || /\bseason\s*\d|\bS\d{1,2}\b/i.test(t))return null;
 let base=t.replace(/^\s*GDFlix\s*\|\s*/i,'').replace(/^\s*(?:CineDoze|MLSBD)\.(?:com|tv|shop|co)\s*[-–]\s*/i,'');
 const y=/\((19\d{2}|20\d{2})\)/.exec(base);if(!y || +y[1]!==Number(opts.year))return null;
 if(norm(base.slice(0,y.index))!==norm(opts.name))return null;
 return {season:1,quality,title:t,unmarked:true};
}
module.exports={seasonFile};
