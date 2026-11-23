'use strict';
class PKError extends Error{
 constructor(code,message,details={}){super(message||code);this.name='PKError';this.code=code;Object.assign(this,details);}
}
function classify(error){
 const code=String(error?.code||'');const status=error?.status;
 if(/ABORT|CANCEL|HEDGE_LOST/.test(code)||error?.name==='AbortError')return 'cancelled';
 if(/POLICY|INVALID_INPUT|LOCAL|LOCK|NO_READY|DEADLINE/.test(code))return 'local';
 if(status===404||status===410||code==='NO_STREAM')return 'content';
 if(status===429)return 'rate-limit';
 if(status>=500&&status<600)return 'upstream';
 if(status===401||status===403||/HTML_BLOCK|BAD_PLAYLIST|BAD_MEDIA|BAD_RESPONSE|DECRYPT/.test(code))return 'source-block';
 if(/TIMEOUT|ETIMEDOUT|ECONN|ENET|EHOST|UND_ERR|TLS|CERT|EAI_|PROXY/.test(code+' '+error?.cause?.code+' '+error?.message))return 'transport';
 return 'other';
}
function publicError(error){return {code:error?.code||error?.name||'ERROR',category:classify(error),status:error?.status||null,message:String(error?.message||error).replace(/https?:\/\/[^\s]+/g,u=>{try{const x=new URL(u);return x.origin+x.pathname;}catch(_){return '[URL]';}}).slice(0,240)};}
module.exports={PKError,classify,publicError};
