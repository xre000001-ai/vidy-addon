'use strict';const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('server.js','utf8');const block=s.slice(s.indexOf('const HD_BASE ='),s.indexOf('// ★★ v1.27.2 (ইউজার:',s.indexOf('const HD_BASE =')));
const ctx={URL,AbortSignal,fetch,process,console,setTimeout,clearTimeout,DBG:false,NOCACHE:true,UA:'test',_shrink(){},racePool:async()=>{throw Error('unused')},pdProbe:async()=>({alive:true})};
vm.runInNewContext(block+'\nglobalThis.api={hdDrive,setText:(t)=>{hdText=t;}}',ctx);
ctx.api.setText(async u=>({t:u.includes('hubcloud.php')?'<a href="https://pixeldrain.dev/u/negn6f">placeholder</a><a href="https://pixeldrain.dev/u/Valid123">real</a>':'<title>Show.S07E02.720p.mkv</title> https://gamerxyt.com/hubcloud.php?id=123'}));
(async()=>{const r=await ctx.api.hdDrive('https://hubcloud.pw/drive/abc',1000);assert(!r.cands.some(x=>x.u.includes('negn6f')));assert(r.cands.some(x=>x.u.includes('Valid123')));console.log('HD Pixeldrain dead-placeholder filtered, other mirrors retained')})().catch(e=>{console.error(e);process.exitCode=1});
