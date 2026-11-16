'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),{EventEmitter}=require('events');const path=require('path');const s=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
const h=s.slice(s.indexOf('function vhLooksHtml('),s.indexOf('function vhSniffCt('));const a=s.indexOf('async function vhsServe('),b=s.indexOf('// ★ v1.28.3-l:',a);const fn=s.slice(a,b);
async function run(range,mode,method='GET'){
 const req=new EventEmitter();req.headers=range?{range}:{};req.method=method;const res=new EventEmitter();res.writableEnded=false;let chunks=[];res.writeHead=(st,head)=>{res.status=st;res.headers=head||{}};res.write=b=>{chunks.push(Buffer.from(b));return true};res.end=b=>{if(b)chunks.push(Buffer.from(b));res.writableEnded=true};let fallback=0,reads=0;const media=Buffer.from('abcdefghij');
 const fetch=mode==='fallback'?async()=>{throw new Error('network')}:async()=>({status:200,headers:{get:k=>k==='content-type'?(mode==='htmlct'?'text/html':'application/octet-stream'):null},body:{cancel:async()=>{},getReader:()=>({read:async()=>reads++?{done:true}:{value:Buffer.from('  <!DOCTYPE html><html>ad</html>'),done:false},cancel:async()=>{}})}});
 const ctx={require:(id)=>id.includes('vidy-runtime/range.cjs')?require('../vidy-runtime/range.cjs'):require(id),Buffer,URL,AbortController,Date,Promise,Map,setTimeout,clearTimeout,UA:'x',VIDY_REFERER:'x',VHS_PC:new Map(),VHS_AFF:new Map(),vhSniffCt:()=> 'video/mp2t',vhsPrefetch:()=>{},vhsFailDiag:()=>{},vhsFetchViaNodes:async()=>{fallback++;return media},fetch};vm.createContext(ctx);vm.runInContext(h+fn+';globalThis.run=vhsServe',ctx);await ctx.run(req,res,Buffer.from('https://example.org/a').toString('base64url'));return {status:res.status,headers:res.headers,body:Buffer.concat(chunks).toString(),fallback};
}
(async()=>{
 let r=await run('bytes=2-4','fallback');assert.equal(r.status,206);assert.equal(r.body,'cde');assert.equal(r.headers['content-range'],'bytes 2-4/10');assert.equal(r.headers['content-length'],3);
 r=await run('bytes=-3','fallback');assert.equal(r.body,'hij');assert.equal(r.headers['content-range'],'bytes 7-9/10');
 r=await run('bytes=20-','fallback');assert.equal(r.status,416);assert.equal(r.headers['content-range'],'bytes */10');assert.equal(r.body,'');
 r=await run('bytes=0-2,4-5','fallback');assert.equal(r.status,200);assert.equal(r.body,'abcdefghij');
 r=await run('bytes=2-4','fallback','HEAD');assert.equal(r.status,200);assert.equal(r.body,'');assert.equal(r.headers['content-length'],10);
 for(const mode of ['htmlct','htmlbody']){r=await run('',mode);assert.equal(r.fallback,1);assert.equal(r.body,'abcdefghij');}
 const {choose}=require('../vidy-runtime/rendition.cjs');const sig=x=>(/index-([^/]+)/.exec(x)||[])[1]||'';const list=[{url:'https://a/index-v1',quality:'1080p'},{url:'https://a/index-v2',quality:'1080p'},{url:'https://a/index-v3',quality:'720p'}];assert.equal(choose(list,'1080p','v2',sig).url,list[1].url);assert.equal(choose(list,'1080p','bad',sig),null);assert.equal(choose(list,'720p','bad',sig),null);assert.equal(choose(list,'720p','',sig).url,list[2].url);assert.equal(choose(list,'2160p','',sig),null);assert.equal(choose(list,'','',sig),null);
 console.log('Vidy relay rejects HTML, honors buffered Range and preserves requested rendition');
})().catch(e=>{console.error(e);process.exitCode=1});
