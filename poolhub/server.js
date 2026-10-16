// PoolHub — ইউনিভার্সাল-প্রক্সি-পুল সার্ভিস (স্বতন্ত্র-প্রক্রিয়া; vidy-সহ-যে-কোনো-ক্লায়েন্টের-API)
// নকশা (ইউজার): একটাই-প্রশিক্ষিত-ভাণ্ডার, প্রতি-সোর্সের-আলাদা-'স্পেস'; ক্লায়েন্ট-কল করে:
//   /fetch?src=api&url=...  → পুল-থেকে-রেস-করে-বডি-ফেরত (রেস+স্কোর+স্পেস-সব-এখানেই)
//   /pick?src=api&n=5       → শুধু-প্রার্থী-তালিকা (নিজে-ফেচ-করতে-চাইলে)
//   /report (POST)          → বাইরের-রায় লেখা
//   /health /pool           → স্বচ্ছতা
'use strict';
const http = require('http'), https = require('https'), net = require('net'), tls = require('tls');
const fs = require('fs'), path = require('path');
const { URL } = require('url');
const VERSION = '1.0.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const PORT = Number(process.env.PORT || 8399);
const PX_CAP = 154, DIR = __dirname;
const POOL_FILE = path.join(DIR, 'vidy_px_pool.json'), SRC_FILE = path.join(DIR, 'vidy_px_sources.json');
const PX_PROBE_URL = 'https://www.google.com/generate_204';
// স্পেস-রেজিস্ট্রি — নতুন-সোর্স = নতুন-কী (লেজি-ভাবে-ও-তৈরি-হয় /report-এ)
const SPACES = {
  site: { url: 'https://www.vidy.st/robots.txt', min: 80, home: 'https://www.vidy.st/', homeMin: 500 },
  api: { url: 'https://api.wecollege.net/seed?mediaId=95350', min: 30, contains: '"seed"' },
  vb: { url: 'https://vidbolt.xyz/', min: 200 },
  wo: { url: 'https://vidout.pages.dev/', min: 200 }
};
const POOL = []; try { for (const c of JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'))) POOL.push(c); } catch (e) { }
const PX_RUN = new Map(), PX_LASTOK = new Map(), PX_COOL = new Map(), PX_MISS = new Map();
for (const k of Object.keys(SPACES)) SPACES[k].set = new Set(), SPACES[k].ts = new Map();
try { const o = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8')); const now = Date.now(); for (const sk of Object.keys(o)) { if (!SPACES[sk]) SPACES[sk] = { url: '', min: 1, set: new Set(), ts: new Map() }; for (const px of Object.keys(o[sk])) if (now - o[sk][px] < 600000) { SPACES[sk].set.add(px); SPACES[sk].ts.set(px, o[sk][px]); } } } catch (e) { }
const GLOB = { ring: [] };
function blackout() { const r = GLOB.ring; if (r.length < 30) return false; let f = 0; for (const g of r) if (!g) f++; return f / r.length >= 0.9 ? 1 : (f / r.length < 0.5 ? 0 : -1); }
function pxRec(px, good, ms, src) {
  GLOB.ring.push(good ? 1 : 0); if (GLOB.ring.length > 60) GLOB.ring.shift();
  if (good) PX_LASTOK.set(px, Date.now());
  const h = PX_RUN.get(px) || { ok: 0, fail: 0, ms: 0, last: 0 };
  if (good) { h.ok++; h.ms = h.ms ? Math.round(h.ms * 0.7 + ms * 0.3) : ms; } else if (blackout() === 1) { } else h.fail++;
  h.last = Date.now(); PX_RUN.set(px, h);
  if (src) { const S = space(src); if (good) { S.set.add(px); S.ts.set(px, Date.now()); saveSrc(); } else { S.set.delete(px); saveSrc(); } }
}
function pxScore(px, boot) { const h = PX_RUN.get(px); if (!h) return boot || 9999; let sc = h.ms || boot || 9999; if (h.fail && !h.ok) sc += 8000; return sc + h.fail * 400 - Math.min(h.ok, 8) * 120; }
function space(k) { if (!SPACES[k]) SPACES[k] = { url: '', min: 1, set: new Set(), ts: new Map() }; return SPACES[k]; }
let SAVE_T = null;
function saveSrc() { if (SAVE_T) return; SAVE_T = setTimeout(() => { SAVE_T = null; const o = {}; for (const sk of Object.keys(SPACES)) { o[sk] = {}; for (const px of SPACES[sk].set) o[sk][px] = SPACES[sk].ts.get(px) || Date.now(); } try { fs.writeFileSync(SRC_FILE, JSON.stringify(o)); } catch (e) { } }, 3000); }
function savePool() { try { fs.writeFileSync(POOL_FILE, JSON.stringify(POOL)); } catch (e) { } }
function dechunk(b) { let o = [], i = 0; while (i < b.length) { const j = b.indexOf('\r\n', i); if (j < 0) break; const s = parseInt(b.slice(i, j).toString('latin1').split(';')[0], 16); if (!s) break; o.push(b.slice(j + 2, j + 2 + s)); i = j + 2 + s + 2; } return Buffer.concat(o); }
function proxiedGet(px, url, timeoutMs, maxBytes) { // CONNECT-টানেল+TLS — বডি-ক্যাপ-সহ
  return new Promise((resolve, reject) => {
    const u = new URL(url); const ci = px.indexOf(':');
    const sock = net.connect({ host: px.slice(0, ci), port: Number(px.slice(ci + 1)) || 8080 });
    const to = setTimeout(() => { sock.destroy(); reject(new Error('proxy-timeout')); }, timeoutMs);
    const bail = e => { clearTimeout(to); try { sock.destroy(); } catch (e2) { } reject(e); };
    sock.once('error', bail); sock.once('connect', () => sock.write('CONNECT ' + u.host + ':443 HTTP/1.1\r\nHost: ' + u.host + ':443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]); const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
      sock.removeListener('data', onData); const head = buf.slice(0, i).toString('latin1');
      if (!/^HTTP\/1\.[01] 200/.test(head)) return bail(new Error('proxy-refused'));
      const tl = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
        tl.write('GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: ' + UA + '\r\nAccept: */*\r\nConnection: close\r\n\r\n');
        const chunks = [buf.slice(i + 4)]; let n = 0, ht = '', hd = false;
        tl.on('data', d2 => { if (!hd) { ht += d2.toString('latin1'); const j = ht.indexOf('\r\n\r\n'); if (j < 0) return; hd = true; chunks.push(Buffer.from(ht.slice(j + 4), 'latin1')); ht = ht.slice(0, j); n = chunks[1].length; return; } n += d2.length; chunks.push(d2); if (n > (maxBytes || 3145728)) { tl.destroy(); } });
        tl.on('close', () => { clearTimeout(to); const raw = Buffer.concat(chunks); const body = (/chunked/i.test(ht) ? dechunk(raw) : raw).toString('utf8'); const code = parseInt((ht.split('\r\n')[0] || '').split(' ')[1] || '0', 10); if (code === 429) return bail(Object.assign(new Error('rate_limited'), { code: 429 })); if (code !== 200 && code !== 204) return bail(new Error('http_' + code)); resolve(body); });
        tl.once('error', bail);
      }); tl.once('error', bail);
    };
    sock.on('data', onData);
  });
}
function directGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': UA }, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(directGet(new URL(res.headers.location, url).toString(), timeoutMs)); }
      const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(ch).toString('utf8')) : reject(new Error('http_' + res.statusCode)));
    }); req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}
function racePool(url, n, timeoutMs, src) { // স্পেস-টিয়ার: নিজ-স্পেস≥৩ → api → site → জীবিত → সর্বশেষ-সব
  const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
  const alive = srt.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; });
  const sb = src && SPACES[src] ? alive.filter(c => SPACES[src].set.has(c.px)) : [];
  const good = alive.filter(c => SPACES.site.set.has(c.px));
  const ap = alive.filter(c => SPACES.api.set.has(c.px));
  const use = sb.length >= 3 ? sb : (ap.length >= 3 ? ap : (good.length >= 3 ? good : (alive.length >= 3 ? alive : srt)));
  const n2 = Math.min(use.length, Math.max(n, (srt.length - alive.length) >= srt.length / 2 ? n + 3 : n));
  const cands = []; for (let i = 0; i < n2 && use.length; i++) { const c = use[Math.floor(i * use.length / n2)]; if (c && !cands.some(x => x.px === c.px)) cands.push(c); }
  if (!cands.length) return Promise.reject(new Error('pool-empty'));
  return new Promise((resolve, reject) => {
    let done = false; const to = setTimeout(() => { if (!done) { done = true; reject(new Error('race-timeout')); } }, timeoutMs);
    let fails = 0;
    for (const c of cands) { const tP = Date.now();
      proxiedGet(c.px, url, timeoutMs).then(body => { pxRec(c.px, true, Date.now() - tP, src); if (done) return; done = true; clearTimeout(to); resolve({ body, px: c.px, ms: Date.now() - tP }); })
        .catch(() => { pxRec(c.px, false, 0, src); if (++fails === cands.length && !done) { done = true; clearTimeout(to); reject(new Error('pool-exhausted')); } });
    }
  });
}
function probePool() { if (!POOL.length) return; const snap = POOL.slice(); let dn = 0;
  for (const c of snap) { const t0 = Date.now(); proxiedGet(c.px, PX_PROBE_URL, 4000).then(() => { pxRec(c.px, true, Date.now() - t0); c.ms = Date.now() - t0; if (++dn === snap.length) prune(snap); }).catch(() => { pxRec(c.px, false, 0); if (++dn === snap.length) prune(snap); }); } }
function prune(snap) { const good = snap.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; }); const alive = good.length >= 3 ? good : snap; POOL.length = 0; for (const c of alive) POOL.push(c); savePool(); }
let CHK = 0, busy = false;
async function wave() { // দুই-স্পেস×২১-ঘূর্ণন — vidy-র-.৫৬-মডেল-হুবহু
  if (busy || !POOL.length) return; busy = true;
  try {
    const tnow = Date.now();
    const wl = POOL.filter(c => (PX_COOL.get(c.px) || 0) <= tnow).sort((a, b) => (PX_LASTOK.get(a.px) || 0) - (PX_LASTOK.get(b.px) || 0)).slice(0, 42);
    if (!wl.length) return;
    CHK++;
    const SK = Object.keys(SPACES); const k1 = SK[CHK % SK.length], k2 = SK[(CHK + 1) % SK.length];
    const HALF = Math.ceil(wl.length / 2); const jobs = [];
    for (let i = 0; i < wl.length; i++) jobs.push({ c: wl[i], sk: i < HALF ? k1 : k2 });
    let cok = 0, cspare = 0, cdead = 0;
    await Promise.all(jobs.map(j => new Promise(r2 => {
      const S = space(j.sk);
      const HOME = j.sk === 'site' && (CHK % 32 === 0);
      const u = HOME ? S.home : (S.url || PX_PROBE_URL); const minB = HOME ? (S.homeMin || 500) : (S.min || 1);
      const t0 = Date.now();
      proxiedGet(j.c.px, u, 6000).then(body => {
        const ok = !!body && body.length > minB && (!S.contains || body.indexOf(S.contains) >= 0);
        pxRec(j.c.px, ok, Date.now() - t0, j.sk);
        if (ok) { S.set.add(j.c.px); S.ts.set(j.c.px, Date.now()); saveSrc(); PX_MISS.delete(j.c.px); PX_COOL.delete(j.c.px); cok++; }
        else { S.set.delete(j.c.px); const m = (PX_MISS.get(j.c.px) || 0) + 1; if (m >= 2) PX_MISS.set(j.c.px, 0); else PX_MISS.set(j.c.px, m); cspare++; }
        r2();
      }).catch(() => { const t1 = Date.now(); S.set.delete(j.c.px); PX_MISS.delete(j.c.px);
        proxiedGet(j.c.px, PX_PROBE_URL, 4000).then(() => { pxRec(j.c.px, true, Date.now() - t1); pxRec(j.c.px, false, 0); cspare++; r2(); }).catch(() => { pxRec(j.c.px, false, 0); cdead++; PX_COOL.set(j.c.px, Date.now() + 120000); r2(); });
      });
    })));
    const t2 = Date.now(); let cut = 0;
    for (let i = POOL.length - 1; i >= 0 && POOL.length > 20; i--) if (t2 - (PX_LASTOK.get(POOL[i].px) || t2) > 600000) { const g = POOL.splice(i, 1)[0]; PX_RUN.delete(g.px); PX_LASTOK.delete(g.px); PX_COOL.delete(g.px); PX_MISS.delete(g.px); for (const sk of SK) { SPACES[sk].set.delete(g.px); SPACES[sk].ts.delete(g.px); } cut++; saveSrc(); }
    if (cut) { savePool(); setTimeout(enrich, 1500).unref(); }
    if (CHK % 15 === 1) console.log('[wave] স্পেস=' + k1 + '+' + k2 + ' ওকে=' + cok + ' মৃত=' + cdead + ' পুল=' + POOL.length + ' | ' + SK.map(k => k + '=' + SPACES[k].set.size).join(' '));
  } finally { busy = false; }
}
let training = false;
async function enrich() {
  if (training) return; // v1.0.1-fix: ঠান্ডা-শুরুতে-পুল=০-হলেও-ফসল-নামতে-হবে (আগের-গার্ডে-মৃত-চক্র: ফাঁকা-পুলে-এনরিচ-নিজেই-ফেরত) training = true;
  try {
    const lists = ['https://raw.githubusercontent.com/TheSpeedX/PROXY-LIST/master/http.txt', 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000', 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt'];
    const txts = await Promise.all(lists.map(u => directGet(u, 12000).catch(() => '')));
    const have = new Set(POOL.map(c => c.px));
    const cands = [...new Set((txts.join('\n').match(/\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}\b/g) || [])).values()].filter(px => !have.has(px));
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const w = cands[i]; cands[i] = cands[j]; cands[j] = w; }
    const sample = cands.slice(0, 200), good = [];
    for (let i = 0; i < sample.length && POOL.length < PX_CAP; i += 120) {
      const res = await Promise.all(sample.slice(i, i + 120).map(px => new Promise(r2 => { const t0 = Date.now(); proxiedGet(px, PX_PROBE_URL, 4000).then(() => { const ms = Date.now() - t0; r2(ms < 2500 ? { px, ms } : null); }).catch(() => r2(null)); })));
      for (const g of res) if (g) good.push(g);
    }
    good.sort((a, b) => a.ms - b.ms);
    const base = POOL.slice(0, Math.min(17, POOL.length)), rest = POOL.slice(base.length);
    const next = base.slice(); const seen = new Set(next.map(c => c.px)); let n = 0;
    for (const g of good) { if (next.length >= PX_CAP) break; if (!seen.has(g.px)) { seen.add(g.px); next.push(g); n++; } }
    for (const c of rest) { if (next.length >= PX_CAP) break; if (!seen.has(c.px)) { seen.add(c.px); next.push(c); } }
    POOL.length = 0; for (const c of next) POOL.push(c);
    if (n) savePool();
    console.log('[enrich] +' + n + ' (মোট ' + POOL.length + ')');
  } catch (e) { } finally { training = false; }
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const jout = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/health') return jout(200, { ok: 1, version: VERSION, pool: POOL.length, spaces: Object.fromEntries(Object.keys(SPACES).map(k => [k, SPACES[k].set.size])), up: Math.floor(process.uptime()) });
  if (u.pathname === '/pool') return jout(200, POOL.map(c => Object.assign({}, c, PX_RUN.get(c.px) || {}, { sp: Object.keys(SPACES).filter(k => SPACES[k].set.has(c.px)) })));
  if (u.pathname === '/pick') { const src = u.searchParams.get('src') || 'api'; const n = Math.min(12, Number(u.searchParams.get('n')) || 5);
    const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
    const S = space(src); const own = srt.filter(c => S.set.has(c.px)); const rest = srt.filter(c => !S.set.has(c.px));
    return jout(200, { src, pick: own.concat(rest).slice(0, n).map(c => ({ px: c.px, ms: c.ms || null, own: S.set.has(c.px) })) }); }
  if (u.pathname === '/fetch') {
    const url = u.searchParams.get('url'); const src = u.searchParams.get('src') || 'api'; const ms = Math.min(12000, Number(u.searchParams.get('ms')) || 8000); const n = Math.min(8, Number(u.searchParams.get('n')) || 4);
    if (!url || !/^https?:\/\//.test(url)) return jout(400, { ok: 0, err: 'url?' });
    const t0 = Date.now();
    return racePool(url, n, ms, src).then(w => jout(200, { ok: 1, body: String(w.body || '').slice(0, 2097152), px: w.px, ms: w.ms, el: Date.now() - t0 }))
      .catch(e => jout(200, { ok: 0, err: String(e && e.message || e).slice(0, 60), el: Date.now() - t0 })); // ব্যর্থতাও-200-এ-সৎ-রায় (ক্লায়েন্ট-সহজ)
  }
  if (u.pathname === '/report' && req.method === 'POST') { let b = ''; req.on('data', d => { b += d; if (b.length > 4096) req.destroy(); }); req.on('end', () => { try { const j = JSON.parse(b); if (j.px && /\d+\.\d+\.\d+\.\d+:\d+/.test(j.px)) { pxRec(j.px, !!j.ok, Number(j.ms) || 0, j.src || null); if (!POOL.some(c => c.px === j.px) && j.ok && POOL.length < PX_CAP) { POOL.push({ px: j.px, ms: Number(j.ms) || 1500 }); savePool(); } } } catch (e) { } return jout(200, { ok: 1 }); }); return; }
  jout(404, { err: 'route?' });
});
server.listen(PORT, '0.0.0.0', () => console.log('[poolhub] ' + VERSION + ' on :' + PORT + ' | পুল=' + POOL.length + ' | স্পেস: ' + Object.keys(SPACES).map(k => k + '=' + SPACES[k].set.size).join(' ')));
setTimeout(probePool, 3000).unref(); setInterval(probePool, 180000).unref();
setTimeout(() => { const loop = () => setTimeout(() => { Promise.resolve(wave()).catch(() => { }).finally(loop); }, 8000); loop(); }, 5000).unref();
setTimeout(enrich, 20000).unref(); setInterval(enrich, 420000).unref();
