'use strict';
// Experimental pure search only. Does not emit cards or resolve media.
function norm(s) { return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '); }
function matches(row,name,year,type,season,episode) {
 const want=norm(name), candidate=norm(row.title);
 if (!want || !(candidate===want || candidate.startsWith(want+' '))) return false;
 const tail=candidate.slice(want.length).trim();
 // Short/one-word names must not match unrelated titles sharing the first word.
 if (!/^(?:19\d\d|20\d\d|s\d{1,2}e\d|season\b|dual\b|multi\b|hindi\b|bengali\b|english\b|web\b|download\b|$)/.test(tail)) return false;
 if (type==='movie' && year) {
  const y=(row.title.match(/\b(?:19|20)\d{2}\b/)||[])[0];
  if (y && Math.abs(+y-(+year))>1) return false;
 }
 if(type==='series') {
  const text=String(row.title||'');
  const se=new RegExp('(?:\\bS0*'+Number(season)+'(?=E|\\b)|\\bSeason\\s*0*'+Number(season)+'\\b)','i');
  if(!se.test(text))return false;
  const ranges=[...text.matchAll(/\bS\d{1,2}E0*(\d{1,3})(?:\s*[-–]\s*E?0*(\d{1,3}))?/gi)];
  if(ranges.length && !ranges.some(m=>+m[1]<=episode && episode<=+(m[2]||m[1]))) return false;
 }
 return true;
}
function find(rows,q){
 const r=[];
 for(const p of rows){
  if(!matches(p,q.name,q.year,q.type,q.season,q.episode))continue;
  // Unknown quality stays indexed but is not presented as a verified >=720 stream.
  let sav=(p.sav||[]).filter(x=>x && /^[a-z0-9]+$/i.test(x.id) && [720,1080,2160].includes(Number(x.q)));
  if(q.type==='series'){
   // Never select marked links for a different episode. Unknown hints are allowed
   // only when the post names one exact episode; episode-range posts need hints.
   const s=String(p.title||'').match(/\bS\d{1,2}E0*(\d{1,3})(?:\s*[-–]\s*E?0*(\d{1,3}))?/i);
   const hasRange=s && s[2] && +s[2]!==+s[1];
   sav=sav.filter(x=> (Number(x.ep)===Number(q.episode) && ((x.ep_end && Number(x.ep_end)===Number(x.ep)) || (!x.ep_end && !hasRange))) || (!x.ep && s && !hasRange && +s[1]===Number(q.episode)));
  }
  if(sav.length)r.push({id:p.id,title:p.title,url:p.url,sav});
 }
 return r;
}
module.exports={norm,matches,find};
