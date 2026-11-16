'use strict';
// For a fully buffered representation, return one RFC 9110 byte range.
// Unsupported/malformed or multi-range headers are ignored (full 200 response).
function slice(buf, header) {
 const size=buf.length, full=()=>({status:200,body:buf});
 if(!header)return full();
 const m=/^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
 if(!m || (!m[1]&&!m[2]))return full();
 const unsat=()=>({status:416,body:Buffer.alloc(0),contentRange:`bytes */${size}`});
 if(size===0)return unsat();
 let start,end;
 if(!m[1]) {const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<=0)return unsat();start=Math.max(0,size-n);end=size-1;}
 else {start=Number(m[1]);end=m[2]?Number(m[2]):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return unsat();end=Math.min(end,size-1);}
 return {status:206,body:buf.subarray(start,end+1),contentRange:`bytes ${start}-${end}/${size}`};
}
module.exports={slice};
