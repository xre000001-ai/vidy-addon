'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'../../server.js'),'utf8');
const a=src.indexOf('async function mlsWatch(link, ms, px, accept)'),b=src.indexOf('// অডিও-লেবেল:',a);assert(a>=0&&b>a);
const delay=(n,v)=>new Promise(r=>setTimeout(()=>r(v),n));
const entry=(name,q,episode,url)=>({ok:true,direct:'https://example.test/'+url,filename:name,q,season:1,episode,episode_end:episode});
const c={Promise,String,Number,mlsWatchFast:async()=>entry('Wrong S01E02 1080p.mkv',1080,2,'wrong'),mlsWatchSlow:()=>delay(25,entry('Right S01E01 720p.mkv',720,1,'right'))};
vm.createContext(c);vm.runInContext(src.slice(a,b)+';globalThis.run=mlsWatch;',c);
(async()=>{
 const accept=r=>r.episode===1&&r.q===720&&r.filename.startsWith('Right');
 let r=await c.run('x',100,undefined,accept);assert.equal(r.direct,'https://example.test/right');
 c.mlsWatchSlow=async()=>entry('Wrong S01E01 720p.mkv',720,1,'bad');assert.equal(await c.run('x',100,undefined,accept),null);
 c.mlsWatchFast=async()=>null;c.mlsWatchSlow=async()=>entry('Right S01E01 480p.mkv',480,1,'480');assert.equal(await c.run('x',100,undefined,()=>true),null);
 console.log('Task-specific race rejects wrong episode, title and quality; later valid result wins');
})().catch(e=>{console.error(e);process.exitCode=1});
