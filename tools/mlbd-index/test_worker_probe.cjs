'use strict';const fs=require('fs'),vm=require('vm'),assert=require('assert');const src=fs.readFileSync('server.js','utf8'),a=src.indexOf('async function mlbdWorkerVerified('),b=src.indexOf('\nconst MLBD_NET_METRICS=',a);assert(a>=0&&b>a);
const ctx={Buffer,Promise,hdProbeD:async()=>({ok:false,st:0}),mlbdRangeBytes:async()=>null,mlbdWorkerProbeLimit:{run:f=>f()}};vm.createContext(ctx);vm.runInContext(src.slice(a,b)+';globalThis.probe=mlbdWorkerVerified',ctx);
(async()=>{
 assert.equal(await ctx.probe('https://x',2000),false);
 const mkv=Buffer.alloc(1024);Buffer.from('1a45dfa3','hex').copy(mkv);ctx.mlbdRangeBytes=async()=>({status:206,size:50000,bytes:mkv});assert.equal(await ctx.probe('https://x',2000),true);
 ctx.mlbdRangeBytes=async()=>({status:200,size:50000,bytes:mkv});assert.equal(await ctx.probe('https://x',2000),false);
 ctx.mlbdRangeBytes=async()=>({status:206,size:50000,bytes:Buffer.alloc(1024)});assert.equal(await ctx.probe('https://x',2000),false);
 ctx.hdProbeD=async()=>({ok:true,st:206,cr:'bytes 0-1023/50000'});assert.equal(await ctx.probe('https://x',2000),true);
 console.log('FSL verified transport race rejects invalid status and non-video payload');
})().catch(e=>{console.error(e);process.exitCode=1});
