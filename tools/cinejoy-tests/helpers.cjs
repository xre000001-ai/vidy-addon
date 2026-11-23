'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Pool}=require('../vidy-runtime/cinejoy-pk/src/pool.cjs'),{proxyId}=require('../vidy-runtime/cinejoy-pk/src/policy.cjs');
const P1='http://8.8.8.8:3128',P2='http://1.1.1.1:8080',P3='http://9.9.9.9:8080';
function fixture(options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cj-pk-test-'));let now=1_000_000;const pool=new Pool({file:path.join(dir,'cinejoy_pk_pool.json'),clock:()=>now,freshMs:1000,...options});return {pool,dir,advance:n=>now+=n,close(){pool.close();fs.rmSync(dir,{recursive:true,force:true});}};}
function proof(proxy,server='Light',sample='movie:27205::'){
 const id=proxyId(proxy),response={url:'https://lightspeed.st/x.m3u8',proxyId:id,status:200};return {ms:100,api:{proxyId:id,server,sample,apiMs:30,streams:[{type:'hls',playlist:'https://lightspeed.st/x.m3u8'}]},hls:{verified:true,mediaVerified:true,proxyId:id,ms:70,master:response,qualities:[{width:1920,height:1080}],video:{playlist:response,media:[{kind:'segment',format:'iso-bmff',proxyId:id,status:206}]}}};
}
module.exports={P1,P2,P3,fixture,proof};
