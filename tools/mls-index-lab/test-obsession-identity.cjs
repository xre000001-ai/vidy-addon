'use strict';
const assert=require('assert'),{postAllowed}=require('./post_identity'),{find}=require('./lookup');
const film={id:376652,title:'Obsession (2026) Dual Audio Amazon WEB-DL',url:'https://mlsbd.co/obsession-2026-english-amazon-web-dl-480p-720p-1080p-4k-x264-400mb-1-1gb-2-3gb-9-5gb-download-watch-online/',sav:[{id:'A1',q:1080}]};
const series={id:370659,title:'Obsession (2025) S01 Hindi Atrangii WEB-DL',sav:[{id:'B2',q:1080}]};
const q={name:'Obsession',type:'movie',year:2026};assert.deepEqual(find([film,series],q).map(x=>x.id),[376652],'movie must not include unrelated series');
assert(postAllowed(film,'movie','tt37287335'));assert(postAllowed(film,'movie','tmdb1339713'));assert(!postAllowed(film,'movie','tt39060004'),'same title and year does not imply same film');assert(!postAllowed(film,'movie','tmdb12345'));assert(!postAllowed(film,'series','tt37287335'));assert(postAllowed({id:17,title:'Other'},'movie','tt39060004'));console.log('Obsession known IMDb/TMDB identity and movie-vs-series safeguards passed');
