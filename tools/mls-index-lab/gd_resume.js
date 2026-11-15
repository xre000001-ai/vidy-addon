'use strict';
// Only take the actual, explicitly-labelled Cloud Resume link when its
// filename is a video. A ZIP page still goes through the existing resolver.
function find(html, finalPage=false) {
  for (const m of String(html||'').matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const label=m[3].replace(/<[^>]*>/g,' ');
    if (!(finalPage ? /\b(?:download|cloud|resume)\b/i : /\bcloud\s+resume\s+download\b/i).test(label)) continue;
    try {
      const raw=m[2].replace(/&amp;/gi,'&').replace(/&#0*38;/gi,'&').replace(/&#x0*26;/gi,'&');
      const u=new URL(raw);
      if(u.protocol!=='https:' || !(/^(?:cloud-dl|fast)\.[a-z0-9]+\.workers\.dev$/i.test(u.hostname) || /^east\.aws-eu\.xyz$/i.test(u.hostname)) || u.username || u.password || u.port) continue;
      const path=decodeURIComponent(u.pathname);
      if (!/\.(?:mkv|mp4|m4v|avi|webm)$/i.test(path)) continue;
      return u.href;
    } catch (_) {}
  }
  return '';
}
module.exports={find};
