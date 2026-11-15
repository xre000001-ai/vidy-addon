'use strict';
// Only a specifically observed provider on the file page, not arbitrary
// workers.dev links. The caller must perform a real Range probe.
function find(body){
 const matches=String(body||'').replace(/&amp;/g,'&').match(/https:\/\/fsl\.mks-lukatube\.workers\.dev\/[^"'\s<>]+/ig)||[];
 for(const raw of matches){try{const u=new URL(raw);if(u.protocol==='https:'&&u.hostname.toLowerCase()==='fsl.mks-lukatube.workers.dev'&&u.pathname.length>1&&!u.username&&!u.password)return u.href}catch(_){}}
 return '';
}
module.exports={find};
