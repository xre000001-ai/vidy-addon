'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {namedFunction}=require('./extract.cjs');
const root=path.resolve(__dirname,'../..');
const source=()=>fs.readFileSync(process.env.SOURCE_REVIEW_SERVER || path.join(root,'server.js'),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
class Clock{
 constructor(){this.now=1e6;this.serial=0;this.timers=new Map();const self=this;this.Date=class extends Date{static now(){return self.now;}};}
 set(fn,ms,interval=0){const h={id:++this.serial,unref(){return this;}};this.timers.set(h,{fn,at:this.now+Math.max(0,Number(ms)||0),interval});return h;}
 globals(){return {Date:this.Date,setTimeout:(fn,ms)=>this.set(fn,ms),setInterval:(fn,ms)=>this.set(fn,ms,Math.max(1,Number(ms)||1)),clearTimeout:h=>this.timers.delete(h),clearInterval:h=>this.timers.delete(h)};}
 sleep(ms,value){return new Promise(r=>this.set(()=>r(value),ms));}
 async flush(){for(let i=0;i<80;i++)await Promise.resolve();}
 async finish(p,max=20000){let done=false,value,error;Promise.resolve(p).then(v=>{done=true;value=v;},e=>{done=true;error=e;});const end=this.now+max;for(let i=0;i<10000;i++){await this.flush();if(done){if(error)throw error;return value;}const next=[...this.timers].sort((a,b)=>a[1].at-b[1].at||a[0].id-b[0].id)[0];if(!next||next[1].at>end)throw Error('Unsettled real-code work at virtual deadline '+(end-1e6));const[h,t]=next;this.now=t.at;if(t.interval)t.at+=t.interval;else this.timers.delete(h);t.fn();}throw Error('Virtual timer runaway');}
}
function base(clock,extra={}){
 return {console,URL,URLSearchParams,AbortSignal,Buffer,Promise,Map,Set,Math,Number,String,Array,Object,JSON,RegExp,...clock.globals(),process:{env:{}},DBG:false,NOCACHE:true,UA:'fixture-agent',PUB_BASE_DEF:'https://addon.example',
 fetch:()=>{throw Error('Unexpected real network request in deterministic source test');},diag:()=>{},_shrink:()=>{},...extra};
}
function common(src){return ['ddlForegroundWindow','ddlOptions','ddlWait'].filter(n=>new RegExp('function '+n+'\\(').test(src)).map(n=>namedFunction(src,n)).join('\n');}
function m4u(names,extra={}){
 const src=source(),clock=new Clock(),ctx=base(clock,{
  M4U_HLIVE:'https://movies4u.one',M4U_HPAT:clock.now,M4U_TD_BASE:'https://movies4u.td',HUB_GX_DEAD:0,HUB_GX_PROBED:clock.now,
  M4U_TD_NEG:new Map(),M4U_TD_S:new Map(),M4U_TD_CACHE:new Map(),M4U_TD_LOC:new Map(),M4U_TD_USED:new Map(),M4U_TD_DONE:new Map(),M4U_TD_BG:new Map(),M4U_TD_LAST:{},M4U_PGC:new Map(),HUB_R2:new Map(),HUB_BG:new Map(),HUB_WARM:new Map(),HUB_DEAD:new Map(),
  MH_BASE:'https://movieshunt.hair',MH_S:new Map(),MH_PC:new Map(),MH_AC:new Map(),MH_NEG:new Map(),MH_HUBC:new Map(),
  mhFetch:async()=>({st:200,body:'{}'}),mhPostEntries:()=>[],mhAbhiSecs:()=>[],mhHubServers:async()=>[],m4uProof:async()=>true,
  _mhRace:(p,ms,fb)=>Promise.race([p,clock.sleep(ms,fb)]),
  nameForTmdb:async()=> 'Example',skyYear:async()=>2020,
  m4uHPickAll:posts=>posts,m4uHSearch:async()=>[],m4uHIndexPick:async()=>[],
  m4uHReq:async()=>({st:200,body:''}),m4uTdEntries:()=>[],m4uTdMdisk:async()=>[],m4uTdResolve:async()=>({url:''}),m4uVcloudResolve:async()=>[],
  dtAudio:()=> 'Dual Audio',mlsNorm:s=>String(s).toLowerCase(),mlsMB:n=>n?String(n/1e9)+' GB':'',_fnOf:u=>String(u).split('/').pop(),
  m4uLazyUrl:(u,o)=>o+'/m4d/'+Buffer.from(u).toString('base64url')+'/v.mkv',m4uSeekUrl:(u,o)=>o+'/m4g/'+Buffer.from(u).toString('base64url')+'/v.m3u8',m4uCardUrl:u=>u,
  m4uIsMediaUrl:u=>/\.(?:mkv|mp4)(?:\?|$)/i.test(u),m4uIsIpLocked:()=>false,gdWarmQueue:()=>{},
  m4uHPageTitle:()=>'',m4uHParse:()=>[],m4uHFast:async()=>({url:''}),hubR2Load:()=>{},hubLazyOk:()=>true,m4uHubFinal:async()=>'',m4uHubInfo:async()=>({q:'1080',size:'1 GB',name:'Example.2020.1080p.mkv'}),m4uHubFsl:async()=>'',
  m4uHubCard:async()=>null,m4uGfInfo:async()=>null,mlsGd:async()=>null,
  m4uTdStreams:async()=>[],m4uRevive:async()=>[],m4uMhStreams:async()=>[],
  ...extra,
 });
 vm.createContext(ctx);
 const optional=['m4uTdBlocked','m4uFileOk','hubAwaitProof','m4uTdGroups','m4uTdLinkKind','m4uAwaitMedia'].filter(n=>new RegExp('function '+n+'\\(').test(src));
 vm.runInContext(common(src)+'\n'+[...new Set(['_m4uMerge',...optional,...names])].map(n=>namedFunction(src,n)).join('\n')+'\nglobalThis.api={'+names.join(',')+'};',ctx);
 return {src,clock,ctx,api:ctx.api};
}
function hd(extra={}){
 const src=source(),clock=new Clock(),ctx=base(clock,{racePool:async()=>{throw Error('Unexpected pool');},pdProbe:async()=>({alive:true,total:1e9}),...extra});
 const a=src.indexOf('const HD_BASE ='),b=src.indexOf('// ★★ v1.27.2 (ইউজার: "Movies4u',a);
 vm.createContext(ctx);
 vm.runInContext(common(src)+'\n'+src.slice(a,b)+`\nglobalThis.api={hdStreams,hdSeries,hdProbe,hdProbeD,hdEpisodeConsistent,hdMirrorKey,hdPickMirrors,HD_S,setMocks(m){if(m.text){hdText=m.text;hdTextFast=m.text;}if(m.search)hdSearch=m.search;if(m.drive)hdDrive=m.drive;if(m.probe){hdProbe=m.probe;hdWkGate=m.probe;}if(m.name)hdImdbName=m.name;}};`,ctx);
 ctx.api.setMocks({search:async()=>({url:'https://hdhubinfo.com/example/',title:'Example (2020) WEB-DL'}),name:async()=> 'Example',probe:async()=>({ok:true,cr:'bytes 0-1023/1000000000'})});
 return {src,clock,ctx,api:ctx.api};
}
module.exports={source,root,plain,Clock,base,common,m4u,hd,namedFunction};
