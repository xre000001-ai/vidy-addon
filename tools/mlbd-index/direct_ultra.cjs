'use strict';
// Provider's MP4 and Ultra objects have the same media ID on observed pages.
// This is only a candidate: the caller compares a real byte range to FSL.
function candidate(mp4){try{const u=new URL(mp4);if(u.protocol!=='https:'||u.hostname!=='999c8bfadce536bf3068e488c127691c.r2.cloudflarestorage.com'||u.username||u.password||u.port)return '';const m=/^\/movielinkbd\/media\/([A-Za-z0-9]{6,32})\/stream\.mp4$/.exec(u.pathname);return m?'https://pub-28b828119b694d6aaa663dcaa07c10b8.r2.dev/media/'+m[1]+'/main':''}catch(_){return ''}}
function same(a,b){return !!(a&&b&&a.status===206&&b.status===206&&a.size>1024&&a.size===b.size&&Buffer.isBuffer(a.bytes)&&Buffer.isBuffer(b.bytes)&&a.bytes.length===1024&&b.bytes.length===1024&&a.bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))&&a.bytes.equals(b.bytes))}
function parse(out){
 if(!Buffer.isBuffer(out))return null;let pos=0,status=0,size=0;
 while(out.subarray(pos,pos+5).toString()==='HTTP/'){
  const end=out.indexOf(Buffer.from('\r\n\r\n'),pos);if(end<0||end-pos>32768)return null;
  const head=out.subarray(pos,end).toString('latin1');status=+((/^HTTP\/\S+\s+(\d{3})/i.exec(head)||[])[1]||0);
  const m=/^content-range:\s*bytes 0-1023\/(\d+)\s*$/im.exec(head);size=m?+m[1]:0;pos=end+4;
 }
 return status===206&&size?{status,size,bytes:out.subarray(pos)}:null;
}
module.exports={candidate,same,parse};
