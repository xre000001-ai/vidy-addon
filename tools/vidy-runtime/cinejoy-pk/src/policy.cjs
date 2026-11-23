'use strict';
const net=require('node:net'),crypto=require('node:crypto');
const {PKError}=require('./errors.cjs');
const MEDIA_SUFFIXES=['lightspeed.st','bright67.online','ferb.st','cursed.st','ttcdn-us.com'];
function publicIPv4(ip){
 if(net.isIP(ip)!==4)return false;
 const a=ip.split('.').map(Number),[x,y,z]=a;
 return !(x===0||x===10||x===127||x>=224||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&y===168||x===100&&y>=64&&y<=127||x===198&&(y===18||y===19)||x===192&&y===0&&(z===0||z===2)||x===198&&y===51&&z===100||x===203&&y===0&&z===113);
}
function normalizeProxy(value){
 const s=String(value||'').trim();let u;
 try{u=new URL(/^https?:\/\//i.test(s)?s:'http://'+s);}catch(_){throw new PKError('POLICY_PROXY','Invalid proxy address');}
 const port=Number(u.port||s.match(/:(\d+)\/?$/)?.[1]||(/^https?:/i.test(s)?u.protocol==='https:'?443:80:0));
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!publicIPv4(u.hostname)||port<1||port>65535)throw new PKError('POLICY_PROXY','Only unauthenticated public IPv4 HTTP(S) proxy endpoints are accepted');
 return u.origin;
}
function proxyId(proxy){return crypto.createHash('sha256').update(normalizeProxy(proxy)).digest('hex').slice(0,16);}
function subnet(proxy){return new URL(proxy).hostname.split('.').slice(0,3).join('.');}
function safeURL(value,{allowHosts=[],discovery=false}={}){
 let u;try{u=new URL(value);}catch(_){throw new PKError('POLICY_URL','Invalid upstream URL');}
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||net.isIP(u.hostname)||u.hostname==='localhost'||u.hostname.endsWith('.local'))throw new PKError('POLICY_URL','Only approved public HTTPS origins are permitted');
 const suffixes=[...MEDIA_SUFFIXES,...allowHosts];
 const allowed=['cinejoy.pk','api2.wing.st','subs2.wing.st'].includes(u.hostname)||suffixes.some(s=>u.hostname===s||u.hostname.endsWith('.'+s))||(discovery&&['raw.githubusercontent.com','api.proxyscrape.com'].includes(u.hostname));
 if(!allowed)throw new PKError('POLICY_HOST','Unapproved upstream host: '+u.hostname);
 return u.href;
}
module.exports={MEDIA_SUFFIXES,publicIPv4,normalizeProxy,proxyId,subnet,safeURL};
