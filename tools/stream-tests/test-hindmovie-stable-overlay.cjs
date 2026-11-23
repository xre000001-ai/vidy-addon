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
const worker = n => 'https://stream.workers.dev/0:/' + n;
const b64 = s => Buffer.from(s).toString('base64');
const cloud = url => 'https://hcloud.shop/redirect.php?url=' + b64('https://hcloud.ink/direct/index.php?url=' + b64(url));
function fixture(names = [file], handler) {
  const calls = [];
  const source = hm.create({ get: async (url, ms, ref, body) => {
    calls.push({ url, body });
    if (url.includes('/wp-json/wp/v2/search?')) return reply(JSON.stringify([{ url: postURL }]));
    if (url.includes('/?s=')) return reply('');
    if (url === postURL) return reply(names.map(n => '<h2>' + n + '</h2>').join(''));
    if (handler) return handler(url, ms, ref, body);
    if (url.includes('boldb.site')) return reply('<a href="' + worker(new URL(url).searchParams.get('id')) + '">Hub</a>');
    return reply('');
  }});
  return { source, calls };
}

test('01 stable server is byte-identical outside its HindMovie section', () => {
  const s = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const a = s.indexOf('// ─── v1.17.46: HindMovie'), b = s.indexOf("// VidBolt's Orion provider", a);
  assert(a >= 0 && b > a);
  const hash = crypto.createHash('sha256').update(s.slice(0, a) + s.slice(b)).digest('hex');
  assert.equal(hash, 'b4f8e491ed7189b42b66920c38a5dad21ba8ed3463eaecef7165e571a606dc70');
});
test('02 stable dependency files and version have not changed', () => {
  const hash = n => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, n))).digest('hex');
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
  assert.deepEqual(hm.parseFiles('<a href="https://hshare.lol/?id=' + encodeURIComponent(n) + '">Download</a>'), [{ name:n, id:n }]);
});
test('12 opaque hshare tokens stay attached to the real filename', () => {
  assert.deepEqual(hm.parseFiles('<h2>' + file + '</h2><a href="https://hshare.lol/?id=abcd1234efgh5678">Open</a>'), [{name:file,id:'abcd1234efgh5678'}]);
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
