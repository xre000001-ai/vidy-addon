'use strict';
const {seasonFile}=require('./season_file');
// A resolved watch file must agree with the matched post and requested episode.
// Season listings are labeled explicitly because episode coverage is unknown.
function match(r,{type,names,year,postYear,season,episode,range,seasonOnly,q0,titleMatches}){
 if(!r || !r.ok || !r.filename || ![720,1080,2160].includes(Number(r.q)) || (q0 && Number(q0)!==Number(r.q)))return null;
 if(!(names||[]).some(n=>titleMatches(n,r.filename,year,type==='series')))return null;
 if(type!=='series')return {seasonFile:false,seasonUnmarked:false};
 if(seasonOnly && !Number(r.episode)){
  const meta=(names||[]).map(name=>seasonFile(r.filename,season,{name,year:postYear})).find(Boolean);
  return meta && meta.quality===Number(r.q)?{seasonFile:true,seasonUnmarked:!!meta.unmarked}:null;
 }
 if(Number(r.season)!==Number(season) || Number(r.episode)!==(range?Number(range.start):Number(episode)) || Number(r.episode_end||r.episode)!==(range?Number(range.end):Number(episode)))return null;
 return {seasonFile:false,seasonUnmarked:false};
}
module.exports={match};
