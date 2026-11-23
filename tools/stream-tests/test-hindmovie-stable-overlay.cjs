'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const root = path.resolve(__dirname, '../..');
const hm = require('../vidy-runtime/hindmovie.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reply = t => ({ st: 200, t });
const file = 'Example.2020.1080p.mkv';
const postURL = 'https://v5.hindmovie.im/example-2020-hindi-1080p/';
const sourceURL = (host, n = file) => 'https://' + host + '/?id=' + encodeURIComponent(n);
const worker = n => 'https://stream.workers.dev/0:/' + n;
const b64 = s => Buffer.from(s).toString('base64');
const cloud = url => 'https://hcloud.shop/redirect.php?url=' + b64('https://hcloud.ink/direct/index.php?url=' + b64(url));
function fixture(names = [file], handler) {
  const calls = [];
  const source = hm.create({ get: async (url, ms, ref, body) => {
    calls.push({ url, body });
    if (url.includes('/wp-json/wp/v2/search?')) return reply(JSON.stringify([{ url: postURL }]));
    if (url.includes('/?s=')) return reply('');
    if (url === postURL) return reply(names.map(n => '<h2>' + n + '</h2><a href="' + sourceURL('boldb.site', n) + '">Links</a>').join(''));
    if (handler) return handler(url, ms, ref, body);
    if (url.includes('boldb.site')) return reply('<a href="' + worker(new URL(url).searchParams.get('id')) + '">Hub</a>');
    return reply('');
  }});
  return { source, calls };
}

test('01 stable server is byte-identical outside its HindMovie section', () => {
  const { beforeReview } = require('../cinejoy-tests/review-preservation.cjs');
  let s = beforeReview('server.js').toString('utf8');
  for (const edit of require('../cinejoy-tests/fixtures/authorized-edits.json').filter(x => x.file === 'server.js').reverse()) {
    assert.equal(s.split(edit.new).length - 1, edit.count, 'Exact original CineJoy inverse');
    s = s.split(edit.new).join(edit.old);
  }
  const a = s.indexOf('// ─── v1.17.46: HindMovie'), b = s.indexOf("// VidBolt's Orion provider", a);
  assert(a >= 0 && b > a);
  const hash = crypto.createHash('sha256').update(s.slice(0, a) + s.slice(b)).digest('hex');
  assert.equal(hash, 'b4f8e491ed7189b42b66920c38a5dad21ba8ed3463eaecef7165e571a606dc70');
});
test('02 original stable dependencies and version survive the exact later-release inverses', () => {
  const { beforeReview } = require('../cinejoy-tests/review-preservation.cjs');
  const hash = n => crypto.createHash('sha256').update(beforeReview(n)).digest('hex');
  assert.equal(hash('package.json'), 'b9abffd6f3cd13bd5eff6096940d12f03620878e49860bcf4da0459eb7dd9893');
  assert.equal(hash('package-lock.json'), '6aadd82e64f09c0785c8b6cc9bff1e0d1f7daafca9a28ce3eee4456fb333be21');
});
test('03 1080p is detected in actual dotted filenames', () => assert.equal(hm.qualityOf(file), '1080'));
test('04 2160p and 4K are treated as the same requested quality', () => {
  for (const n of ['Example.2160p.mkv', 'Example.4K.WEB.mkv']) assert.equal(hm.qualityOf(n), '2160');
});
test('05 quality matching is not a substring of a larger number', () => {
  assert.equal(hm.qualityOf('Example.11080p.mkv'), '');
  assert.equal(hm.qualityOf('Example.720p.mkv'), '720');
});
test('06 Jawan never matches Jawani', () => {
  assert(hm.titleScore('Jawan', 'https://v5.hindmovie.im/jawan-2023-hindi-1080p/') > 0);
  assert.equal(hm.titleScore('Jawan', 'https://v5.hindmovie.im/hai-jawani-toh-ishq-hona-hai-2026-hindi/'), -1);
});
test('07 exact post outranks lookalikes; a confirmed cached HTML result need not wait for slow REST', async () => {
  assert(hm.titleScore('The Odyssey', 'https://v5.hindmovie.im/the-odyssey-2026-hindi/') > hm.titleScore('The Odyssey', 'https://v5.hindmovie.im/troy-the-odyssey-2017-hindi/'));
  let restFinished = false;
  const source = hm.create({ get: async url => {
    if (url.includes('/wp-json/')) { await sleep(70); restFinished = true; return reply('[]'); }
    return reply('<a href="' + postURL + '">Example</a>');
  }});
  const out = await source.search('Example');
  assert.equal(out[0], postURL); assert.equal(restFinished, false);
});
test('08 site navigation and unrelated hosts cannot be search results', () => {
  for (const u of ['https://v5.hindmovie.im/movies/', 'https://other.example/example-2020/', 'https://v5.hindmovie.im/tag/example-2020/']) assert.equal(hm.titleScore('Example', u), -1);
});
test('09 embed selection skips 480/720 but keeps every 1080/4K link, including the fifth link', () => {
  const html = [480,720,720,1080,1080,2160].map((q, i) => '<h3>Example ' + q + 'p</h3><a href="https://mvlink.blog/' + (i+1) + '">Download</a>').join('');
  assert.deepEqual(hm.embedsOf(html).map(x => x.url), ['https://mvlink.blog/4','https://mvlink.blog/5','https://mvlink.blog/6']);
});
test('10 unknown-quality season embeds remain discoverable', () => {
  const rows = hm.embedsOf('<h3>Season 1</h3><a href="https://mvlink.blog/web/1234">Files</a>');
  assert.equal(rows.length, 1); assert(rows[0].url.includes('/web/1234'));
});
test('11 parentheses and encoded hshare file names are preserved', () => {
  const n = 'Inception.(2010).1080p.Dual.Audio.(Hin-Eng).mkv';
  assert.deepEqual(hm.parseFiles('<a href="https://hshare.lol/?id=' + encodeURIComponent(n) + '">Download</a>'), [{ name:n, id:n, sources:[sourceURL('hshare.lol',n)] }]);
});
test('12 opaque hshare tokens stay attached to the real filename', () => {
  assert.deepEqual(hm.parseFiles('<h2>' + file + '</h2><a href="https://hshare.lol/?id=abcd1234efgh5678">Open</a>'), [{name:file,id:'abcd1234efgh5678',sources:[sourceURL('hshare.lol','abcd1234efgh5678')]}]);
});
test('13 WordPress rendered JSON is decoded before extracting boldb files', () => {
  const json = JSON.stringify({content:{rendered:'<a href="https://boldb.site/?id=' + file + '">Open</a>'}});
  assert.equal(hm.parseFiles(json)[0].name, file);
});
test('14 series matching requires the exact season and episode', () => {
  assert(hm.episodeMatch('Example.S01E02.1080p.mkv',1,2));
  assert(!hm.episodeMatch('Example.S02E01.1080p.mkv',1,2));
  assert(!hm.episodeMatch('Example.S01E20.1080p.mkv',1,2));
});
test('15 ZIP and RAR packs are not stream files', () => {
  assert.equal(hm.parseFiles('<h2>Example.1080p.zip</h2><h2>Example.2160p.rar</h2>').length,0);
});
test('16 spaces and signed URL query strings are preserved', () => {
  const u = hm.cleanUrl('https://a.workers.dev/0:/wise 13/Example.mkv?token=abc&expires=123');
  assert(u.includes('wise%2013')); assert(u.endsWith('?token=abc&expires=123'));
});
test('17 nested hcloud base64 resolves without fetching or probing the media', () => {
  const u = worker(file); assert.equal(hm.hcloudDecode(cloud(u)), u);
});
test('18 direct workers and decoded Hub mirrors are both extracted', () => {
  const html = '<a href="https://a.workers.dev/123/' + file + '">Mirror</a><a href="' + cloud(worker(file)) + '">Hub</a>';
  assert.equal(hm.scanUrls(html).urls.length, 2);
});
test('19 boldb and hshare run in parallel, and neither mirror is dropped', async () => {
  const starts = [];
  const h = hm.create({get:async url => {starts.push(Date.now());await sleep(60);return reply('<a href="https://' + (url.includes('boldb')?'a':'b') + '.workers.dev/0:/' + file + '">Stream</a>');}});
  const urls = await h.finalUrls({name:file,id:''},500);
  assert.equal(urls.length,2); assert(Math.max(...starts)-Math.min(...starts)<40);
});
test('20 gdshine is resolved once with POST and all ready Fast/Hub cards survive', async () => {
  let posts=0;
  const h=hm.create({get:async(url,ms,ref,body)=>{
    if(url.includes('/api/share/')) return reply(JSON.stringify({data:{file:{id:'file-id'}}}));
    if(url.includes('/via-worker')) {posts++;assert.equal(body,'{}');return reply(JSON.stringify({data:{copyUrl:'https://fast.workers.dev/d/ready-token'}}));}
    return reply('<a href="https://gdshine.org/s/abcdefghi">Fast</a><a href="'+cloud(worker(file))+'">Hub</a>');
  }});
  const out=await h.finalUrls({name:file,id:''},500);
  assert.equal(posts,1);assert.equal(out.length,2);assert(out.some(u=>u.includes('/d/ready-token')));
});
test('21 first tap waits for all selected files, not only the first completed file', async () => {
  const names=['Example.A.1080p.mkv','Example.B.1080p.mkv','Example.C.1080p.mkv','Example.D.2160p.mkv'];
  const {source}=fixture(names,async url=>{
    if(!url.includes('boldb'))return reply('');
    const n=new URL(url).searchParams.get('id');await sleep(n.includes('.A.')?5:70);
    return reply('<a href="'+worker(n)+'">Stream</a>');
  });
  const out=await source.cards('Example','movie',0,0,null,1000);
  assert.equal(out.length,4);assert(out.some(c=>c.quality==='2160'));
});
test('22 concurrent requests share the same work and a completed cache preserves all cards', async () => {
  const {source,calls}=fixture();
  const [a,b]=await Promise.all([source.cards('Example','movie',0,0,null,1000),source.cards('Example','movie',0,0,null,1000)]);
  assert.equal(a.length,1);assert.deepEqual(a,b);
  const count=calls.length;assert.deepEqual(await source.cards('Example','movie',0,0,null,1000),a);assert.equal(calls.length,count);
});
test('23 no 720p/480p fallback and empty results do not become permanent card-cache hits', async () => {
  const {source,calls}=fixture(['Example.720p.mkv','Example.480p.mkv']);
  assert.equal((await source.cards('Example','movie',0,0,null,1000)).length,0);
  assert.equal((await source.cards('Example','movie',0,0,null,1000)).length,0);
  assert.equal(calls.filter(c=>c.url===postURL).length,2);
  assert(!calls.some(c=>/boldb|hshare/.test(c.url)));
});
test('24 stable server actually awaits the upgraded HM result (no immediate-empty race)', async () => {
  const src=fs.readFileSync(path.join(root,'server.js'),'utf8'),a=src.indexOf('function hmStreams('),b=src.indexOf('async function hmStreamsRaw(',a);
  let called=0;
  const c={Map,Date,Promise,String,Number,console,NOCACHE:false,DBG:false,HM_RC:new Map(),HM_INF:new Map(),HM_RC_TTL:1000,
    HM_UPGRADE:{cards:async()=>{called++;await sleep(35);return [{url:'ok',quality:'1080'},{url:'low',quality:'720'}];}},
    tmdbToImdb:async()=>'',hmCard:()=>null,hmStreamsRaw:async()=>{throw Error('legacy must not compete');}};
  vm.createContext(c);vm.runInContext(src.slice(a,b)+';globalThis.run=hmStreams;',c);
  const t=Date.now(),out=await c.run(1,'Example','movie',0,0,'',0);
  assert(Date.now()-t>=30);assert.equal(called,1);assert.equal(out.length,1);assert.equal(out[0].url,'ok');
});

test('25 advertised boldb-only files never wait on an invented hshare path', async () => {
  const entry=hm.parseFiles('<a href="'+sourceURL('boldb.site')+'">Links</a>')[0],calls=[];
  const h=hm.create({get:async url=>{calls.push(url);assert(url.includes('boldb.site'));return reply('<a href="'+worker(file)+'">Hub</a>');}});
  assert.equal((await h.finalUrls(entry,500)).length,1);
  assert.equal(calls.length,1);assert(!calls.some(u=>u.includes('hshare')));
});
test('26 advertised hshare-only files do not issue useless boldb lookups; both explicit paths survive', async () => {
  const hs=sourceURL('hshare.lol'),bb=sourceURL('boldb.site');
  const entry=hm.parseFiles('<h2>'+file+'</h2><a href="'+hs+'">Links</a>')[0],calls=[];
  const h=hm.create({get:async url=>{calls.push(url);return reply('<a href="https://'+(url.includes('hshare')?'a':'b')+'.workers.dev/0:/'+file+'">Hub</a>');}});
  assert.equal((await h.finalUrls(entry,500)).length,1);assert.deepEqual(calls,[hs]);
  const both=hm.parseFiles('<a href="'+bb+'">A</a><a href="'+hs+'">B</a>')[0];
  assert.deepEqual(new Set(both.sources),new Set([bb,hs]));assert.equal((await h.finalUrls(both,500)).length,2);
});
test('27 a ready file resolves while another embed is still outstanding; final result includes both', async () => {
  let release,slowDone=false,started=false;
  const gate=new Promise(r=>{release=r;});
  const names=['Example.A.1080p.mkv','Example.B.2160p.mkv'];
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL)return reply(names.map((n,i)=>'<h3>'+n+'</h3><a href="https://mvlink.blog/'+(100+i)+'">Links</a>').join(''));
    if(url==='https://mvlink.blog/101'){await gate;slowDone=true;return reply('<a href="'+sourceURL('boldb.site',names[1])+'">B</a>');}
    if(url==='https://mvlink.blog/100')return reply('<a href="'+sourceURL('boldb.site',names[0])+'">A</a>');
    if(url.includes('boldb')){started=true;const n=new URL(url).searchParams.get('id');return reply('<a href="'+worker(n)+'">Hub</a>');}
    return reply('');
  }});
  const work=h.cards('Example','movie',0,0,null,1000);
  await sleep(25);assert(started);assert.equal(slowDone,false);release();
  const out=await work;assert.equal(out.length,2);assert(out.some(c=>c.quality==='2160'));
});
test('28 actual embed concurrency stays at three even when Joshapp HTML and REST race', async () => {
  const names=Array.from({length:6},(_,i)=>'Example.File'+i+'.1080p.mkv');let active=0,max=0;
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL)return reply(names.map((n,i)=>'<h3>'+n+'</h3><a href="https://links.joshapp.blog/'+(300+i)+'">Links</a>').join(''));
    if(url.includes('links.joshapp')){active++;max=Math.max(max,active);await sleep(12);active--;const i=Number(url.match(/(\d+)\/?$/)[1])-300;return reply('<a href="'+sourceURL('boldb.site',names[i])+'">Links</a>');}
    if(url.includes('boldb'))return reply('<a href="'+worker(new URL(url).searchParams.get('id'))+'">Hub</a>');
    return reply('');
  }});
  assert.equal((await h.cards('Example','movie',0,0,null,1500)).length,6);assert(max<=3);assert(max>=2);
});
test('29 identity lookup overlaps useful post and embed work instead of delaying its start', async () => {
  let resolveIdentity,postStarted=false,embedStarted=false;
  const identity=new Promise(r=>{resolveIdentity=r;});
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL){postStarted=true;return reply('<a href="https://imdb.com/title/tt1234567">IMDb</a><h3>Example 1080p</h3><a href="https://mvlink.blog/100">File</a>');}
    if(url==='https://mvlink.blog/100'){embedStarted=true;return reply('<a href="'+sourceURL('boldb.site')+'">Link</a>');}
    if(url.includes('boldb'))return reply('<a href="'+worker(file)+'">Hub</a>');
    return reply('');
  }});
  const work=h.cards('Example','movie',0,0,null,1000,{imdbPromise:identity});
  await sleep(20);assert(postStarted);assert(embedStarted);resolveIdentity('tt1234567');
  assert.equal((await work).length,1);
});
test('30 candidate metadata is fetched in parallel and a wrong IMDb post never supplies cards', async () => {
  const other='https://v5.hindmovie.im/example-2021-hindi-1080p/';let active=0,max=0,badDrill=false;
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL},{url:other}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL||url===other){active++;max=Math.max(max,active);await sleep(15);active--;return reply('<a href="https://imdb.com/title/'+(url===postURL?'tt1111111':'tt2222222')+'">IMDb</a><a href="'+sourceURL('boldb.site',url===postURL?'Example.Wrong.1080p.mkv':file)+'">Links</a>');}
    if(url.includes('Wrong'))badDrill=true;
    if(url.includes('boldb'))return reply('<a href="'+worker(file)+'">Hub</a>');
    return reply('');
  }});
  const out=await h.cards('Example','movie',0,0,null,1000,{imdb:'tt2222222'});
  assert.equal(out.length,1);assert.equal(max,2);assert.equal(badDrill,false);
});
test('31 cached cards for same-named films are separated by the server identity key', async () => {
  let count=0;
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL){count++;return reply('<a href="'+sourceURL('boldb.site','Example.Version'+count+'.1080p.mkv')+'">Links</a>');}
    if(url.includes('boldb'))return reply('<a href="'+worker(new URL(url).searchParams.get('id'))+'">Hub</a>');
    return reply('');
  }});
  const a=await h.cards('Example','movie',0,0,null,1000,{key:'1'}),b=await h.cards('Example','movie',0,0,null,1000,{key:'2'});
  assert.equal(a.length,1);assert.equal(b.length,1);assert.notEqual(a[0].url,b[0].url);assert.equal(count,2);
});
test('32 only structured gdshine extraction errors are terminal, never a blocked route', () => {
  const u='https://gdshine.org/api/downloads/file-id/via-worker',err='{"success":false,"error":"File too large","code":413}';
  assert(hm.extractionError(u,413,err));assert(hm.extractionError(u,400,err));
  for(const [url,st,t] of [[u,403,err],[u,429,err],[u,500,err],[u,413,'<html>Blocked</html>'],['https://proxy.example/api/downloads/x/via-worker',413,err]])assert(!hm.extractionError(url,st,t));
});
test('33 a conclusive upstream JSON error ends the race without waiting for silent proxies', async () => {
  const calls=[],code=fs.readFileSync(path.join(root,'tools/vidy-runtime/hindmovie.cjs'),'utf8');
  const fake={ProxyAgent:class{destroy(){return Promise.resolve();}},fetch:async(url,opt)=>{
    calls.push(opt.dispatcher?'proxy':'direct');
    if(opt.dispatcher)return new Promise((resolve,reject)=>{opt.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
    return {status:413,headers:{getSetCookie:()=>[]},text:async()=>'{"success":false,"error":"File is too large","code":413}'};
  }};
  const c={require:n=>n==='undici'?fake:require(n),module:{exports:{}},__dirname:path.join(root,'tools/vidy-runtime'),process,console,Buffer,URL,AbortController,setTimeout,clearTimeout};
  vm.runInNewContext(code,c);const mod=c.module.exports;mod.poolLoad();
  const t=Date.now(),r=await mod.get('https://gdshine.org/api/downloads/file-id/via-worker',500);
  assert.equal(r.st,413);assert(Date.now()-t<250);assert.equal(calls[0],'proxy');assert(calls.includes('direct'));
});
test('34 repeated filenames from different embeds merge provenance and do not duplicate gdshine POSTs', async () => {
  let posts=0;
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL)return reply('<h3>Example 1080p</h3><a href="https://mvlink.blog/100">A</a><a href="https://mvlink.blog/101">B</a>');
    if(url==='https://mvlink.blog/100')return reply('<a href="'+sourceURL('boldb.site')+'">A</a>');
    if(url==='https://mvlink.blog/101'){await sleep(20);return reply('<a href="'+sourceURL('hshare.lol')+'">B</a>');}
    if(url.includes('/api/share/'))return reply(JSON.stringify({data:{file:{id:'same-file'}}}));
    if(url.includes('/via-worker')){posts++;await sleep(35);return reply(JSON.stringify({data:{copyUrl:'https://fast.workers.dev/d/shared'}}));}
    return reply('<a href="https://gdshine.org/s/abcdefghi">Fast</a><a href="https://'+(url.includes('boldb')?'a':'b')+'.workers.dev/0:/'+file+'">Hub</a>');
  }});
  const out=await h.cards('Example','movie',0,0,null,1000);assert.equal(out.length,3);assert.equal(posts,1);
});
test('35 wrong-title mvlink HTML is rejected and recovered through the correct REST file list', async () => {
  const h=hm.create({get:async url=>{
    if(url.includes('/wp-json/wp/v2/search'))return reply(JSON.stringify([{url:postURL}]));
    if(url.includes('/?s='))return reply('');
    if(url===postURL)return reply('<h3>Example 1080p</h3><a href="https://mvlink.blog/100">Links</a>');
    if(url==='https://mvlink.blog/100')return reply('<a href="'+sourceURL('hshare.lol','Different.Movie.1080p.mkv')+'">Wrong</a>');
    if(url==='https://mvlink.blog/wp-json/wp/v2/posts/100')return reply(JSON.stringify({content:{rendered:'<a href="'+sourceURL('hshare.lol')+'">Correct</a>'}}));
    assert(!url.includes('Different'));
    return reply('<a href="'+worker(file)+'">Hub</a>');
  }});
  const out=await h.cards('Example','movie',0,0,null,1000);assert.equal(out.length,1);assert.equal(out[0].filename,file);
});
test('36 independent file resolvers are not held in batches of three; every selected file is returned', async () => {
  const names=['Example.A.1080p.mkv','Example.B.1080p.mkv','Example.C.1080p.mkv','Example.D.2160p.mkv'];let starts=0,release;
  const gate=new Promise(r=>{release=r;});
  const {source}=fixture(names,async url=>{
    if(!url.includes('boldb'))return reply('');
    starts++;await gate;return reply('<a href="'+worker(new URL(url).searchParams.get('id'))+'">Hub</a>');
  });
  const work=source.cards('Example','movie',0,0,null,1000);
  await sleep(20);assert.equal(starts,4);release();assert.equal((await work).length,4);
});
test('37 extraction never performs a media request, HEAD, Range probe or hcloud network lookup', async () => {
  const calls=[];
  const h=hm.create({get:async(url,ms,ref,body)=>{
    calls.push({url,body});
    if(url.includes('/api/share/'))return reply(JSON.stringify({data:{file:{id:'file-id'}}}));
    if(url.includes('/via-worker'))return reply('{"success":false,"error":"No copy drive"}');
    return reply('<a href="'+cloud(worker(file))+'">Hub</a><a href="https://gdshine.org/s/abcdefghi">Fast</a>');
  }});
  assert.equal((await h.finalUrls({name:file,id:'',sources:[sourceURL('boldb.site')]},500)).length,1);
  assert.equal(calls.length,3);assert(calls.every(c=>!c.url.includes('.workers.dev')&&!c.url.includes('hcloud.')));
  assert.equal(calls.filter(c=>c.body==='{}').length,1);
});
test('38 the server forwards a title-independent identity cache key to HindMovie only', () => {
  const s=fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert(s.includes("11000, { key: String(tmdbId || ''), imdbPromise:"));
  assert.equal(hm.fileTitleMatch('Jawan','Hai.Jawani.2026.1080p.mkv'),false);
  assert(hm.fileTitleMatch('The Odyssey','The.Odyssey.2026.1080p.mkv'));
});
test('39 a filename-only Joshapp HTML shell cannot beat the usable REST file list', async () => {
  const h=hm.create({get:async url=>{
    if(url==='https://links.joshapp.blog/100')return reply('<title>'+file+'</title>');
    if(url.includes('links.joshapp.blog/wp-json/')){await sleep(20);return reply(JSON.stringify({content:{rendered:'<a href="'+sourceURL('boldb.site')+'">Links</a>'}}));}
    return reply('<h3>Example 1080p</h3><a href="https://links.joshapp.blog/100">Links</a>');
  }});
  const p=await h.post(postURL,500);assert.equal(p.files.length,1);assert.deepEqual(p.files[0].sources,[sourceURL('boldb.site')]);
});
