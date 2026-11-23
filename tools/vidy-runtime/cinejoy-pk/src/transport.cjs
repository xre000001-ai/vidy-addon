'use strict';
const {request,ProxyAgent,Agent}=require('./deps.cjs')('undici');
const {PKError}=require('./errors.cjs');
const {normalizeProxy,proxyId,safeURL}=require('./policy.cjs');
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36';
class Session{
 constructor(proxy,{timeout=6000,allowHosts=[],discovery=false,requestFn=request}={}){
  this.proxy=proxy?normalizeProxy(proxy):null;this.id=proxy?proxyId(proxy):'direct-control';this.timeout=timeout;this.allowHosts=allowHosts;this.discovery=discovery;this.requestFn=requestFn;this.closed=false;this.log=[];
  this.dispatcher=proxy?new ProxyAgent({uri:this.proxy,requestTls:{rejectUnauthorized:true},proxyTls:{rejectUnauthorized:true},connections:2,pipelining:1}):new Agent({connections:2,pipelining:1,connect:{rejectUnauthorized:true}});
 }
 async get(value,options={}){
  if(this.closed)throw new PKError('LOCAL_SESSION_CLOSED');
  let url=safeURL(value,this);const began=Date.now(),timer=new AbortController();
  const timeout=setTimeout(()=>timer.abort(new PKError('TIMEOUT','Request exceeded local deadline')),options.timeout||this.timeout);timeout.unref?.();
  const signal=options.signal?AbortSignal.any([timer.signal,options.signal]):timer.signal;
  let method=options.method||'GET',body=options.body;
  try{
   for(let redirect=0;redirect<=4;redirect++){
    signal.throwIfAborted();
    const headers={'user-agent':UA,'accept':'*/*','referer':'https://cinejoy.pk/','origin':'https://cinejoy.pk',...options.headers};
    // No browser account cookies, auth, Host override, or forwarded client identity.
    for(const k of Object.keys(headers))if(/^(?:cookie|authorization|host|x-forwarded-for|proxy-authorization)$/i.test(k))delete headers[k];
    const r=await this.requestFn(url,{dispatcher:this.dispatcher,method,body,headers,signal,maxRedirections:0,headersTimeout:options.timeout||this.timeout,bodyTimeout:options.timeout||this.timeout});
    const status=r.statusCode;
    if([301,302,303,307,308].includes(status)&&r.headers.location){r.body.destroy();url=safeURL(new URL(r.headers.location,url).href,this);if(status===303){method='GET';body=undefined;}continue;}
    const maxBytes=options.maxBytes||1024*1024;const chunks=[];let n=0,truncated=false;
    for await(const piece of r.body){
     const remaining=maxBytes-n;
     if(piece.length>remaining){chunks.push(piece.subarray(0,remaining));n+=remaining;truncated=true;r.body.destroy();break;}
     chunks.push(piece);n+=piece.length;
     if(options.prefixOnly&&n>=maxBytes){truncated=true;r.body.destroy();break;}
    }
    if(truncated&&!options.prefixOnly)throw new PKError('BAD_RESPONSE_SIZE','Upstream response exceeded size limit',{status});
    const result={url,status,headers:r.headers,body:Buffer.concat(chunks,n),truncated,ms:Date.now()-began,proxyId:this.id};
    this.log.push({url,status,ms:result.ms,bytes:n,truncated,method,proxyId:this.id});
    if(options.expectedStatus&&!options.expectedStatus.includes(status))throw new PKError('HTTP_'+status,'Upstream HTTP '+status,{status,retryAfter:r.headers['retry-after']});
    return result;
   }
   throw new PKError('BAD_REDIRECTS','Too many upstream redirects');
  }catch(e){
   if(signal.aborted)throw signal.reason||new PKError('ABORTED');
   throw e;
  }finally{clearTimeout(timeout);}
 }
 async close(){if(!this.closed){this.closed=true;await this.dispatcher.destroy();}}
}
module.exports={Session,UA};
