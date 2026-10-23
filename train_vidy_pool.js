// vidy proxy-পুল প্রশিক্ষণ (স্বাধীন) — POOL + পাবলিক-তালিকা ⇒ সত্যিকারের vidy-সেশন (seed+sources একই IP)
// শর্ত: পাস + ms <= MSMAX (৩.৫সে) ⇒ verified-ফাইলে জমা। চালানো: node train_vidy_pool.js [সেকেন্ড]
const net = require('net'), tls = require('tls'), fs = require('fs'), path = require('path');
const API = 'https://api.wecollege.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MSMAX = Number(process.env.MSMAX || 3500), CONC = Number(process.env.CONC || 10), SECS = Number(process.argv[2] || 420);
const OUT = path.join(__dirname, 'vidy_px_verified.json');

function pxFetch(px, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), ci = px.indexOf(':'), ph = px.slice(0, ci), pp = +px.slice(ci + 1) || 8080;
    const s = net.connect({ host: ph, port: pp });
    const to = setTimeout(() => { try { s.destroy(); } catch (_) { } reject(new Error('timeout')); }, timeoutMs);
    const bail = e => { clearTimeout(to); try { s.destroy(); } catch (_) { } reject(e); };
    s.once('error', bail);
    s.once('connect', () => s.write('CONNECT ' + u.host + ':443 HTTP/1.1\r\nHost: ' + u.host + ':443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onD = d => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
      s.removeListener('data', onD);
      if (!/^HTTP\/1\.[01] 200/.test(buf.slice(0, i).toString('latin1'))) return bail(new Error('refused'));
      const t = tls.connect({ socket: s, servername: u.hostname, rejectUnauthorized: false }, () => {
        t.write('GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: ' + UA + '\r\nAccept: */*\r\nConnection: close\r\n\r\n');
        const ch = [];
        t.on('data', x => ch.push(x));
        t.on('end', () => { clearTimeout(to); const b = Buffer.concat(ch); const st = +(b.toString('latin1', 9, 13)); const k = b.indexOf('\r\n\r\n'); resolve({ st, body: b.slice(k + 4).toString('utf8') }); });
        t.on('error', bail);
      });
      t.on('error', bail);
    };
    s.on('data', onD);
  });
}

async function session(px) {
  const t0 = Date.now();
  const a = await pxFetch(px, API + '/seed?mediaId=278', 4500);
  if (a.st !== 200) throw new Error('seed' + a.st);
  const seed = JSON.parse(a.body).seed; if (!seed) throw new Error('seed-empty');
  const b = await pxFetch(px, API + '/miami/sources?' + new URLSearchParams({ mediaType: 'movie', tmdbId: '278', enc: '2', seed, title: '' }), 4500);
  if (b.st !== 200 || b.body.length < 200) throw new Error('src' + b.st);
  return Date.now() - t0;
}

(async () => {
  const ver = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return {}; } })();
  const pool = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_proxy_pool.json'), 'utf8')).map(c => c.px); } catch (e) { return []; } })();
  const lists = ['https://raw.githubusercontent.com/TheSpeedX/PROXY-LIST/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000',
    'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt'];
  const txts = await Promise.all(lists.map(u => new Promise(r => { const { get } = require('https'); get(u, { timeout: 15000 }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => r(b)); }).on('error', () => r('')); })));
  const raw = [...new Set((txts.join('\n').match(/\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}\b/g) || []))];
  for (let i = raw.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const w = raw[i]; raw[i] = raw[j]; raw[j] = w; }
  const known = new Set([...Object.keys(ver), ...pool]);
  const queue = [...pool, ...raw.filter(p => !known.has(p))];
  console.log('[train] pool=' + pool.length + ' raw=' + raw.length + ' verified-আগে=' + Object.keys(ver).length + ' MSMAX=' + MSMAX);

  const t0 = Date.now(); let i = 0, tries = 0, ok = 0; const found = {};
  const deadline = t0 + SECS * 1000;
  const worker = async () => {
    while (i < queue.length && Date.now() < deadline) {
      const px = queue[i++]; tries++;
      try { const ms = await session(px); if (ms <= MSMAX) { found[px] = ms; ok++; if (ok % 10 === 0) console.log('[train] +' + ok + ' verified (tries=' + tries + ', ' + Math.round((Date.now() - t0) / 1000) + 's)'); } }
      catch (e) { }
      if (tries % 200 === 0) { const merged = Object.assign({}, ver, Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { ms: v }]))); fs.writeFileSync(OUT, JSON.stringify(merged)); }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  const merged = Object.assign({}, ver, Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { ms: v }])));
  fs.writeFileSync(OUT, JSON.stringify(merged));
  const n = Object.keys(merged).length;
  console.log('[train] শেষ — নতুন-পাস=' + ok + ' tries=' + tries + ' verified-মোট=' + n + ' সময়=' + Math.round((Date.now() - t0) / 1000) + 's');
})();
