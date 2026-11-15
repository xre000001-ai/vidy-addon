'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'../../server.js'),'utf8');
const begin=src.indexOf('if (CAP - (Date.now() - T0) > 2400)');const end=src.indexOf('const r=await resolveP;',begin);const block=src.slice(begin,end);
assert(block.includes('for (const u of x.gd.slice(0, 1))'),'unknown-quality series must initiate GD');
const m=block.match(/if \((range \? !consistent\(meta\)[^\n]+)\) return null;/);assert(m);
function rejected(meta,opt={}){const names=['Lanterns'],range=null,seasonOnly=false,seasonMeta=null,year=2026,type='series',SE=1,EP=5;const consistent=r=>r.season===SE&&r.episode===EP&&(r.episode_end||r.episode)===EP;const mlsTitleOk=(n,t)=>t.toLowerCase().includes(n.toLowerCase());const verifiedMovieName=()=>true;return vm.runInNewContext(m[1],{meta,names,range,seasonOnly,seasonMeta,year,type,consistent,mlsTitleOk,verifiedMovieName,...opt});}
const good={title:'Lanterns S01E05 720p.mkv',season:1,episode:5,episode_end:5,q:720};assert.equal(rejected(good),false);assert.equal(rejected({...good,season:2}),true);assert.equal(rejected({...good,episode:6,episode_end:6}),true);assert.equal(rejected({...good,title:'Other S01E05 720p.mkv'}),true);
assert(block.includes('if (![720,1080,2160].includes(meta.q)'));assert(block.includes('const needsMeta=!!(range || seasonOnly || !q0)'));
console.log('GD unknown-quality series: exact title, season, episode and supported-quality validation present');
