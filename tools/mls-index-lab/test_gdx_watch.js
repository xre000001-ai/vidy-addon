'use strict';
const assert=require('assert');const g=require('./gdx_watch');
assert.equal(g.watchPage('<a href="/file/Ab123/watch?hash=abc&amp;x=1">watch</a>','https://gdxfiles.com/file/Ab123'),'https://gdxfiles.com/file/Ab123/watch?hash=abc&x=1');
assert.equal(g.watchPage('<a href="https://evil.test/file/Ab123/watch">watch</a>','https://gdxfiles.com/file/Ab123'),'');
assert.equal(g.video('const videoUrl = "https:\\/\\/abcd.r2.cloudflarestorage.com\\/v.mkv?a=1\\u0026b=2";'),'https://abcd.r2.cloudflarestorage.com/v.mkv?a=1&b=2');
assert.equal(g.video('const videoUrl = "http://localhost/private";'),'');
(async()=>{let calls=0;const out=await g.resolve('https://gdxfiles.com/file/Ab123',async (u)=>{calls++;return calls===1?{url:u,body:'<a href="/file/Ab123/watch?hash=xyz">Watch</a>'}:{body:'const videoUrl = "https://abcd.r2.cloudflarestorage.com/v.mkv?sig=x";'}},6000);assert(out.ok);assert.equal(out.srv,'gdx·watch');assert.equal(calls,2);assert.equal(await g.resolve('https://evil.test/file/Ab',()=>{throw Error('must not fetch')},1000),null);console.log('GDx watch valid parsing, escaped URL, host restrictions and two-hop resolution passed')})().catch(e=>{console.error(e);process.exit(1)});
(async()=>{
 const link='https://gdxfiles.com/file/Ab123';let n=0;
 const out=await g.resolve(link,async u=>++n===1?{url:u,body:'<a href="/file/Ab123/watch?hash=x">Watch</a>'}:{body:'const videoUrl = "https://abcd.r2.cloudflarestorage.com/Bachelor%20Point%20S05E129-134%20720p.mkv?sig=x";'},6000);
 assert.equal(out.season,5);assert.equal(out.episode,129);assert.equal(out.episode_end,134);assert.equal(out.q,720);console.log('GDx episode pack metadata passed');
})().catch(e=>{console.error(e);process.exit(1)});
