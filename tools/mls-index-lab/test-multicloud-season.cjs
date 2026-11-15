'use strict';
const assert=require('assert'),{matchMirror}=require('./season_file');
const titleMatches=(a,b)=>b.toLowerCase().includes(a.toLowerCase());
const good={filename:'CIneDoze.TV-Britto (2019) MLSBD.Co-S01 Bengali Addatimes 1080p.mkv - Premium Stream',q:1080};
const m=(r,s=1,names=['Britto'])=>matchMirror(r,s,names,2019,titleMatches);
assert.equal(m(good).season,1);assert.equal(m(good).unmarked,false);
assert.equal(m(good,2),null);assert.equal(m({...good,filename:good.filename.replace('Britto','Other')}),null);assert.equal(m({...good,q:720}),null);assert.equal(m({...good,filename:good.filename.replace('S01','S01E02')}),null);assert.equal(m({...good,filename:good.filename.replace('1080p','480p'),q:480}),null);
const plain={filename:'CIneDoze.Com-My Demon (2023) MLSBD.Shop-Dual Audio [Hindi-Korean] 720p.mkv',q:720};assert(matchMirror(plain,1,['My Demon'],2023,titleMatches).unmarked);assert.equal(matchMirror(plain,2,['My Demon'],2023,titleMatches),null);
console.log('MultiCloud/Pixeldrain season matching: title, season, quality, episode safeguards and labels passed');
