// Vidy addon — stream-only Stremio/Nuvio addon (vidy.st sources)
// স্থাপত্য: token/seed ফেচে 429-হলে trained-proxy hedge-race; স্ট্রিম-বাইট ইউজার সরাসরি CDN থেকে
// Nuvio/Node-নিরাপদ: AbortSignal নেই — সব টাইমআউট Promise.race/setTimeout-ভিত্তিক
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const VERSION = '1.0.1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const VIDY_REFERER = 'https://www.vidy.st/';
const API = 'https://api.wecollege.net';
const TMDBP = 'https://db.wecollege.net/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const SERVERS = ['miami', 'atlanta', 'seattle', 'boise'];
let POOL = [];
try { POOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_proxy_pool.json'), 'utf8')); } catch (e) {}

// ---------- মেমো + ডিডুপ ----------
const memo = new Map(); // key → {ts, v}
const pending = new Map();
function memoGet(k, ttl) { const h = memo.get(k); return h && (Date.now() - h.ts) < ttl ? h.v : null; }
function memoSet(k, v) { memo.set(k, { ts: Date.now(), v }); if (memo.size > 3000) memo.clear(); }
function dedupe(k, fn) {
  const ex = pending.get(k);
  if (ex) return ex;
  const p = fn().finally(() => pending.delete(k));
  pending.set(k, p);
  return p;
}

// ---------- vidy decrypt (VidyDecrypt.kt-র বাইট-এক্সাক্ট JS-পোর্ট) ----------
const K = 2654435769, A0 = 2779096485;
const imul = (a, b) => Math.imul(a, b) >>> 0;
function rotl(x, r) { const s = r & 31; return s === 0 ? x >>> 0 : (((x << s) | (x >>> (32 - s))) >>> 0); }
function mix(e) {
  let x = e >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; x = imul(x, 2246822507);
  x = (x ^ (x >>> 13)) >>> 0; x = imul(x, 3266489909);
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}
function fnv1a(str) {
  let t = 2166136261;
  const b = Buffer.from(str, 'utf8');
  for (let i = 0; i < b.length; i++) t = imul((t ^ b[i]) >>> 0, 16777619);
  return mix(t);
}
function keystream(seed, tmdbId, len) {
  const s0 = mix((fnv1a(seed) ^ mix((tmdbId >>> 0) ^ K)) >>> 0) >>> 0;
  const S = new Array(61).fill(0);
  const def = new Array(61).fill(false);
  let s = s0;
  for (let e = 0; e < 8; e++) {
    const t = s % 61;
    const sr = rotl((s + K) >>> 0, 7 + (7 & e));
    S[t] = (sr ^ mix(sr)) >>> 0;
    def[t] = true;
    s = mix((sr + t) >>> 0) >>> 0;
  }
  const acc = mix(A0 ^ s) >>> 0;
  const ks = Buffer.alloc(len);
  let n = acc, counter = 0, i = 0;
  while (i < len) {
    const d = n % 61;
    const inner = (S[d] ^ imul(K, counter + 1)) >>> 0;
    const rbit = def[d] ? -1 : 0;
    const l = (((n ^ inner) | (n & inner & rbit)) >>> 0);
    const x = (rotl((l + n) >>> 0, 31 & d) ^ rotl(n, 31 & ((d * 7) & 31))) >>> 0;
    n = mix((x + K) >>> 0) >>> 0;
    S[d] = n; def[d] = true;
    ks[i++] = n & 0xFF;
    if (i < len) ks[i++] = (n >>> 8) & 0xFF;
    if (i < len) ks[i++] = (n >>> 16) & 0xFF;
    if (i < len) ks[i++] = (n >>> 24) & 0xFF;
    counter++;
  }
  return ks;
}
function vidyDecrypt(b64ct, seed, tmdbId) {
  const ct = Buffer.from(b64ct, 'base64url');
  const ks = keystream(seed, tmdbId >>> 0, ct.length);
  for (let i = 0; i < ct.length; i++) ct[i] ^= ks[i];
  if (ct.slice(0, 4).toString('latin1') !== 'mvm1') throw new Error('decrypt failed: bad seed or tampered payload');
  return ct.slice(4).toString('utf8');
}

// ---------- fetch (direct + CONNECT-প্রক্সি) ----------
function directGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(directGet(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 429) return reject(Object.assign(new Error('rate_limited'), { code: 429 }));
        if (res.statusCode !== 200) return reject(Object.assign(new Error('http_' + res.statusCode), { code: res.statusCode }));
        resolve(body);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}
function dechunk(buf) {
  let out = [], i = 0;
  while (i < buf.length) {
    const j = buf.indexOf('\r\n', i);
    if (j < 0) break;
    const size = parseInt(buf.slice(i, j).toString('latin1').split(';')[0], 16);
    if (!size) break;
    out.push(buf.slice(j + 2, j + 2 + size));
    i = j + 2 + size + 2;
  }
  return Buffer.concat(out);
}
function proxiedGet(px, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const ci = px.indexOf(':');
    const phost = px.slice(0, ci), pport = Number(px.slice(ci + 1)) || 8080;
    const sock = net.connect({ host: phost, port: pport });
    const hardTo = setTimeout(() => { sock.destroy(); reject(new Error('proxy-timeout')); }, timeoutMs);
    const bail = e => { clearTimeout(hardTo); try { sock.destroy(); } catch (e2) {} reject(e); };
    sock.once('error', bail);
    sock.once('connect', () => sock.write('CONNECT ' + u.host + ':443 HTTP/1.1\r\nHost: ' + u.host + ':443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      sock.removeListener('data', onData);
      const head = buf.slice(0, i).toString('latin1');
      if (!/^HTTP\/1\.[01] 200/.test(head)) return bail(new Error('proxy-refused'));
      const tl = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
        tl.write('GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: ' + UA + '\r\nAccept: */*\r\nConnection: close\r\n\r\n');
        const chunks = [buf.slice(i + 4)];
        let headTxt = '';
        tl.on('data', d2 => {
          if (!headTxt) { headTxt += d2.toString('latin1'); if (headTxt.indexOf('\r\n\r\n') < 0) return; const j = headTxt.indexOf('\r\n\r\n'); chunks.push(Buffer.from(headTxt.slice(j + 4), 'latin1')); headTxt = headTxt.slice(0, j); }
          else chunks.push(d2);
        });
        tl.on('error', bail);
        tl.on('close', () => {
          clearTimeout(hardTo);
          const raw = Buffer.concat(chunks);
          const body = (/chunked/i.test(headTxt) ? dechunk(raw) : raw).toString('utf8');
          const code = parseInt((headTxt.split('\r\n')[0] || '').split(' ')[1] || '0', 10);
          if (code === 429) return reject(Object.assign(new Error('rate_limited'), { code: 429 }));
          if (code !== 200) return bail(new Error('http_' + code));
          resolve(body);
        });
      });
      tl.once('error', bail);
    };
    sock.on('data', onData);
  });
}
function racePool(url, n, timeoutMs) {
  const cands = POOL.slice(0, n);
  if (!cands.length) return Promise.reject(new Error('pool-empty'));
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; reject(new Error('race-timeout')); } }, timeoutMs);
    let ok = 0, fails = 0;
    for (const c of cands) {
      proxiedGet(c.px, url, timeoutMs).then(body => {
        if (done) return;
        done = true; clearTimeout(to);
        resolve({ body, px: c.px });
      }).catch(() => {
        if (++fails === cands.length && !done) { done = true; clearTimeout(to); reject(new Error('pool-exhausted')); }
      });
    }
  });
}

// ---------- tt → TMDB numeric (keyless) ----------
function findTmdb(imdb, type) {
  const key = 'find:' + imdb + ':' + type;
  const hit = memoGet(key, 86400000);
  if (hit !== null && hit !== undefined) return Promise.resolve(hit);
  return dedupe(key, () => directGet(TMDBP + '/find/' + encodeURIComponent(imdb) + '?external_source=imdb_id', 12000).then(body => {
    const j = JSON.parse(body);
    const r = (type === 'series' ? (j.tv_results || []) : (j.movie_results || []))[0] || null;
    if (r && r.id) { memoSet(key, r.id); return r.id; }
    throw new Error('find-empty');
  }).catch(() =>
    // ফলব্যাক: Cinemeta টাইটেল → keyless search (বছর-মিল-অগ্রাধিকার, না-মিললেও শীর্ষ-১)
    directGet(CINEMETA + '/meta/' + type + '/' + encodeURIComponent(imdb) + '.json', 15000).then(b2 => {
      const m = (JSON.parse(b2).meta || {});
      const name = m.name || '';
      const year = String(m.releaseInfo || m.year || '');
      if (!name) throw new Error('cinemeta-empty');
      return directGet(TMDBP + '/search/' + (type === 'series' ? 'tv' : 'movie') + '?query=' + encodeURIComponent(name), 12000).then(b3 => {
        const list = (JSON.parse(b3).results || []);
        let pick = null;
        for (const x of list) { if (year && String(x.release_date || x.first_air_date || '').slice(0, 4) === year.slice(0, 4)) { pick = x; break; } }
        if (!pick) pick = list[0];
        if (pick && pick.id) { memoSet(key, pick.id); return pick.id; }
        throw new Error('search-empty');
      });
    })
  ).catch(e => { memoSet(key, -1); throw e; })); // নেগেটিভ-ক্যাশ — বারবার-ধীর-ব্যর্থতা-নয়
}

// ---------- seed (direct-first → 429-এ pool-race) ----------
let seedCache = { key: null, seed: null, via: 'direct', px: null, ts: 0 };
function getSeed(tmdbId, force) {
  if (!force && seedCache.seed && seedCache.key === tmdbId && (Date.now() - seedCache.ts) < 20000) {
    return Promise.resolve(seedCache);
  }
  const url = API + '/seed?mediaId=' + tmdbId;
  return directGet(url, 6000).then(b => {
    const j = JSON.parse(b);
    if (!j.seed) throw Object.assign(new Error('seed-empty'), { code: 429 });
    seedCache = { key: tmdbId, seed: j.seed, via: 'direct', px: null, ts: Date.now() };
    return seedCache;
  }).catch(e => {
    if (e.code !== 429 && e.message !== 'seed-empty' && e.message !== 'timeout' && !/proxy|rate|http_5|ECONN|fetch/.test(e.message)) throw e;
    return racePool(url, 5, 9000).then(w => {
      const j = JSON.parse(w.body);
      if (!j.seed) throw new Error('seed-empty-proxy');
      seedCache = { key: tmdbId, seed: j.seed, via: 'proxy', px: w.px, ts: Date.now() };
      return seedCache;
    });
  });
}
function pathGet(url, via, px, timeoutMs) {
  return via === 'proxy' && px ? proxiedGet(px, url, timeoutMs) : directGet(url, timeoutMs);
}

// ---------- sources ----------
function getSources(tmdbId, type, s, e) {
  const key = ['src', tmdbId, type, s || '', e || ''].join('|');
  const hit = memoGet(key, 10800000);
  if (hit) return Promise.resolve(hit);
  return dedupe(key, async () => {
    let lastErr = null;
    let force = false;
    for (const srv of SERVERS) {
      try {
        const sc = await getSeed(tmdbId, force);
        const q = { mediaType: type, tmdbId: String(tmdbId), enc: '2', seed: sc.seed };
        if (type === 'tv') { q.s = String(s); q.e = String(e); }
        const u = API + '/' + srv + '/sources?' + new URLSearchParams(q).toString();
        const ct = await pathGet(u, sc.via, sc.px, 12000);
        const j = JSON.parse(vidyDecrypt(ct, sc.seed, tmdbId));
        if (j.sources && j.sources.length) {
          const out = decorate(j, type, s, e);
          memoSet(key, out);
          return out;
        }
        force = true; // খালি-ফল → seed-হয়তো-একবারই-চলে — পরের-সার্ভারে-তাজা
      } catch (er) { lastErr = er; force = true; }
    }
    throw lastErr || new Error('no-sources');
  });
}
function decorate(j, type, s, e) {
  const headers = { 'User-Agent': UA, 'Referer': VIDY_REFERER };
  const order = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4, 'Auto HLS': 5 };
  const subs = (j.subtitles || []).slice(0, 40).map(x => ({ title: x.label || x.lang || x.language || 'Subtitle', url: x.url || x.file })).filter(x => x.url && /^https?:/.test(x.url));
  const seen = {};
  const cards = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && !seen[x.url] && (seen[x.url] = 1)).sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).map(x => {
    const q = String(x.quality || 'Auto').replace('p', '');
    return {
      name: '\u25eb ' + q.replace('Auto HLS', 'Auto') + ' \u25eb',
      title: '\u29c9 Vidy' + (type === 'tv' ? ' \u00b7 S' + s + 'E' + e : ' \u00b7 Movie') + (subs.length ? ' \u00b7 \u09b8\u09be\u09ac: ' + subs.length : '') + '\n\u2b21 ' + q + (q === 'Auto HLS' ? '' : 'p'),
      quality: q === 'Auto HLS' ? '' : q,
      url: x.url,
      headers: headers,
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
      subtitles: subs
    };
  });
  return cards;
}

// ---------- manifest ----------
function manifest() {
  return {
    id: 'community.xre.vidy',
    version: VERSION,
    name: 'Vidy',
    description: 'Korean/Chinese drama & movies via Vidy — up to 4K, subtitles. Token-fetch uses trained-proxy rotation on rate-limit; streams play direct.',
    author: 'xre000001-ai',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    background: 'https://images.metahub.space/background/medium/tt0903747/bg'
  };
}

// ---------- HTTP ----------
const reqLog = [];
function logReq(path, ms, n, err) {
  reqLog.push({ t: new Date().toISOString().slice(11, 19), path: path.slice(0, 60), ms, n, err: err || undefined });
  if (reqLog.length > 40) reqLog.shift();
}
function sendJson(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(b);
}
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    if (p === '/manifest.json') return sendJson(res, 200, manifest());
    if (p === '/_health') return sendJson(res, 200, { ok: 1, version: VERSION, pool: POOL.length, memo: memo.size });
    if (p === '/_pool') return sendJson(res, 200, POOL);
    if (p === '/_log') return sendJson(res, 200, reqLog.slice(-40).reverse());
    let m;
    if ((m = p.match(/^\/stream\/movie\/(tt\d+)\.json$/))) {
      const t0 = Date.now();
      return findTmdb(m[1], 'movie').then(id => (id && id > 0) ? getSources(id, 'movie') : Promise.resolve([])).then(
        cards => { logReq(p, Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+):(\d+):(\d+)\.json$/))) {
      const t0 = Date.now();
      return findTmdb(m[1], 'series').then(id => (id && id > 0) ? getSources(id, 'tv', Number(m[2]), Number(m[3])) : Promise.resolve([])).then(
        cards => { logReq(p, Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+)\.json$/))) { // সেফটি-নেট: s:e-ছাড়া কল → S1E1
      const t0 = Date.now();
      return findTmdb(m[1], 'series').then(id => (id && id > 0) ? getSources(id, 'tv', 1, 1) : Promise.resolve([])).then(
        cards => { logReq(p + ' [no-s:e]', Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p + ' [no-s:e]', Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) { sendJson(res, 500, { error: String(e && e.message) }); }
});
const PORT = Number(process.env.PORT || 7000);
server.listen(PORT, '0.0.0.0', () => console.log('[vidy] ' + VERSION + ' on :' + PORT + ' | pool=' + POOL.length));

// ---------- selftest ----------
if (process.argv[2] === 'selftest') {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'test_fixture.json'), 'utf8'));
  try {
    const j = JSON.parse(vidyDecrypt(fx.ct, fx.seed, 1396));
    const ok = j.sources.length === fx.sources && j.sources[0].url.slice(0, fx.first_url.length) === fx.first_url;
    console.log(ok ? 'selftest ✓ (JS-decrypt byte-exact: ' + j.sources.length + ' sources)' : 'selftest ✗ MISMATCH');
    process.exit(ok ? 0 : 1);
  } catch (e) { console.log('selftest ✗', e.message); process.exit(1); }
}
module.exports = { vidyDecrypt, getSources, findTmdb, _internal: { keystream, mix, fnv1a } };
