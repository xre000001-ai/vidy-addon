// PoolHub v1.2 — কেন্দ্রীয়-প্রক্সি-ব্যবস্থাপনা (ইউজারের-পূর্ণ-প্রকল্প-পরিকল্পনা-অনুযায়ী)
// ── মূল-ধারণা: সোর্স-ম্যানেজার-ধ্রুব-ফসল → শর্তে-ছাঁকনি → প্রতি-অ্যাপ/ইউজারের-আলাদা-স্পেসে-জমা → নিজ-নিজ-API-তে-সরবরাহ
// · সাব-স্পেস (v1.3 গোছানো, পরিকল্পনা §4): toonworld4all·raretoons·vidy·moviebox·multimovies — প্রতি-স্পেসের-নিজ-API-কী (কী=স্পেস-নির্ধারক)
// · ইউজার-স্পেস (পরিকল্পনা §7): টোকেন-চিহ্নিত, প্রত্যেকে-শুধু-নিজের-স্পেস (/my/*)
// · মেয়াদ-উত্তীর্ণ-অপসারণ (পরিকল্পনা §6): ঢেউয়ে-ব্যর্থ=স্পেস-থেকে-নামা, ৬০০সে-নিষ্ক্রিয়=পুল-কাট, ১২০সে-শীতল, স্থায়ী-ফাইলে-১০মিন-TTL
// · প্রক্সি-নীতি (ইউজার, v1.3.3): প্রক্সি=শুধু-IP/জিও-ফ্ল্যাগ-বাইপাস (টোকেন/API/robots/ছোট-ম্যানিফেস্ট-টেক্সট) — মিডিয়া-প্লেব্যাক-কখনো-প্রক্সি-দিয়ে-নয়; প্লেয়ার-সরাসরি-CDN-থেকে-স্ট্রিম-করে। কাঠামোগত-রক্ষা: /fetch-বডি-ক্যাপ=২৫৬KB (মিডিয়া-বাইট-অসম্ভব)
// API: /register /fetch /pick /report /spaces /pool /health (অ্যাপ) · /token /my/conditions /my/space /my/pick /my/fetch (টোকেন-ইউজার)
'use strict';
const http = require('http'), https = require('https'), net = require('net'), tls = require('tls'), crypto = require('crypto');
const fs = require('fs'), path = require('path');
const { URL } = require('url');
const VERSION = '1.3.4';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const PORT = Number(process.env.PORT || 8399);
const PX_CAP = 300, DIR = __dirname;
const POOL_FILE = path.join(DIR, 'vidy_px_pool.json'), SRC_FILE = path.join(DIR, 'vidy_px_sources.json'), COND_FILE = path.join(DIR, 'vidy_px_conditions.json');
const TOK_FILE = path.join(DIR, 'poolhub_tokens.json'), ADMIN_FILE = path.join(DIR, 'poolhub_admin.txt');
const PX_PROBE_URL = 'https://www.google.com/generate_204';
const RTBASE = process.env.RTBASE || 'https://3404d3c5dc63-raretoons.baby-beamup.club'; // রেজলভার-অ্যাপ (tw+rt-উৎস); শর্ত-নয় — শুধু-রেফারেন্স
// অ্যাপ-স্পেস-শর্ত (পরিকল্পনা §5) — /register-এ-যে-কোনো-সময়-বদলানো-যায়; হালকা-URL-পছন্দ (প্রতি-ঢেউয়ে-সব-শর্ত-চলে)
// ── সাব-স্পেস (ইউজারের-গোছানো-কাঠামো): ৫-অ্যাপের-আলাদা-স্পেস — condition-pass=bench-হয়ে-জমা ──
const SUBS = ['toonworld4all', 'raretoons', 'vidy', 'moviebox', 'multimovies'];
const SPACES = {
  toonworld4all: { url: 'https://toonworld4all.me/robots.txt', min: 100, contains: 'wp-admin' }, // আসল-টার্গেট+WordPress-স্বাক্ষর — MITM-echo-জাল-ছাঁকনি
  raretoons: { url: 'https://www.rareanimes.mov/robots.txt', min: 100, contains: 'wp-admin' }, // crawler.py-র-লাইভ-টার্গেট
  vidy: { url: 'https://api.wecollege.net/seed?mediaId=95350', min: 30, contains: '"seed"' }, // vidy-র-আসল-কাজ (seed — আগের site+api-এর-মূল-শর্ত)
  moviebox: { url: '', tokencheck: true, min: 1 }, // v1.3.2 (ইউজার-প্রমাণ: টোকেন-সংগ্রহ-ই-আসল-শর্ত, ৮৩%-পাস): ঢেউয়ে-স্বাক্ষরিত-POST→x-user-JWT-টোকেন-সংগ্রহ — vidy-র-searchVerify-এর-হুবহু-দরজা
  multimovies: { url: 'https://vidbolt.xyz/api/resolve?type=tv&id=1&season=1&episode=1', min: 5 } // আগের vb+wo-এর-মূল-শর্ত
};
const ALIAS = { tw: 'toonworld4all', toonworld: 'toonworld4all', rt: 'raretoons', raretoons: 'raretoons', api: 'vidy', mb: 'moviebox', vb: 'multimovies', wo: 'multimovies' }; // পুরনো-ছোট-নাম-গ্রহণযোগ্য (site-বাদ: ভিন্ন-শর্ত — ঢেউ-পুনঃযাচাই-ই-পথ)
function norm(s) { s = String(s || ''); return ALIAS[s] || s; }
try { const o = JSON.parse(fs.readFileSync(COND_FILE, 'utf8')); for (const k of Object.keys(o)) if (SUBS.includes(k) || String(k).indexOf('u:') === 0) SPACES[k] = Object.assign({}, SPACES[k] || {}, o[k]); } catch (e) { }
for (const k of Object.keys(SPACES)) if (!SPACES[k].set) SPACES[k].set = new Set(), SPACES[k].ts = new Map();
// ── সাব-স্পেস-API-কী (ইউজার: 'Subspace gulor API key thakbe'): প্রতি-অ্যাপ-নিজস্ব-কী, কী=স্পেস-নির্ধারক — কেউ-অন্যের-স্পেস-ছুঁয়ে-না ──
const KEY_FILE = path.join(DIR, 'poolhub_keys.json');
let KEYS = {}; try { KEYS = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch (e) { }
for (const s2 of SUBS) if (!KEYS[s2]) KEYS[s2] = 'psk-' + s2.slice(0, 2) + '-' + crypto.randomBytes(12).toString('hex');
function saveKeys() { try { fs.writeFileSync(KEY_FILE, JSON.stringify(KEYS, null, 1)); } catch (e) { } }
saveKeys();
function spaceByKey(k) { if (!k) return null; for (const s2 of SUBS) if (KEYS[s2] === k) return s2; return null; }
function keyOf(req, u) { return String((req.headers && req.headers['x-poolhub-key']) || '') || (u ? String(u.searchParams.get('key') || '') : ''); }
function isUser(k) { return String(k).indexOf('u:') === 0; }
function space(k) { if (!SPACES[k]) SPACES[k] = { url: '', min: 1, set: new Set(), ts: new Map() }; return SPACES[k]; }
let CT = null;
function saveCond() { if (CT) return; CT = setTimeout(() => { CT = null; const o = {}; for (const k of Object.keys(SPACES)) { const S = SPACES[k]; o[k] = { url: S.url, min: S.min, contains: S.contains || undefined, home: S.home || undefined, homeMin: S.homeMin || undefined, tokencheck: S.tokencheck || undefined }; } try { fs.writeFileSync(COND_FILE, JSON.stringify(o, null, 1)); } catch (e) { } }, 1500); }
const POOL = []; try { for (const c of JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'))) POOL.push(c); } catch (e) { }
const PX_RUN = new Map(), PX_LASTOK = new Map(), PX_COOL = new Map(), PX_MISS = new Map();
try { const o = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8')); const now = Date.now(); for (const sk0 of Object.keys(o)) { const sk = norm(sk0); if (!SUBS.includes(sk)) continue; const S = space(sk); for (const px of Object.keys(o[sk0])) if (now - o[sk0][px] < 600000) { S.set.add(px); S.ts.set(px, o[sk0][px]); } } } catch (e) { }
// ── টোকেন-ব্যবস্থা (পরিকল্পনা §7: চিহ্নিত-ইউজার, প্রত্যেকে-শুধু-নিজের-স্পেস) ──
let TOKENS = {}; try { TOKENS = JSON.parse(fs.readFileSync(TOK_FILE, 'utf8')); } catch (e) { }
let ADMIN = String(process.env.POOLHUB_ADMIN_TOKEN || '');
if (!ADMIN) { try { ADMIN = fs.readFileSync(ADMIN_FILE, 'utf8').trim(); } catch (e) { } if (!ADMIN) { ADMIN = 'ph-' + crypto.randomBytes(12).toString('hex'); try { fs.writeFileSync(ADMIN_FILE, ADMIN); } catch (e) { } } }
function saveTok() { try { fs.writeFileSync(TOK_FILE, JSON.stringify(TOKENS, null, 1)); } catch (e) { } }
function auth(req) { const t = String(req.headers['x-poolhub-token'] || ''); if (!t) return null; if (t === ADMIN) return { name: 'admin', admin: true }; return TOKENS[t] ? Object.assign({ token: t }, TOKENS[t]) : null; }
function userSpace(rec) { return 'u:' + rec.name; }
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
let ST = null;
function saveSrc() { if (ST) return; ST = setTimeout(() => { ST = null; const o = {}; for (const sk of Object.keys(SPACES)) { o[sk] = {}; for (const px of SPACES[sk].set) o[sk][px] = SPACES[sk].ts.get(px) || Date.now(); } try { fs.writeFileSync(SRC_FILE, JSON.stringify(o)); } catch (e) { } }, 3000); }
function savePool() { try { fs.writeFileSync(POOL_FILE, JSON.stringify(POOL)); } catch (e) { } }
function mbToken(px) { // v1.3.2: স্বাক্ষরিত-POST search-suggest → x-user-হেডারে-JWT — টোকেন-পেলে-ms, না-পেলে null (ইউজার: 'moviebox proxy use kore token collect')
  return new Promise(resolve => {
    let pxs = String(px); const ci = pxs.indexOf(':');
    const ts = String(Math.floor(Date.now() / 1000));
    const ct = ts + ',' + crypto.createHash('md5').update(ts.split('').reverse().join('')).digest('hex');
    const body = JSON.stringify({ keyword: 'a', perPage: 1 });
    const sock = net.connect({ host: pxs.slice(0, ci), port: Number(pxs.slice(ci + 1)) || 8080 });
    const to = setTimeout(() => { try { sock.destroy(); } catch (e) { } resolve(null); }, 6000);
    const bail = () => { clearTimeout(to); try { sock.destroy(); } catch (e2) { } resolve(null); };
    sock.once('error', bail);
    sock.once('connect', () => sock.write('CONNECT movieboxonline.net:443 HTTP/1.1\r\nHost: movieboxonline.net:443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]); const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
      sock.removeListener('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(buf.slice(0, i).toString('latin1'))) return bail();
      const tl = tls.connect({ socket: sock, servername: 'movieboxonline.net', rejectUnauthorized: false }, () => {
        tl.write('POST /wefeed-h5api-bff/subject/search-suggest HTTP/1.1\r\nHost: movieboxonline.net\r\nUser-Agent: ' + UA + '\r\nAccept: application/json\r\nContent-Type: application/json\r\nX-Client-Token: ' + ct + '\r\nX-Request-Lang: en\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\nConnection: close\r\n\r\n' + body);
        let ht = '';
        tl.on('data', d2 => { if (ht.indexOf('\r\n\r\n') >= 0) return; ht += d2.toString('latin1'); const j = ht.indexOf('\r\n\r\n'); if (j < 0) return; const head = ht.slice(0, j); const code = parseInt((head.split('\r\n')[0] || '').split(' ')[1] || '0', 10); let xu = ''; for (const ln of head.split('\r\n').slice(1)) { if (ln.toLowerCase().indexOf('x-user:') === 0) xu = ln.slice(7).trim(); } let tok = ''; try { tok = JSON.parse(xu || '{}').token || ''; } catch (e3) { } clearTimeout(to); try { tl.destroy(); } catch (e4) { } resolve(code === 200 && tok ? 1 : null); });
        tl.once('error', bail);
      }); tl.once('error', bail);
    };
    sock.on('data', onData);
  });
}
function dechunk(b) { let o = [], i = 0; while (i < b.length) { const j = b.indexOf('\r\n', i); if (j < 0) break; const s = parseInt(b.slice(i, j).toString('latin1').split(';')[0], 16); if (!s) break; o.push(b.slice(j + 2, j + 2 + s)); i = j + 2 + s + 2; } return Buffer.concat(o); }
function proxiedGet(px, url, timeoutMs, maxBytes) {
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
        tl.on('data', d2 => { if (!hd) { ht += d2.toString('latin1'); const j = ht.indexOf('\r\n\r\n'); if (j < 0) return; hd = true; chunks.push(Buffer.from(ht.slice(j + 4), 'latin1')); ht = ht.slice(0, j); n = chunks[1].length; return; } n += d2.length; chunks.push(d2); if (n > (maxBytes || 262144)) tl.destroy(); }); // v1.3.3 প্রক্সি-নীতি: ২৫৬KB-ক্যাপ — টোকেন/API/ম্যানিফেস্ট-টেক্সট-যথেষ্ট; মিডিয়া-বাইট-কাঠামোগতভাবে-অসম্ভব
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
function rank(aliveSrc) { // স্কোর-সাজ+মৃত-বাদ — রেসের-প্রার্থী-সাধারণ-যন্ত্র
  const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
  return srt.filter(c => { const h = PX_RUN.get(c.px); return aliveSrc ? (SPACES[aliveSrc] && SPACES[aliveSrc].set.has(c.px)) : (!h || h.ok > 0 || h.fail < 3); });
}
function raceList(cands, url, n, timeoutMs, src) { // নির্দিষ্ট-তালিকা-নিয়ে-রেস (ইউজার-স্পেস-বিচ্ছিন্নতার-মূল)
  if (!cands.length) return Promise.reject(new Error('space-empty'));
  const n2 = Math.min(cands.length, n || 4); const use = [];
  for (let i = 0; i < n2; i++) { const c = cands[Math.floor(i * cands.length / n2)]; if (c && !use.some(x => x.px === c.px)) use.push(c); }
  return new Promise((resolve, reject) => {
    let done = false; const to = setTimeout(() => { if (!done) { done = true; reject(new Error('race-timeout')); } }, timeoutMs);
    let fails = 0;
    for (const c of use) { const tP = Date.now();
      proxiedGet(c.px, url, timeoutMs).then(body => { pxRec(c.px, true, Date.now() - tP, src); if (done) return; done = true; clearTimeout(to); resolve({ body, px: c.px, ms: Date.now() - tP }); })
        .catch(() => { pxRec(c.px, false, 0, src); if (++fails === use.length && !done) { done = true; clearTimeout(to); reject(new Error('race-failed')); } });
    }
  });
}
function racePool(url, n, timeoutMs, src) { // অ্যাপ-পথ: নিজ-স্পেস≥৩ → api → site → জীবিত
  const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
  const alive = srt.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; });
  const sb = src && SPACES[src] ? alive.filter(c => SPACES[src].set.has(c.px)) : [];
  const ap = alive.filter(c => SPACES.api && SPACES.api.set.has(c.px));
  const gd = alive.filter(c => SPACES.site && SPACES.site.set.has(c.px));
  const use = sb.length >= 3 ? sb : (ap.length >= 3 ? ap : (gd.length >= 3 ? gd : (alive.length >= 3 ? alive : srt)));
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
let CHK = 0, busy = false; const USED = Object.create(null); // §4: src→খরচ-গণক (/fetch-কে-কোন-অ্যাপ-স্পেস-কতবার-ব্যবহার-করলো)
async function wave() { // v1.2: প্রতি-ঢেউয়ে-সর্বোচ্চ-৪-স্পেস (ঘূর্ণন) × ৩০-প্রক্সি — স্পেস-বাড়লেও-ঢেউ-স্থির; প্রতি-স্পেস-নিয়মিত-কভার
  if (busy || !POOL.length) return; busy = true;
  try {
    const tnow = Date.now();
    const wl = POOL.filter(c => (PX_COOL.get(c.px) || 0) <= tnow).sort((a, b) => (PX_LASTOK.get(a.px) || 0) - (PX_LASTOK.get(b.px) || 0)).slice(0, 30);
    if (!wl.length) return;
    CHK++;
    const SKS = Object.keys(SPACES);
    const pick = []; for (let i = 0; i < Math.min(4, SKS.length); i++) pick.push(SKS[(CHK * 4 + i) % SKS.length]); // ঘূর্ণন-৪-স্পেস
    for (const sk of pick) { const S2 = space(sk); S2.bench = { at: tnow, tried: 0, pass: 0 }; } // §4-দৃশ্যমানতা: প্রতি-ঢেউয়ে-প্রতি-স্পেস-bench-পরিসংখ্যান
    let cok = 0, cnet = 0;
    await Promise.all(wl.map(c => new Promise(r2 => {
      let net = 0, total = 0;
      Promise.all(pick.map(sk => new Promise(r3 => {
        const S = space(sk);
        if (S.tokencheck) { // v1.3.2: টোকেন-সংগ্রহ-বেঞ্চ (robots-নয়)
          const t0 = Date.now();
          mbToken(c.px).then(okms => { const ok2 = !!okms; pxRec(c.px, ok2, ok2 ? Date.now() - t0 : 0, sk); if (S.bench) { S.bench.tried++; if (ok2) S.bench.pass++; } if (ok2) { S.set.add(c.px); S.ts.set(c.px, Date.now()); PX_MISS.delete(c.px); PX_COOL.delete(c.px); cok++; } else { S.set.delete(c.px); } total++; r3(); }).catch(() => { net++; total++; S.set.delete(c.px); r3(); });
          return;
        }
        const u = S.url; const minB = S.min || 1;
        if (!u) return r3();
        const t0 = Date.now();
        proxiedGet(c.px, u, 6000).then(body => {
          const ok = !!body && body.length > minB && (!S.contains || body.indexOf(S.contains) >= 0);
          pxRec(c.px, ok, Date.now() - t0, sk);
          if (S.bench) { S.bench.tried++; if (ok) S.bench.pass++; }
          if (ok) { S.set.add(c.px); S.ts.set(c.px, Date.now()); PX_MISS.delete(c.px); PX_COOL.delete(c.px); cok++; }
          else { S.set.delete(c.px); const m = (PX_MISS.get(c.px) || 0) + 1; if (m >= 2) PX_MISS.set(c.px, 0); else PX_MISS.set(c.px, m); }
          total++; r3();
        }).catch(() => { net++; total++; S.set.delete(c.px); r3(); });
      }))).then(() => {
        saveSrc();
        if (total && net === total) { const t1 = Date.now(); proxiedGet(c.px, PX_PROBE_URL, 4000).then(() => { pxRec(c.px, true, Date.now() - t1); }).catch(() => { pxRec(c.px, false, 0); PX_COOL.set(c.px, Date.now() + 120000); cnet++; }); }
        r2();
      });
    })));
    const t2 = Date.now(); let cut = 0;
    for (let i = POOL.length - 1; i >= 0 && POOL.length > 20; i--) if (t2 - (PX_LASTOK.get(POOL[i].px) || t2) > 600000) { const g = POOL.splice(i, 1)[0]; PX_RUN.delete(g.px); PX_LASTOK.delete(g.px); PX_COOL.delete(g.px); PX_MISS.delete(g.px); for (const sk of SKS) { SPACES[sk].set.delete(g.px); SPACES[sk].ts.delete(g.px); } cut++; saveSrc(); }
    if (cut) { savePool(); setTimeout(enrich, 1500).unref(); }
    if (CHK % 10 === 1) console.log('[wave#' + CHK + '] স্পেস=[' + pick.join(',') + '] প্রক্সি=' + wl.length + ' পাস=' + cok + ' সর্বমৃত=' + cnet + ' পুল=' + POOL.length + ' | ' + SKS.map(k => k + '=' + SPACES[k].set.size).join(' '));
  } finally { busy = false; }
}
let training = false;
async function enrich() {
  if (training) return; training = true;
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
  const body = fn => { let b = ''; req.on('data', d => { b += d; if (b.length > 8192) req.destroy(); }); req.on('end', () => { try { fn(JSON.parse(b || '{}')); } catch (e) { jout(400, { ok: 0, err: 'json?' }); } }); };
  // ── পাবলিক/অ্যাপ-API ──
  if (u.pathname === '/manifest.json') return jout(200, { id: 'community.poolhub', version: VERSION, name: 'PoolHub', description: 'Centralized proxy management — scan → pool(300) → 5 subspaces → 5 API keys (proxy = IP/geo-flag bypass only, never media playback)', types: [], resources: [], catalogs: [] }); // v1.3.4: beamup-lint-অ্যাডন-মুখোশ (পরিষেবা-নিজে-অ্যাডন-নয়)
  if (u.pathname === '/health') return jout(200, { ok: 1, version: VERSION, pool: POOL.length, spaces: Object.fromEntries(Object.keys(SPACES).map(k => [k, SPACES[k].set.size])), used: USED, users: Object.keys(TOKENS).length, up: Math.floor(process.uptime()) });
  if (u.pathname === '/spaces') {
    const kb = keyOf(req, u), ks = spaceByKey(kb);
    if (kb && !ks) return jout(403, { ok: 0, err: 'key?' }); // ভুল-কী=প্রত্যাখ্যান
    if (ks) { const S = SPACES[ks]; return jout(200, { [ks]: { count: S.set.size, condition: { url: S.url, min: S.min }, bench: S.bench || undefined, members: [...S.set] } }); } // অ্যাপ-কী=শুধু-নিজ-স্পেস (বিচ্ছিন্নতা)
    const rec = auth(req); return jout(200, Object.fromEntries(Object.keys(SPACES).map(k => { const S = SPACES[k]; const show = isUser(k) ? (rec && (rec.admin || userSpace(rec) === k)) : true; return [k, { count: S.set.size, condition: show ? { url: S.url, min: S.min } : undefined, bench: S.bench || undefined, members: show ? [...S.set] : undefined, key: rec && rec.admin && !isUser(k) ? KEYS[k] : undefined, user: isUser(k) ? k.slice(2) : undefined }]; })));
  }
  if (u.pathname === '/register' && req.method === 'POST') return body(j => { const kb = keyOf(req, u), ks = spaceByKey(kb); if (kb && !ks) return jout(403, { ok: 0, err: 'key?' }); const src = ks || norm(j.src); if (!src || (!j.url && !j.tokencheck) || (j.url && !/^https?:\/\//.test(j.url))) return jout(400, { ok: 0, err: 'src+url?' }); if (isUser(src)) return jout(403, { ok: 0, err: 'user-space-দিয়ে-/my/conditions' }); const S = space(src); S.url = j.url ? String(j.url) : ''; S.min = Math.max(1, Number(j.min) || 1); if (j.contains) S.contains = String(j.contains); if (j.home) S.home = String(j.home); S.tokencheck = j.tokencheck ? true : undefined; if (S.url && S.tokencheck) S.tokencheck = undefined; saveCond(); console.log('[register] ' + src + (ks ? ' (কী-দ্বারা)' : '') + ' → ' + S.url.slice(0, 60)); return jout(200, { ok: 1, src, spaces: Object.keys(SPACES) }); });
  if (u.pathname === '/pool') return jout(200, POOL.map(c => Object.assign({}, c, PX_RUN.get(c.px) || {}, { sp: Object.keys(SPACES).filter(k => SPACES[k].set.has(c.px) && !isUser(k)) })));
  if (u.pathname === '/pick') { const kb = keyOf(req, u), ks = spaceByKey(kb); if (kb && !ks) return jout(403, { ok: 0, err: 'key?' }); const src = ks || norm(u.searchParams.get('src')) || 'vidy'; const n = Math.min(12, Number(u.searchParams.get('n')) || 5);
    const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
    const S = space(src); const own = srt.filter(c => S.set.has(c.px)); const rest = srt.filter(c => !S.set.has(c.px));
    return jout(200, { src, pick: own.concat(rest).slice(0, n).map(c => ({ px: c.px, ms: c.ms || null, own: S.set.has(c.px) })) }); }
  if (u.pathname === '/fetch') {
    const kb = keyOf(req, u), ks = spaceByKey(kb); if (kb && !ks) return jout(403, { ok: 0, err: 'key?' }); const url = u.searchParams.get('url'); const src = ks || norm(u.searchParams.get('src')) || 'vidy'; const ms = Math.min(12000, Number(u.searchParams.get('ms')) || 8000); const n = Math.min(8, Number(u.searchParams.get('n')) || 4);
    const pxFix = u.searchParams.get('px') || '';
    if (!url || !/^https?:\/\//.test(url)) return jout(400, { ok: 0, err: 'url?' });
    const t0 = Date.now(); USED[src] = (USED[src] || 0) + 1; // §4-ওয়্যারিং-প্রমাণ: কোন-অ্যাপ-স্পেস-কতবার-খরচ-হলো
    if (!space(src).set.size) return jout(200, { ok: 0, err: 'space-empty', src, el: Date.now() - t0 }); // v1.2.4: ফাঁকা-স্পেস=সৎ-দ্রুত-ফেল — কলার-নিজ-ফলব্যাকে-যায় (৯সে-অপেক্ষা-নয়); §2.3-সেমান্টিক: ফেচ=নিজ-স্পেস-থেকেই
    if (pxFix && POOL.some(c => c.px === pxFix)) { const tP = Date.now();
      return proxiedGet(pxFix, url, ms).then(bd => { pxRec(pxFix, true, Date.now() - tP, src); return jout(200, { ok: 1, body: String(bd || '').slice(0, 2097152), px: pxFix, ms: Date.now() - tP, el: Date.now() - t0 }); })
        .catch(e => { pxRec(pxFix, false, 0, src); return jout(200, { ok: 0, err: String(e && e.message || e).slice(0, 60), px: pxFix, el: Date.now() - t0 }); }); }
    return racePool(url, n, ms, src).then(w => jout(200, { ok: 1, body: String(w.body || '').slice(0, 2097152), px: w.px, ms: w.ms, el: Date.now() - t0 }))
      .catch(e => jout(200, { ok: 0, err: String(e && e.message || e).slice(0, 60), el: Date.now() - t0 }));
  }
  if (u.pathname === '/report' && req.method === 'POST') return body(j => { if (j.px && /\d+\.\d+\.\d+\.\d+:\d+/.test(j.px)) { pxRec(j.px, !!j.ok, Number(j.ms) || 0, j.src || null); if (!POOL.some(c => c.px === j.px) && j.ok && POOL.length < PX_CAP) { POOL.push({ px: j.px, ms: Number(j.ms) || 1500 }); savePool(); } } return jout(200, { ok: 1 }); });
  // ── টোকেন-ইউজার-API (পরিকল্পনা §7 — প্রত্যেকে-শুধু-নিজের-স্পেস) ──
  if (u.pathname === '/token' && req.method === 'POST') { const rec = auth(req); if (!rec || !rec.admin) return jout(403, { ok: 0, err: 'admin?' });
    return body(j => { const name = String(j.name || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32); if (!name) return jout(400, { ok: 0, err: 'name?' }); const tok = 'pt-' + crypto.randomBytes(12).toString('hex'); TOKENS[tok] = { name, created: Date.now() }; saveTok(); space(userSpace(TOKENS[tok])); console.log('[token] ইউজর=' + name); return jout(200, { ok: 1, token: tok, space: userSpace(TOKENS[tok]) }); }); }
  if (u.pathname.indexOf('/my/') === 0) {
    const rec = auth(req); if (!rec) return jout(401, { ok: 0, err: 'token?' });
    const sk = userSpace(rec); const S = space(sk);
    if (u.pathname === '/my/conditions' && req.method === 'POST') return body(j => { if (!j.url || !/^https?:\/\//.test(j.url)) return jout(400, { ok: 0, err: 'url?' }); S.url = String(j.url); S.min = Math.max(1, Number(j.min) || 1); if (j.contains) S.contains = String(j.contains); saveCond(); console.log('[my/conditions] ' + rec.name + ' → ' + S.url.slice(0, 60)); return jout(200, { ok: 1, space: sk, condition: { url: S.url, min: S.min, contains: S.contains || null } }); });
    if (u.pathname === '/my/space') return jout(200, { ok: 1, user: rec.name, space: sk, condition: { url: S.url, min: S.min, contains: S.contains || null }, count: S.set.size, members: [...S.set] });
    if (u.pathname === '/my/pick') { const n = Math.min(24, Number(u.searchParams.get('n')) || 8); const own = [...S.set].sort((a, b) => pxScore(a) - pxScore(b)); return jout(200, { ok: 1, user: rec.name, space: sk, pick: own.slice(0, n).map(px => ({ px, ms: (PX_RUN.get(px) || {}).ms || null })) }); }
    if (u.pathname === '/my/fetch') { const url = u.searchParams.get('url'); const ms = Math.min(12000, Number(u.searchParams.get('ms')) || 8000); const n = Math.min(8, Number(u.searchParams.get('n')) || 4);
      if (!url || !/^https?:\/\//.test(url)) return jout(400, { ok: 0, err: 'url?' });
      const own = [...S.set].map(px => ({ px })).filter(c => POOL.some(p => p.px === c.px));
      const t0 = Date.now();
      return raceList(own, url, n, ms, sk).then(w => jout(200, { ok: 1, user: rec.name, body: String(w.body || '').slice(0, 2097152), px: w.px, ms: w.ms, el: Date.now() - t0 }))
        .catch(e => jout(200, { ok: 0, user: rec.name, err: String(e && e.message || e).slice(0, 60), el: Date.now() - t0 })); }
  }
  jout(404, { err: 'route?' });
});
server.listen(PORT, '0.0.0.0', () => console.log('[poolhub] ' + VERSION + ' on :' + PORT + ' | পুল=' + POOL.length + ' | স্পেস: ' + Object.keys(SPACES).map(k => k + '=' + SPACES[k].set.size).join(' ') + ' | কী: ' + KEY_FILE + ' | অ্যাডমিন: ' + ADMIN_FILE));
setTimeout(probePool, 3000).unref(); setInterval(probePool, 180000).unref();
setTimeout(() => { const loop = () => setTimeout(() => { Promise.resolve(wave()).catch(() => { }).finally(loop); }, 8000); loop(); }, 5000).unref();
setTimeout(enrich, 20000).unref(); setInterval(enrich, 420000).unref();
