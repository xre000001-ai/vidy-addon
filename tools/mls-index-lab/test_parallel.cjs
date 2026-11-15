'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
const cut=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);if(i<0||j<0)throw Error('section missing');return source.slice(i,j)};
(async()=>{
 let calls=0, urls=[];
 const ctx={require:()=>require('./gd_resume'),Map,Promise,Number,String,Math,Date,URL,setTimeout,console,mlsEnt:x=>x,mlsGet:async url=>{calls++;urls.push(url);await new Promise(r=>setTimeout(r,40));return {url,body:'<title>GDFlix | My Show S01E01-04 1080p.mkv</title>'}}};
 vm.createContext(ctx);
 vm.runInContext(cut('const MLS_GD_FILE_FLIGHT','async function mlsGdOnce')+'\n'+cut('const MLS_GD_META = new Map()','// Watch-Online')+'\nglobalThis.page=mlsGdFilePage;globalThis.meta=mlsGdPackMeta;',ctx);
 const [page,meta]=await Promise.all([ctx.page('https://gdflix.dev/file/abc',4000),ctx.meta('https://gdflix.dev/file/abc',4000)]);
 assert.equal(urls.filter(x=>x.includes('/file/')).length,1,'metadata and GD generation share one file-page request');assert.equal(urls.filter(x=>x.includes('/cloud/')).length,1,'one speculative cloud request runs in parallel');assert.equal(meta.season,1);assert.equal(meta.episode,1);assert.equal(meta.episode_end,4);assert.equal(meta.q,1080);assert(page.body.includes('My Show'));
 await ctx.page('https://gdflix.dev/file/abc',4000);assert.equal(urls.filter(x=>x.includes('/file/')).length,2,'HTML file page is not response-cached');
 const getSource=cut('async function mlsGetRaw(u, opt)', '// ★ v1.28.40:');
 let c={mlsIndexedLinkRace:async()=>null,Map,Promise,Number,String,Math,Date,URL,setTimeout,console,process:{env:{}},UA:'ua',MLS_BASE:'https://mlsbd.co',MLS_CURL_DEAD:new Map(),MLS_GOOD:new Map(),MLS_GOOD_TS:new Map(),MLS_PXBD:[],mlsPxFor:()=>[],mlsHost:u=>new URL(u).hostname,mlsOkHtml:()=>true,mlsOkJson:()=>true,mlsOkJsonStrict:()=>true,mlsRec:()=>{},mlsCurl:async()=>({st:200,body:'ok html',eu:'https://new9.gdflix.io/file/abc'})};
 vm.createContext(c);vm.runInContext(getSource+'\nglobalThis.get=mlsGetRaw;',c);
 const r=await c.get('https://gdflix.com/file/abc',{ms:4000});assert.equal(r.url,'https://new9.gdflix.io/file/abc','curl effective redirect must be preserved');
 console.log('parallel file-page coalescing, metadata and effective redirect passed');
})().catch(e=>{console.error(e);process.exit(1)});
