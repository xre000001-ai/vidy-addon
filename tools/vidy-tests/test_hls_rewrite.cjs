'use strict';
const assert=require('node:assert'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(require('node:path').join(__dirname,'../../server.js'),'utf8');const a=s.indexOf('async function vhRewrite('),b=s.indexOf('// ★ v1.34.46:',a);assert(a>=0&&b>a);
const ctx={URL,Map,String,Promise,VHS_NEXT:new Map(),vhSegNeedsRelay:async()=>false,vhRelay:u=>'PLAYLIST:'+u,vhSegRelay:u=>'SEGMENT:'+u};vm.createContext(ctx);vm.runInContext(s.slice(a,b)+';globalThis.rewrite=vhRewrite',ctx);
(async()=>{
 const base='https://source.example/path/list.m3u8';
 const media='#EXTM3U\n#EXTINF:5,\nhttps://sun2.warmsquare.top/a/123.m3u8\n#EXTINF:5,\nhttps://sun2.warmsquare.top/a/456.m3u8\n';
 const a=await ctx.rewrite(media,base,'https://addon');assert(a.includes('SEGMENT:https://sun2.warmsquare.top/a/123.m3u8'));assert(!a.includes('PLAYLIST:https://sun2.warmsquare.top'));assert(ctx.VHS_NEXT.has('https://sun2.warmsquare.top/a/123.m3u8'));
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8\n';const b=await ctx.rewrite(master,base,'https://addon');assert(b.includes('URI="PLAYLIST:https://source.example/path/audio.m3u8"'));assert(b.includes('PLAYLIST:https://source.example/path/video.m3u8'));
 const direct=await ctx.rewrite('#EXTM3U\n#EXTINF:6,\nhttps://example.org/a.m3u8\n',base,'x');assert(direct.includes('https://example.org/a.m3u8')&&!direct.includes('PLAYLIST:')&&!direct.includes('SEGMENT:'));
 const miami=await ctx.rewrite('#EXTM3U\n#EXTINF:6,\nhttps://cdn.example/a.m4s\n',base,'x');assert(!miami.includes('SEGMENT:'));
 console.log('HLS media .m3u8 segments and master playlists are routed correctly');
})().catch(e=>{console.error(e);process.exitCode=1});
// Empty waves should not be cut early merely because no server has succeeded.
const t0=s.indexOf('const stopTighten = setInterval('),t1=s.indexOf('const VPICK =',t0);
assert(t0>=0&&t1>t0);const harvest=s.slice(t0,t1);assert(!/okWave\s*===\s*0\s*&&/.test(harvest));assert(/okWave\s*>=\s*3/.test(harvest));
