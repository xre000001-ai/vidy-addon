'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PKError,classify}=require('./errors.cjs');
const {normalizeProxy,proxyId,subnet}=require('./policy.cjs');
const {SERVERS}=require('./protocol.cjs');
const DEFAULT_FILE=path.resolve(__dirname,'../../../../cinejoy-data/cinejoy_pk_pool.json');
class Pool{
 constructor({file=DEFAULT_FILE,clock=Date.now,freshMs=300000,failureCoolMs=60000,readOnly=false}={}){
  this.file=path.resolve(file);this.clock=clock;this.freshMs=freshMs;this.failureCoolMs=failureCoolMs;this.readOnly=readOnly;this.busy=new Map();this.closed=false;this.owner=null;this.nodes={};this.metrics={selections:0,noReady:0,failovers:0};
  if(path.basename(this.file)!=='cinejoy_pk_pool.json')throw new PKError('LOCAL_SCOPE','CineJoy can only write its own named pool file');
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  if(!readOnly)this.lock();
  try{const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.schema!==1||!data.nodes||typeof data.nodes!=='object')throw new PKError('LOCAL_STATE','Unknown pool schema');this.nodes=data.nodes;}
  catch(e){if(e.code!=='ENOENT'){this.unlock();throw e;}}
 }
 lock(){
  const lock=this.file+'.lock';
  for(let attempt=0;attempt<2;attempt++){
   try{const fd=fs.openSync(lock,'wx',0o600);this.owner=crypto.randomBytes(12).toString('hex');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,owner:this.owner}));fs.closeSync(fd);return;}
   catch(e){if(e.code!=='EEXIST')throw e;let old;try{old=JSON.parse(fs.readFileSync(lock,'utf8'));}catch(_){throw new PKError('LOCAL_LOCK','Unreadable pool owner lock; refusing to overwrite');}
    try{process.kill(old.pid,0);}catch(e2){if(e2.code==='ESRCH'){fs.unlinkSync(lock);continue;}}
    throw new PKError('LOCAL_LOCK','Pool already has an active writer');
   }
  }
  throw new PKError('LOCAL_LOCK','Unable to acquire pool writer lock');
 }
 unlock(){if(!this.owner)return;try{const old=JSON.parse(fs.readFileSync(this.file+'.lock','utf8'));if(old.owner===this.owner)fs.unlinkSync(this.file+'.lock');}catch(_){}this.owner=null;}
 writable(){if(this.readOnly||this.closed)throw new PKError('LOCAL_READONLY','Pool is read-only or closed');}
 add(values,source='candidate-feed'){
  this.writable();let added=0;
  for(const value of values){try{const proxy=normalizeProxy(typeof value==='string'?value:value.proxy||value.px),id=proxyId(proxy);if(this.nodes[id]){const s=this.nodes[id].sources;if(!s.includes(source)&&s.length<8)s.push(source);continue;}
    if(Object.keys(this.nodes).length>=5000)break;
    this.nodes[id]={id,proxy,sources:[source],discoveredAt:this.clock(),globalCoolUntil:0,servers:{}};added++;
   }catch(e){if(!/^POLICY/.test(e.code||''))throw e;}
  }return added;
 }
 node(value){const id=this.nodes[value]?value:proxyId(value);return this.nodes[id]||null;}
 reserveCandidate(value){
  this.writable();const n=this.node(value);if(!n)throw new PKError('LOCAL_CANDIDATE','Unknown candidate');
  if(this.busy.has(n.id))throw new PKError('LOCAL_BUSY','Candidate already leased for verification or extraction');
  this.busy.set(n.id,1);let released=false;
  return {id:n.id,release:()=>{if(!released){released=true;this.busy.delete(n.id);}}};
 }
 bucket(node,server){if(!SERVERS.includes(server))throw new PKError('INVALID_INPUT','Unknown PK server');return node.servers[server]||(node.servers[server]={ok:0,fail:0,consecutiveFailures:0,coolUntil:0,proof:null});}
 prove(value,server,report){
  this.writable();const n=this.node(value);if(!n)throw new PKError('LOCAL_CANDIDATE','Unknown candidate');
  const {api,hls}=report||{};
  if(api?.proxyId!==n.id||api.server!==server||!api.streams?.length||hls?.proxyId!==n.id||!hls.verified||!hls.mediaVerified||!hls.video?.media?.some(x=>x.kind==='segment'&&typeof x.format==='string'&&/^(?:aes-128-)?(?:iso-bmff|mpeg-ts|png-wrapped-mpeg-ts|id3-audio-or-ts)$/.test(x.format))||[hls.master,hls.video.playlist,...hls.video.media,...(hls.audio?[hls.audio.playlist,...hls.audio.media]:[])].some(x=>x?.proxyId!==n.id))throw new PKError('LOCAL_PROOF','A same-proxy decrypted API + HLS + media proof is required');
  const now=this.clock(),b=this.bucket(n,server),ms=Math.max(1,report.ms||api.apiMs+hls.ms);
  b.ok++;b.consecutiveFailures=0;b.coolUntil=0;b.lastSuccessAt=now;b.lastReason=null;b.ewmaMs=b.ewmaMs?Math.round(b.ewmaMs*.65+ms*.35):ms;
  b.proof={at:now,proxyId:n.id,server,sample:api.sample,api:true,playlist:true,media:true,qualities:hls.qualities,selected:hls.selected?{width:hls.selected.width,height:hls.selected.height}:null,ms,mediaFormats:[...new Set(hls.video.media.map(x=>x.format).filter(Boolean))]};
  n.globalCoolUntil=0;return b.proof;
 }
 fail(value,server,error){
  this.writable();const n=this.node(value);if(!n)return;const type=classify(error);
  if(['cancelled','local','content','upstream'].includes(type))return type;
  const b=this.bucket(n,server),now=this.clock();b.fail++;b.consecutiveFailures++;b.lastFailureAt=now;b.lastReason={category:type,code:error?.code||error?.name||'ERROR',status:error?.status||null};
  let retry=Number(error?.retryAfter)*1000;if(!Number.isFinite(retry))retry=Date.parse(error?.retryAfter)-now;
  const cooldown=type==='rate-limit'?Math.min(300000,Math.max(1000,retry||60000)):Math.min(300000,this.failureCoolMs*Math.min(4,b.consecutiveFailures));
  b.coolUntil=now+cooldown;
  if(type==='transport'||type==='rate-limit'&&error?.stage==='api')n.globalCoolUntil=Math.max(n.globalCoolUntil||0,now+Math.min(cooldown,120000));
  return type;
 }
 ready(server){
  const now=this.clock();return Object.values(this.nodes).filter(n=>{
   const b=n.servers[server],p=b?.proof;
   return p&&p.proxyId===n.id&&p.server===server&&p.api===true&&p.playlist===true&&p.media===true&&Number.isFinite(p.at)&&p.at<=now+5000&&now-p.at<this.freshMs&&(b.coolUntil||0)<=now&&(n.globalCoolUntil||0)<=now&&!this.busy.get(n.id);
  }).sort((a,b)=>{
   const score=n=>(n.servers[server].ewmaMs||99999)+(now-n.servers[server].proof.at)/1000*15+(n.servers[server].consecutiveFailures||0)*1000;
   return score(a)-score(b);
  });
 }
 lease(server,{exclude=new Set(),excludeSubnets=new Set()}={}){
  this.writable();const candidates=this.ready(server).filter(n=>!exclude.has(n.id)),node=candidates.find(n=>!excludeSubnets.has(subnet(n.proxy)))||candidates[0];
  if(!node){this.metrics.noReady++;throw new PKError('NO_READY_PROXY','No fresh source-verified proxy for '+server);}
  this.metrics.selections++;this.busy.set(node.id,1);let released=false;
  return {id:node.id,proxy:node.proxy,server,subnet:subnet(node.proxy),release:()=>{if(!released){released=true;this.busy.delete(node.id);}}};
 }
 recordBrowser(value,server,report){
  this.writable();const n=this.node(value),b=n?.servers[server];
  const decoded=p=>p?.played===true&&Number.isFinite(p.decodedFrameDelta)&&p.decodedFrameDelta>=20&&Number.isFinite(p.timeDelta)&&p.timeDelta>=2&&Number.isFinite(p.end?.width)&&p.end.width>0&&Number.isFinite(p.end?.height)&&p.end.height>0;
  if(!b?.proof||report?.proxyId!==n.id||report.server!==server||!decoded(report.playback)||!decoded(report.seek))throw new PKError('LOCAL_PROOF','Decoded playback + seek via this source/proxy is required');
  b.browser={at:this.clock(),sample:report.sample,proxyId:n.id,dimensions:[report.playback.end.width,report.playback.end.height],seekDimensions:[report.seek.end.width,report.seek.end.height],mode:'API via verified proxy; client/CDN media direct'};
 }
 snapshot(){return {schema:1,updatedAt:this.clock(),freshMs:this.freshMs,nodes:this.nodes};}
 summary(){
  const now=this.clock(),byServer={};
  for(const s of SERVERS){const all=Object.values(this.nodes).filter(n=>n.servers[s]?.proof);byServer[s]={verifiedRecords:all.length,ready:this.ready(s).length,stale:all.filter(n=>now-n.servers[s].proof.at>=this.freshMs).length,cooling:all.filter(n=>(n.globalCoolUntil||0)>now||(n.servers[s].coolUntil||0)>now).length,browserProofs:all.filter(n=>n.servers[s].browser).length};}
  return {schema:1,candidates:Object.keys(this.nodes).length,freshMs:this.freshMs,busy:this.busy.size,byServer,metrics:{...this.metrics}};
 }
 save(){
  this.writable();const name=this.file+'.'+process.pid+'.tmp',fd=fs.openSync(name,'w',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(this.snapshot(),null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(name,this.file);
 }
 close(){if(this.closed)return;try{if(!this.readOnly)this.save();}finally{this.unlock();this.closed=true;}}
}
module.exports={Pool,DEFAULT_FILE};
