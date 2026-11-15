'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');const s=fs.readFileSync('server.js','utf8');let a=s.indexOf('async function hmText('),b=s.indexOf('function hmIsDead(',a);assert(a>=0&&b>a);
async function scenario(mode){
 let direct=0,proxies=0;const c={Date,Promise,Math,Number,String,AbortSignal,setTimeout,clearTimeout,UA:'ua',DBG:false,diag:()=>{},hostOK:()=>{},hostFail:()=>{},hostBad:()=>false,hmPoolKey:()=> 'hm',
 fetch:async()=>{direct++;if(mode==='direct-first-failure'){throw Error('direct down')}await new Promise(r=>setTimeout(r,60));return {status:200,text:async()=>'direct success'}},
 racePool:async()=>{proxies++;await new Promise(r=>setTimeout(r,30));return mode==='direct-first-failure'?{body:'X'.repeat(300)}:{body:''}}};
 vm.createContext(c);vm.runInContext(s.slice(a,b)+';globalThis.run=hmText',c);const r=await c.run('https://example.com',1000);return {r,direct,proxies};
}
(async()=>{let x=await scenario('direct-first-failure');assert.equal(x.r.st,200);assert.equal(x.r.via,'px');assert.equal(x.proxies,1);assert.equal(x.direct,1);x=await scenario('direct-success');assert.equal(x.r.st,200);assert.equal(x.r.via,'d');console.log('HindMovie first-success transport racing passed')})().catch(e=>{console.error(e);process.exitCode=1});
