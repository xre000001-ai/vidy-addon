'use strict';
// Reuse the exact cloud URL that supplied the generation key and proxy.
// Reject unrelated redirects, credentials, tokens and different file IDs.
function cloudUrl(raw,id) {
 try {
  const u=new URL(raw), m=/^\/cloud\/(\d+)\/([a-z0-9]+)\/?$/i.exec(u.pathname);
  if(u.protocol!=='https:' || u.username || u.password || u.port || u.search || u.hash || !/^(?:new\d+\.)?(?:gdflix|ddflix|ddfflix)\.(?:io|com|dev|xyz|vip|co|net|in)$/i.test(u.hostname) || !m || m[2]!==String(id)) return '';
  return u.href;
 } catch (_) { return ''; }
}
module.exports={cloudUrl};
