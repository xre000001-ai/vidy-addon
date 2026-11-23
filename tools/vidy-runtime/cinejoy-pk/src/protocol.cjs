'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto,createHash}=require('node:crypto');
const {PKError}=require('./errors.cjs');
const ROOT=path.resolve(__dirname,'..'),SERVERS=['Light','Nebula','Sirius','Polaris'];
let loaded;
const sha=b=>createHash('sha256').update(b).digest('hex');
async function codec(){
 if(loaded)return loaded;
 loaded=(async()=>{
  const manifest=JSON.parse(fs.readFileSync(ROOT+'/vendor/manifest.json')),script=fs.readFileSync(ROOT+'/vendor/public-crypto-shim.cjs'),wasm=fs.readFileSync(ROOT+'/data/crush.wasm');
  if(sha(script)!==manifest.shimSha256||sha(wasm)!==manifest.wasmSha256)throw new PKError('LOCAL_INTEGRITY','Pinned public crypto adapter hash mismatch');
  const sandbox=vm.createContext({module:{exports:{}},TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,WebAssembly,crypto:webcrypto,fetch(){throw new PKError('LOCAL_NETWORK','Public crypto adapter cannot fetch arbitrary code');}});
  new vm.Script(script.toString('utf8'),{filename:'cinejoy-public-crypto-adapter'}).runInContext(sandbox,{timeout:1500});
  const mod=await WebAssembly.compile(wasm);if(WebAssembly.Module.imports(mod).length)throw new PKError('LOCAL_WASM_IMPORTS','Unexpected WASM host imports');
  const instance=await WebAssembly.instantiate(mod,{});
  return {seal:sandbox.module.exports.seal,open:sandbox.module.exports.open,exports:instance.exports};
 })();
 try{return await loaded;}catch(e){loaded=null;throw e;}
}
function identity(input){
 const {type='movie',tmdb,imdb='',title='',year='',season,episode}=input||{};
 if(!['movie','tv'].includes(type)||!/^\d{1,10}$/.test(String(tmdb))||type==='tv'&&(!/^\d{1,4}$/.test(String(season))||!/^\d{1,5}$/.test(String(episode))))throw new PKError('INVALID_INPUT','Valid type/TMDB/season/episode are required');
 if(imdb&&!/^tt\d{5,12}$/.test(String(imdb))||String(title).length>300||year&&!/^\d{4}$/.test(String(year)))throw new PKError('INVALID_INPUT','Invalid metadata');
 const payload={tmdb:String(tmdb),imdb:String(imdb),year:String(year),title:String(title)};
 if(type==='tv'){payload.season=String(season);payload.episode=String(episode);}
 return {type,payload,key:[type,tmdb,type==='tv'?season:'',type==='tv'?episode:''].join(':')};
}
async function resolve(session,server,input,{signal}={}){
 if(!SERVERS.includes(server))throw new PKError('INVALID_INPUT','Unknown CineJoy PK server');
 const sample=identity(input),c=await codec(),began=Date.now();
 const sealed=await c.seal(Promise.resolve(c.exports),'/'+server+'/'+(sample.type==='tv'?'series':'movie'),sample.payload);
 const response=await session.get('https://api2.wing.st/g',{method:'POST',body:Buffer.from(sealed.body),headers:{'content-type':'text/plain;charset=UTF-8'},signal,maxBytes:512*1024,expectedStatus:[200]});
 let result;try{result=await c.open(new Uint8Array(response.body),sealed);}catch(e){throw new PKError('DECRYPT_RESPONSE','Public protocol response could not be decrypted; WASM may need a reviewed refresh',{cause:e});}
 if(!result||typeof result.status!=='number')throw new PKError('BAD_RESPONSE','Invalid decrypted response envelope');
 if(result.status!==200)throw new PKError('HTTP_'+result.status,'Source returned status '+result.status,{status:result.status});
 const streams=result.data?.stream;
 if(!Array.isArray(streams)||!streams.some(s=>s?.type==='hls'&&typeof s.playlist==='string'&&s.playlist.startsWith('https://')))throw new PKError('NO_STREAM','Source returned no HLS stream',{status:404});
 return {server,sample:sample.key,streams:streams.filter(s=>s?.type==='hls'),apiMs:Date.now()-began,proxyId:session.id,sourceResult:result};
}
module.exports={SERVERS,codec,identity,resolve};
