'use strict';
const {createDecipheriv}=require('node:crypto');
const {PKError}=require('./errors.cjs');
function attributes(line){const out={};for(const m of line.matchAll(/([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g))out[m[1]]=m[2][0]==='"'?m[2].slice(1,-1):m[2];return out;}
function parseRange(value,defaultStart=0){const match=/^(\d+)(?:@(\d+))?$/.exec(value||'');if(!match)throw new PKError('BAD_PLAYLIST','Invalid HLS byte range');const length=Number(match[1]),start=match[2]===undefined?defaultStart:Number(match[2]);if(!Number.isSafeInteger(length)||length<1||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(start+length))throw new PKError('BAD_PLAYLIST','Unbounded HLS byte range');return{start,length};}
function parse(text,base){
 const clean=String(text).replace(/^\uFEFF/,'').trimStart();
 if(!clean.startsWith('#EXTM3U'))throw new PKError('BAD_PLAYLIST','Expected HLS content, not HTML/image/JSON');
 const lines=clean.split(/\r?\n/).map(x=>x.trim()),variants=[],audio=[],segments=[];let pending=null,map=null,key=null,range=null,nextOffset=0,sequence=0;
 for(const line of lines){
  if(line.startsWith('#EXT-X-STREAM-INF:'))pending=attributes(line);
  else if(line.startsWith('#EXT-X-MEDIA-SEQUENCE:')){sequence=Number(line.slice(22));if(!Number.isSafeInteger(sequence)||sequence<0)throw new PKError('BAD_PLAYLIST','Invalid media sequence');}
  else if(line.startsWith('#EXT-X-MEDIA:')){const a=attributes(line);if(a.TYPE==='AUDIO'&&a.URI)audio.push({...a,url:new URL(a.URI,base).href});}
  else if(line.startsWith('#EXT-X-MAP:')){const a=attributes(line);if(a.URI)map={url:new URL(a.URI,base).href,byteRange:a.BYTERANGE||null};}
  else if(line.startsWith('#EXT-X-KEY:')){const a=attributes(line);key=a.METHOD==='NONE'?null:{method:a.METHOD,url:a.URI?new URL(a.URI,base).href:null,iv:a.IV||null};}
  else if(line.startsWith('#EXT-X-BYTERANGE:'))range=line.slice(17);
  else if(line&&!line.startsWith('#')){
   const url=new URL(line,base).href;
   if(pending){const [width=0,height=0]=(pending.RESOLUTION||'').split('x').map(Number);variants.push({url,width,height,bandwidth:Number(pending.BANDWIDTH)||0,codecs:pending.CODECS||'',audioGroup:pending.AUDIO||null});pending=null;}
   else{let byteRange=null;if(range){if(!range.includes('@')&&segments.at(-1)?.url!==url)throw new PKError('BAD_PLAYLIST','Implicit byte range must follow the same resource');byteRange=parseRange(range,nextOffset);nextOffset=byteRange.start+byteRange.length;range=null;}segments.push({url,map,key,byteRange,sequence:sequence+segments.length});}
  }
 }
 if(pending)throw new PKError('BAD_PLAYLIST','Missing variant URI');
 if(!variants.length&&!segments.length)throw new PKError('BAD_PLAYLIST','HLS has no playable variants or segments');
 return {base,variants,audio,segments};
}
function choose(variants,quality=1080){
 if(!variants.length)return null;
 return variants.slice().sort((a,b)=>{const rank=x=>x.height===quality?0:x.height>0&&x.height<quality?1:x.height>quality?2:3;return rank(a)-rank(b)||(rank(a)===1?b.height-a.height:a.height-b.height)||a.bandwidth-b.bandwidth;})[0];
}
function mediaKind(buffer){
 const b=Buffer.from(buffer);if(b.length<16)return null;
 const png=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(png){const offset=64;return b.subarray(60,64).toString()==='tsDa'&&b.length>offset+188*8&&Array.from({length:8},(_,i)=>b[offset+i*188]===0x47).every(Boolean)?'png-wrapped-mpeg-ts':null;}
 const text=b.subarray(0,200).toString('utf8').trimStart();
 if(/^(?:<!doctype|<html|<\?xml|\{|\[|#EXTM3U|<Error)/i.test(text)||b[0]===255&&b[1]===216)return null;
 if(b[0]===0x47&&b.length>376&&b[188]===0x47&&b[376]===0x47)return 'mpeg-ts';
 if(['ftyp','styp','moof','sidx','mdat','free'].includes(b.subarray(4,8).toString('ascii'))&&b.readUInt32BE(0)>=8)return 'iso-bmff';
 if(b.subarray(0,3).toString()==='ID3')return 'id3-audio-or-ts';
 return null;
}
async function playlist(session,url,signal){
 const r=await session.get(url,{signal,maxBytes:1024*1024,expectedStatus:[200]});
 const text=r.body.toString('utf8'),parsed=parse(text,r.url);return {parsed,text,response:{url:r.url,status:r.status,bytes:r.body.length,ms:r.ms,proxyId:r.proxyId}};
}
async function prefix(session,url,signal,{kind='segment',byteRange=null,decryptKey=null,iv=null}={}){
 const start=byteRange?.start||0,max=Math.min(65536,byteRange?.length||65536);
 if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(max)||max<1||decryptKey&&start!==0)throw new PKError('BAD_RANGE','Unsupported media prefix byte range');
 const r=await session.get(url,{signal,maxBytes:max,prefixOnly:true,headers:{Range:`bytes=${start}-${start+max-1}`},expectedStatus:[200,206]});
 if(start>0&&r.status!==206)throw new PKError('BAD_RANGE','Upstream ignored a nonzero media byte range');
 if(r.status===206){const m=/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(r.headers['content-range']||'');if(!m||Number(m[1])!==start||Number(m[2])<start)throw new PKError('BAD_RANGE','Unexpected Content-Range for media prefix');}
 let body=r.body;
 if(decryptKey){const decipher=createDecipheriv('aes-128-cbc',decryptKey,iv);decipher.setAutoPadding(false);body=decipher.update(body.subarray(0,body.length-body.length%16));}
 let format=mediaKind(body);if(!format)throw new PKError('BAD_MEDIA','Response is not a recognizable media prefix',{status:r.status,stage:kind});if(decryptKey)format='aes-128-'+format;
 return {kind,url:r.url,status:r.status,bytes:r.body.length,ms:r.ms,contentType:r.headers['content-type']||null,format,proxyId:r.proxyId};
}
async function leaf(session,url,signal,{depth=0,quality=1080}={}){
 if(depth>2)throw new PKError('BAD_PLAYLIST','Nested HLS depth exceeded');
 const p=await playlist(session,url,signal),chosen=choose(p.parsed.variants,quality);
 if(chosen)return leaf(session,chosen.url,signal,{depth:depth+1,quality});
 const segment=p.parsed.segments[0];if(!segment)throw new PKError('BAD_PLAYLIST','No media segment');
 const media=[];let decryptKey=null,iv=null;
 if(segment.key){
  if(segment.key.method!=='AES-128'||!segment.key.url)throw new PKError('BAD_MEDIA','Unsupported encryption method; no verification claim');
  const key=await session.get(segment.key.url,{signal,maxBytes:32,expectedStatus:[200]});if(key.body.length!==16)throw new PKError('BAD_MEDIA','AES-128 key must be 16 bytes');
  decryptKey=key.body;iv=Buffer.alloc(16);
  if(segment.key.iv){if(!/^0x[0-9a-f]{1,32}$/i.test(segment.key.iv))throw new PKError('BAD_MEDIA','Invalid AES-128 IV');Buffer.from(segment.key.iv.slice(2).padStart(32,'0'),'hex').copy(iv);}
  else iv.writeBigUInt64BE(BigInt(segment.sequence),8);
  media.push({kind:'key',url:key.url,status:key.status,bytes:16,ms:key.ms,proxyId:key.proxyId});
 }
 if(segment.map){if(decryptKey&&!segment.key.iv)throw new PKError('BAD_MEDIA','Encrypted init map requires an explicit IV');const byteRange=segment.map.byteRange?parseRange(segment.map.byteRange):null;media.push(await prefix(session,segment.map.url,signal,{kind:'init',byteRange,decryptKey,iv}));}
 media.push(await prefix(session,segment.url,signal,{kind:'segment',byteRange:segment.byteRange,decryptKey,iv}));
 return {playlist:p.response,media};
}
async function verify(session,url,{signal,quality=1080,audio=true}={}){
 const began=Date.now(),master=await playlist(session,url,signal),selected=choose(master.parsed.variants,quality);
 const video=await leaf(session,selected?.url||url,signal,{quality});
 let audioProof=null;
 const a=master.parsed.audio.find(x=>x.DEFAULT==='YES'&&(!selected?.audioGroup||x['GROUP-ID']===selected.audioGroup))||master.parsed.audio[0];
 if(audio&&a)audioProof=await leaf(session,a.url,signal,{quality});
 const checks=[master.response,video.playlist,...video.media,...(audioProof?[audioProof.playlist,...audioProof.media]:[])];
 if(checks.some(x=>x.proxyId!==session.id))throw new PKError('LOCAL_PROXY_MISMATCH','Verification crossed proxy endpoints');
 return {verified:true,mediaVerified:true,proxyId:session.id,ms:Date.now()-began,master:master.response,selected,qualities:master.parsed.variants.map(x=>({width:x.width,height:x.height,codecs:x.codecs})),video,audio:audioProof};
}
module.exports={attributes,parse,parseRange,choose,mediaKind,playlist,prefix,verify};
