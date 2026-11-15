'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('server.js','utf8'),a=s.indexOf('async function mmIndexMaster('),b=s.indexOf('// ---------- বহু-সোর্স-মার্জ',a);
assert(a>=0&&b>a); let direct,proxy,headers;
const c={Promise,Error,WO_REF:'https://vidout.pages.dev/',UA:'test',woFetch:()=>direct(),racePool:(u,n,t,key,accept,h)=>{headers=h;return proxy().then(body=>{if(!accept(body))throw Error('bad');return {body}})}};
vm.createContext(c);vm.runInContext(s.slice(a,b)+';globalThis.run=mmIndexMaster',c);
const wait=(n,v)=>new Promise(r=>setTimeout(()=>r(v),n));
(async()=>{
 direct=()=>wait(50,{ok:true,text:async()=> '#EXTM3U\n#EXT-X-STREAM-INF'});proxy=()=>wait(5,'#EXTM3U\n#EXT-X-STREAM-INF');let t=Date.now();assert((await c.run('https://example.org',200)).startsWith('#EXTM3U'));assert(Date.now()-t<45);assert.equal(headers.Referer,c.WO_REF);
 direct=()=>Promise.resolve({ok:true,text:async()=>'<html>bad</html>'});proxy=()=>Promise.resolve('#EXTM3U\nvalid');assert.equal(await c.run('https://example.org',200),'#EXTM3U\nvalid');
 direct=()=>Promise.reject(Error('down'));proxy=()=>Promise.resolve('<html>bad');assert.equal(await c.run('https://example.org',200),'');
 console.log('MM direct/proxy master race and body validation passed');
})().catch(e=>{console.error(e);process.exit(1)});
