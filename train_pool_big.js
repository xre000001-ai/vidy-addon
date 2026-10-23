// বাল্ক vidy-পুল প্রশিক্ষণ v2 — ধাপ ১: CONNECT-যোগ্যতা (সস্তা) → ধাপ ২: সত্যিকারের vidy সেশন (seed+sources)
// ব্যবহার: node train_pool_big.js <সেকেন্ড> [cand.json]
const net = require('net'), tls = require('tls'), fs = require('fs'), path = require('path');
const API = 'https://api.wecollege.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SECS = Number(process.argv[2] || 600);
const CAND = process.argv[3] || '/tmp/pxbig.json';
const MSMAX = Number(process.env.MSMAX || 3500);
const PCONC = Number(process.env.PCONC || 60);   // ধাপ-১ সমান্তরাল
const SCONC = Number(process.env.SCONC || 24);   // ধাপ-২ সমান্তরাল
const OUT = path.join(__dirname, 'vidy_px_verified.json');

function split(px) { const i = px.indexOf(':'); return [px.slice(0, i), +px.slice(i + 1) || 8080]; }

// ধাপ-১: শুধু CONNECT (TLS/HTTP নয়) — দ্রুত "এই প্রক্সি ৪৪৩-এ টানেল খুলতে পারে?"
function connectOk(px, tmo) {
  return new Promise(res => {
    const [h, p] = split(px);
    const s = net.connect({ host: h, port: p });
    let done = false;
    const fin = v => { if (!done) { done = true; try { s.destroy(); } catch (_) { } res(v); } };
    const to = setTimeout(() => fin(false), tmo);
    s.once('error', () => { clearTimeout(to); fin(false); });
    s.once('connect', () => s.write('CONNECT gstatic.com:443 HTTP/1.1\r\nHost: gstatic.com:443\r\n\r\n'));
    let buf = '';
    s.on('data', d => { buf += d.toString('latin1'); if (buf.indexOf('\r\n\r\n') >= 0) { clearTimeout(to); fin(/^HTTP\/1\.[01] 200/.test(buf)); } });
  });
}

function pxFetch(px, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), [ph, pp] = split(px);
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
  const a = await pxFetch(px, API + '/seed?mediaId=278', 4000);
  if (a.st !== 200) throw new Error('seed' + a.st);
  const seed = JSON.parse(a.body).seed; if (!seed) throw new Error('seed-empty');
  const b = await pxFetch(px, API + '/miami/sources?' + new URLSearchParams({ mediaType: 'movie', tmdbId: '278', enc: '2', seed, title: '' }), 4000);
  if (b.st !== 200 || b.body.length < 200) throw new Error('src' + b.st);
  return Date.now() - t0;
}

(async () => {
  const ver = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return {}; } })();
  let cands = [];
  try { cands = JSON.parse(fs.readFileSync(CAND, 'utf8')); } catch (e) { cands = []; }
  try { cands = cands.concat(JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_proxy_pool.json'), 'utf8')).map(c => c.px)); } catch (e) { }
  cands = [...new Set(cands)];
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const w = cands[i]; cands[i] = cands[j]; cands[j] = w; }
  const known = new Set(Object.keys(ver));
  console.log('[big] প্রার্থী=' + cands.length + ' verified-আগে=' + Object.keys(ver).length + ' MSMAX=' + MSMAX + ' PCONC=' + PCONC + ' SCONC=' + SCONC);
  const t0 = Date.now(), deadline = t0 + SECS * 1000;
  let pi = 0, alive = [], tried = 0, ok = 0; const found = {};
  const save = () => { const m = Object.assign({}, ver, Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { ms: v }]))); fs.writeFileSync(OUT, JSON.stringify(m)); return Object.keys(m).length; };

  // ধাপ-১: CONNECT-যোগ্যতা
  await Promise.all(Array.from({ length: PCONC }, async () => {
    while (pi < cands.length && Date.now() < deadline) {
      const px = cands[pi++];
      if (await connectOk(px, 2500)) alive.push(px);
      if (pi % 1000 === 0) console.log('[big] ধাপ১ ' + pi + '/' + cands.length + ' CONNECT-ঠিক=' + alive.length);
    }
  }));
  console.log('[big] ধাপ১ শেষ: ' + alive.length + '/' + pi + ' CONNECT-ঠিক (' + Math.round((Date.now() - t0) / 1000) + 's)');

  // ধাপ-২: vidy সেশন
  let si = 0;
  await Promise.all(Array.from({ length: SCONC }, async () => {
    while (si < alive.length && Date.now() < deadline) {
      const px = alive[si++];
      if (known.has(px)) continue;
      tried++;
      try { const ms = await session(px); if (ms <= MSMAX) { found[px] = ms; ok++; if (ok % 10 === 0) console.log('[big] +' + ok + ' verified (tries=' + tried + ', ' + Math.round((Date.now() - t0) / 1000) + 's)'); } }
      catch (e) { }
      if (tried % 200 === 0) save();
    }
  }));
  const n = save();
  console.log('[big] শেষ — নতুন=' + ok + ' tries=' + tried + ' verified-মোট=' + n + ' সময়=' + Math.round((Date.now() - t0) / 1000) + 's');
})();
