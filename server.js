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

const VERSION = '1.11.4';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const VIDY_REFERER = 'https://www.vidy.st/';
const API = 'https://api.wecollege.net';
const TMDBP = 'https://db.wecollege.net/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const SERVERS = ['miami', 'atlanta', 'seattle', 'boise', 'phoenix', 'dallas', 'austin', 'delhi', 'munich', 'cancun', 'vegas', 'oakland', 'orlando', 'paris', 'reno', 'tampa']; // full server family — 7 veterans + 9 discovered from the official player bundle (live-probed)
const GIANT = ['miami', 'boise', 'atlanta']; // giant primaries — carry ~32 sources across a 12-title sample (new servers top out at ~13, measured 10-11 Oct 2026)
let POOL = [];
try { POOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_proxy_pool.json'), 'utf8')); } catch (e) {}

// ---------- মেমো + ডিডুপ ----------
const memo = new Map(); // key → {ts, v}
const memoShort = new Map(); // আংশিক-ফলের-৬০সে-ক্যাশ — স্ট্যাম্পিড-আটকায়, দ্রুত-নিজে-ই-সেরে-ওঠে
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
const HAGENT = new http.Agent({ keepAlive: true, maxSockets: 32 }); // কানেকশন-পুনঃব্যবহার — ঠান্ডা-কল-দ্রুত
const SAGENT = new https.Agent({ keepAlive: true, maxSockets: 32 });
const HAGENTP = new http.Agent({ keepAlive: false, maxSockets: 16 }); // প্রোব-একবার-ই-চলে — ক্লিন-ক্লোজ
const SAGENTP = new https.Agent({ keepAlive: false, maxSockets: 16 });
function directGet(url, timeoutMs, _re) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: timeoutMs, agent: u.protocol === 'http:' ? HAGENT : SAGENT }, res => {
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
    req.on('error', e => {
      // keep-alive-সকেট-নিঃশব্দে-মরলে (NAT/মিডলবক্স) নতুন-সকেট-দিয়ে-এক-বার-অটো-পুনঃচেষ্টা:
      if (req.reusedSocket && !_re && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) return resolve(directGet(url, timeoutMs, 1));
      reject(e);
    });
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
  // v1.11.2: সুস্থতা-ব্যান্ড-জুড়ে-ছড়ানো-নমুনা — আগে-তালিকার-প্রথম-n-টা-নিত; ওই-৫টা-একসাথে-মৃত-থাকলে
  // বাকি ১৯-সুস্থ-px-থাকতেও-পুরো-পুল 'pool-exhausted' ঘোষিত-হত ( BreakingBad-runে-ঠিক-তা-ই-হয়েছিল)
  const srt = POOL.slice().sort((a, b) => (a.ms || 9999) - (b.ms || 9999));
  const cands = [];
  for (let i = 0; i < n && srt.length; i++) {
    const c = srt[Math.floor(i * srt.length / n)];
    if (c && !cands.some(x => x.px === c.px)) cands.push(c);
  }
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

// ---------- catalog/search (keyless TMDB) ----------
function tmdbMeta(x, type) {
  const base = {
    type: type === 'tv' ? 'series' : 'movie',
    name: x.name || x.title || '',
    poster: x.poster_path ? 'https://image.tmdb.org/t/p/w300' + x.poster_path : undefined,
    description: (x.overview || '').slice(0, 200) || undefined,
    releaseInfo: String(x.first_air_date || x.release_date || '').slice(0, 4) || undefined
  };
  if (!base.name || !x.id) return null;
  return directGet(TMDBP + '/' + (type === 'tv' ? 'tv/' : 'movie/') + x.id + '/external_ids', 10000).then(b => {
    const e = JSON.parse(b);
    return e.imdb_id ? Object.assign({}, base, { id: e.imdb_id }) : Object.assign({}, base, { id: 'tmdb' + x.id });
  }).catch(() => Object.assign({}, base, { id: 'tmdb' + x.id })); // থ্রটল-হলেও ক্যাটালগ-মরবে-না (tmdb-নেটিভ-আইডি)
}
function catalogMeta(type, q, cfg, gn, skip) {
  cfg = cfg || DEFAULT_CFG;
  const gid = genreIds(type, gn);
  let url;
  let cap = 14;
  if (q) {
    url = TMDBP + '/search/' + type + '?language=en-US&query=' + encodeURIComponent(q);
  } else if (gid.length || cfg.lang || cfg.era || cfg.sort !== 'pop' || skip) {
    // keyless-প্রক্সি with_genres ব্লক-করে → ৪-পেজ-আনিয়ে genre_ids দিয়ে লোকাল-ফিল্টার
    const qs = [];
    if (cfg.lang) qs.push('with_original_language=' + cfg.lang);
    if (cfg.sort === 'top') { qs.push('sort_by=vote_average.desc'); qs.push('vote_count.gte=80'); }
    else if (cfg.sort === 'new') qs.push('sort_by=' + (type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc'));
    else qs.push('sort_by=popularity.desc');
    if (cfg.era) qs.push((type === 'tv' ? 'first_air_date.gte=' : 'primary_release_date.gte=') + cfg.era + '-01-01');
    const base = TMDBP + '/discover/' + type + '?language=en-US&' + qs.join('&');
    const p0 = 1 + Math.floor((skip || 0) / 20); // জনর-মোডেও-স্ক্রল-পেজিনেশন (৪-পেজ-জানালা)
    const pages = gid.length ? [p0, p0 + 1, p0 + 2, p0 + 3] : [p0];
    const one = () => Promise.all(pages.map(p =>
      directGet(base + '&page=' + p, 14000).then(b => (JSON.parse(b).results || []), () => [])
    )).then(lists => {
      let all = [].concat.apply([], lists);
      if (gid.length) all = all.filter(x => gid.every(gi => (x.genre_ids || []).indexOf(gi) !== -1));
      return Promise.all(all.slice(0, cap).map(x => tmdbMeta(x, type))).then(arr => arr.filter(Boolean));
    });
    return one().catch(() => new Promise(r => setTimeout(r, 900)).then(one)); // থ্রটল-এ-১-রিট্রি
  } else {
    url = TMDBP + '/' + (type === 'tv' ? 'tv/top_rated' : 'movie/popular') + '?language=en-US';
  }
  const one = () => directGet(url, 14000).then(b => {
    const list = (JSON.parse(b).results || []).slice(0, cap);
    return Promise.all(list.map(x => tmdbMeta(x, type))).then(arr => arr.filter(Boolean));
  });
  return one().catch(() => new Promise(r => setTimeout(r, 900)).then(one)); // থ্রটল-এ-১-রিট্রি
}

// ---------- tt → TMDB numeric (keyless) ----------
function findTmdbInfo(imdb, type) {
  const key = 'find:' + imdb + ':' + type;
  const hit = memoGet(key, 86400000);
  if (hit) return Promise.resolve(hit);
  if (memoGet(key + ':empty', 1800000)) return Promise.reject(new Error('find-empty-cached')); // নিশ্চিত-খালি → ৩০মিন-মাত্র
  return dedupe(key, () => directGet(TMDBP + '/find/' + encodeURIComponent(imdb) + '?external_source=imdb_id', 12000).then(body => {
    const j = JSON.parse(body);
    const r = (type === 'series' ? (j.tv_results || []) : (j.movie_results || []))[0] || null;
    if (r && r.id) { const v = { id: r.id, name: r.name || r.title || '' }; memoSet(key, v); return v; }
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
        if (pick && pick.id) { const v = { id: pick.id, name: pick.name || pick.title || name }; memoSet(key, v); return v; }
        throw new Error('search-empty');
      });
    })
  ).catch(e => { if (e && e.message === 'find-empty') memoSet(key + ':empty', 1); throw e; })); // নেগেটিভ-ক্যাশ-শুধু-নিশ্চিত-খালিতে; নেটওয়ার্ক/429-এ-কখনো-নয়
}
function findTmdb(imdb, type) { return findTmdbInfo(imdb, type).then(v => v.id); }
function nameForTmdb(tmdbId, type) {
  const key = 'nm:' + type + ':' + tmdbId;
  const hit = memoGet(key, 86400000);
  if (hit) return Promise.resolve(hit);
  if (memoGet(key + ':neg', 600000)) return Promise.resolve(''); // ব্যর্থ-লুকআপ-মাত্র-১০মিন — দিনভর-'Vidy'-টাইটেল-নয়
  return dedupe(key, () => directGet(TMDBP + '/' + (type === 'series' ? 'tv/' : 'movie/') + tmdbId, 10000).then(b => {
    const j = JSON.parse(b);
    const v = j.name || j.title || '';
    memoSet(key, v);
    return v;
  }).catch(() => { memoSet(key + ':neg', 1); return ''; }));
}

// ---------- seed (direct-first → 429-এ pool-race) ----------
let seedCache = { key: null, seed: null, via: 'direct', px: null, ts: 0 };
let seedInflight = null; // প্যারালাল-জোড়ায়-এক-ই-সিড-কল-শেয়ার-হোক
function hedge2(f0, f1, delayMs, hardMs) { // প্রথম-সফল-উত্তর-জয়ী; দুটোই-ব্যর্থ → reject; হারায়নি-একটাও-বাদ
  return new Promise((resolve, reject) => {
    let done = false;
    const win = v => { if (!done) { done = true; resolve(v); } };
    const die = () => { if (!done) { done = true; reject(new Error('hedge-dead')); } };
    f0().then(win, () => {});
    setTimeout(() => f1().then(win, () => {}), delayMs);
    setTimeout(die, hardMs);
  });
}
function getSeed(tmdbId, force) {
  if (!force && seedCache.seed && seedCache.key === tmdbId && (Date.now() - seedCache.ts) < 45000) { // বিংগে-বান্ধব — সিড-পুনর্ব্যবহার
    return Promise.resolve(seedCache);
  }
  if (!force && seedInflight && seedInflight.key === tmdbId && (Date.now() - seedInflight.ts) < 8000) return seedInflight.p;
  const url = API + '/seed?mediaId=' + tmdbId;
  const p = (async () => {
    try {
      const b = await directGet(url, 6000);
      const j = JSON.parse(b);
      if (!j.seed) throw Object.assign(new Error('seed-empty'), { code: 429 });
      seedCache = { key: tmdbId, seed: j.seed, via: 'direct', px: null, ts: Date.now() };
      return seedCache;
    } catch (e) {
      if (e.code !== 429 && e.message !== 'seed-empty' && e.message !== 'timeout' && !/proxy|rate|http_5|ECONN|fetch/.test(e.message)) throw e;
      const w = await racePool(url, 5, 9000);
      const j = JSON.parse(w.body);
      if (!j.seed) throw new Error('seed-empty-proxy');
      seedCache = { key: tmdbId, seed: j.seed, via: 'proxy', px: w.px, ts: Date.now() };
      return seedCache;
    }
  })();
  seedInflight = { key: tmdbId, p, ts: Date.now() };
  return p;
}
function pathGet(url, via, px, timeoutMs) {
  return via === 'proxy' && px ? proxiedGet(px, url, timeoutMs) : directGet(url, timeoutMs);
}

// ---------- NetHex parallel source (separate source; NEXBASE env, empty = off) ----------
// vidy servers + NetHex (MovieBox direct-MP4) run in parallel; NetHex cards (♧, distinct style)
// are appended after the vidy cards. Any NetHex failure/timeout/slow = vidy cards alone, never an error.
const NEXBASE = (process.env.NEXBASE || '').replace(/\/$/, '');
const NXDEADLINE = Number(process.env.NXDEADLINE || 20000); // absolute cap for the whole call
const NXEXTRA = Number(process.env.NXEXTRA || 1000); // vidy answered from cache -> hold at most this for NetHex (cache-hit calls must stay instant)
const NXCOLDX = Number(process.env.NXCOLDX || 4000); // vidy did a cold scan -> NetHex rode the scan in parallel, so it earned a longer hold on the FIRST cold request
const NXHARD = Number(process.env.NXHARD || 11200); // absolute response deadline — worst case must stay under the ~12s gateway cut
const NXCACHE = new Map(); // nx:imdb:s:e -> {ts, v} — NetHex links are signed/fresh + it caches 30min itself
async function nxStreams(imdb, type, s, e) {
  if (!NEXBASE || !imdb) return [];
  const k = 'nx:' + imdb + ':' + (type === 'series' ? (s || 1) + ':' + (e || 1) : 'm');
  const h = NXCACHE.get(k);
  if (h && (Date.now() - h.ts) < 1800000) return h.v;
  try {
    const path2 = type === 'series' ? encodeURIComponent(imdb + ':' + (s || 1) + ':' + (e || 1)) : encodeURIComponent(imdb);
    const t3 = Date.now();
    const b = await directGet(NEXBASE + '/stream/' + type + '/' + path2 + '.json', 25000);
    if (process.env.VDBG) console.error('[nxdbg] nethex ' + type + '/' + path2 + ' -> ' + (Date.now() - t3) + 'ms');
    // v1.11.4: সব-সোর্সের-কার্ড-এক-ফরম্যাটে — ◫ QUALITY · SOURCE ◫ / ⧉ Title / ⬡ SsEe · Subs: n
    // (vidy-কার্ডে-server-বসে, MovieBox-কার্ডে-source-নামটাই-ওই-ঘরে; ভাষা-তথ্য ⬡-লাইনে)
    const arr = (JSON.parse(b).streams || []).filter(x => x && typeof x.url === 'string' && /^https?:/.test(x.url)).map(x => {
      const q2 = (/(\d{3,4})p/.exec(String(x.name || '')) || [])[1] || 'Auto';
      const lang = String(x._lang || '').replace(/\s*dub\s*$/i, '').trim();
      const dub = (!lang || /^original/i.test(lang)) ? '' : ' \u00b7 ' + lang;
      const nSub = Number((/\u27e1\s*(\d+)\s*SUB/.exec(String(x.description || '')) || [])[1]) || 0;
      const raw = (String(x.name || '').split('\u2739')[1] || '').replace(/\s*S\d+\s*-\s*S\d+.*$/i, '').trim() || 'MovieBox';
      const H2 = { 'User-Agent': UA, 'Referer': 'https://movieboxonline.net/' };
      const line2 = (type === 'series' ? 'S' + (s || 1) + 'E' + (e || 1) : 'Movie') + dub + (nSub ? ' \u00b7 Subs: ' + nSub : '');
      const txt = '\u29c9 ' + raw + '\n\u2b21 ' + line2;
      return {
        name: '\u25eb ' + q2 + ' \u00b7 MovieBox \u25eb',
        title: txt,
        description: txt,
        quality: q2 === 'Auto' ? '' : q2,
        _lang: lang,
        url: String(x.url),
        headers: H2,
        behaviorHints: { notWebReady: false, proxyHeaders: { request: Object.assign({}, H2, { 'Origin': 'https://movieboxonline.net' }) } }
      };
    });
    if (arr.length) { // empty is NEVER cached — a rate-limited/slow NetHex window must not poison the key for 30min (same rule as inside NetHex itself); the next tap re-fetches
      if (NXCACHE.size > 300) NXCACHE.clear();
      NXCACHE.set(k, { ts: Date.now(), v: arr });
    }
    return arr;
  } catch (e2) { if (process.env.VDBG) console.error('[nxdbg] nethex ERR: ' + String(e2 && e2.message).slice(0, 80)); return []; } // NetHex down/slow/empty → silently nothing, vidy never breaks
}
const T2IFLIGHT = new Map(); // dedupe concurrent tmdb→imdb translations (tap + prewarm share one mirror call)
async function tmdbToImdb(tmdbId, type) { // NetHex is tt-only — translate tmdb-native ids through the mirror
  const k = 't2i:' + type + ':' + tmdbId;
  const hit = memoGet(k, 86400000);
  if (hit) return hit;
  const fl = T2IFLIGHT.get(k);
  if (fl) return fl;
  const pr = (async () => {
    try {
      const b = await directGet(TMDBP + '/' + (type === 'tv' || type === 'series' ? 'tv/' : 'movie/') + tmdbId + '/external_ids', 10000);
      const v = JSON.parse(b).imdb_id || '';
      if (v) memoSet(k, v);
      return v;
    } catch (e) { return ''; }
    finally { T2IFLIGHT.delete(k); }
  })();
  T2IFLIGHT.set(k, pr);
  return pr;
}
function nxFor(type, id, s, e) { // starts the parallel fetch immediately; null when source is off
  if (!NEXBASE) return null;
  if (/^tt\d+$/.test(id)) return nxStreams(id, type, s, e);
  return tmdbToImdb(id, type).then(v => v ? nxStreams(v, type, s, e) : []);
}
function nxPrewarm(type, id, s, e) { // series tap → quietly fetch the next 3 episodes' NetHex into NXCACHE (binge tap-2 = instant)
  if (!NEXBASE) return;
  // v1.11.2: মূল-ট্যাপের-resolve-পুল-থেকে-প্রথম-কামড়-নেয় (সঙ্গে-সঙ্গে-৪-resolve-প্লাবন-ঠান্ডা-E1-ধীর-করত) — ৯০০ms-দেরি
  setTimeout(() => {
    for (let k = 1; k <= 3; k++) {
      nxFor(type, id, s, e + k).catch(() => {});
    }
  }, 900);
}
async function withNx(cardsP, nxP, cfg, t0) {
  // v1.11.2: vidy-মেটা/স্ক্যান-মরলেও (cinemeta-empty / srv-budget / ৪২৯-ঝড়) nx-আর-অনাথ-নয় —
  // ফাঁকা-কার্ড-নিয়ে-nx-hold-তার-সম্পূর্ণ-বরাদ্দ-পায় (Westworld-tapে ১.৪সে-তে-ফাঁকা-উত্তর-গেছিল, nx ৯.৮সে-তে-১০-কার্ড-নিয়ে-এসেছিল-নষ্ট-হয়ে)
  const cards = await cardsP.catch(e => { if (process.env.VDBG) console.error('[nxdbg] cardsP died: ' + String(e && e.message || e).slice(0, 90) + (e && e.stack ? ' | ' + String(e.stack).split('\n')[1].trim().slice(0, 90) : '')); return []; });
  if (!nxP || (cfg && cfg.nx === 0)) return cards; // nx disabled per-source → zero hold, zero cards
  try {
    const el = Date.now() - t0;
    if (process.env.VDBG) console.error('[nxdbg] withNx el=' + el + 'ms grace-pending');
    // FIRST-COLD-REQUEST goal: everything resolves on tap-1. NetHex starts with the vidy scan,
    // so on a cold call it already had `el` ms — the hold tops it up toward the hard deadline.
    // vidy answered from cache (<400ms) -> instant-path: only NXEXTRA (a cold NetHex resolve
    // catches the next tap via its own background re-resolve + cache).
    // v1.11.3: কার্ড-একদম-শূন্য (v=0 nx-only মোড, বা vidy কিছু-পায়নি) → NXEXTRA-র ১সে-নয়,
    // সম্পূর্ণ-হার্ড-বাজেট-ধরে-রাখো — nx-only-ব্যবহারকারীর-প্রথম-ঠান্ডা-ট্যাপ-কখনো-গ্যারান্টেড-ফাঁকা-ফেরত-পাবে-না
    const grace = cards.length === 0 ? Math.max(0, NXHARD - el) : (el < 400 ? NXEXTRA : Math.max(0, Math.min(NXCOLDX, NXHARD - el)));
    const left = Math.max(0, Math.min(NXDEADLINE, el + grace) - el);
    const nx = await Promise.race([nxP.then(v => { if (process.env.VDBG) console.error('[nxdbg] nxP resolved: ' + (v || []).length + ' cards at ' + (Date.now() - t0) + 'ms'); return v; }).catch(() => []), new Promise(r => setTimeout(() => { if (process.env.VDBG) console.error('[nxdbg] nxP TIMED OUT at ' + (Date.now() - t0) + 'ms'); r(null); }, Math.max(0, left)))]);
    if (nx && nx.length) {
      // v1.11.3 per-source filters: NetHex answers to nxq/nxl (its OWN chips), NOT the vidy-side q
      const nxAllow = qToList(cfg && cfg.nxq);
      const nxSel = Array.isArray(cfg && cfg.nxl) ? cfg.nxl : [];
      return cards.concat(nx.filter(x => qPass(x, nxAllow) && nxLangPass(x, nxSel))); // appended last
    }
  } catch (e) { if (process.env.VDBG) console.error('[nxdbg] withNx ERR: ' + String(e && e.message).slice(0, 80) + ' @ ' + String(e && e.stack).split('\n')[1].trim().slice(0, 100)); }
  return cards;
}

// ---------- sources ----------
// সার্ভার-স্কোর: যেটা-ভালো-চলে-সেটাই-সবসময়-আগে (ফাইলে-জমে — রিস্টার্টেও-মনে-থাকে):
const SRV_SCORE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_server_scores.json'), 'utf8')); } catch (e) { return {}; } })();
const SRV_CACHE = new Map(); // [srvc|VERSION|tmdb|type|s|e|srv] → {ts, j, ok, ns} — ফিল্টার-ভ্যারিয়েন্ট-আর-স্ক্যান-পুনরাবৃত্তি-করে-না
const SRV_NEG = new Map(); // বাড়তি-সার্ভারের-সাম্প্রতিক-ব্যর্থতা (৯০সে) — ভ্যারিয়েন্ট-যেন-একই-মরা-সার্ভারে-বাজেট-না-পোড়ায়
function srvBump(srv, d) {
  SRV_SCORE[srv] = Math.max(-20, Math.min(20, (SRV_SCORE[srv] || 0) + d));
  try { fs.writeFileSync(path.join(__dirname, 'vidy_server_scores.json'), JSON.stringify(SRV_SCORE)); } catch (e) {}
}
const srvOrder = () => SERVERS.slice().sort((a, b) => (SRV_SCORE[b] || 0) - (SRV_SCORE[a] || 0));
// প্রথম-সোর্স-URL-বাঁচা-কি-না (master-m3u8-ছোট — সস্তা-GET; Referer-ছাড়া-CDN-403-দেয়):
function probeAny(urls) { // প্রথম-জীবিত-রায়-সঙ্গে-সঙ্গে-জয়ী; সব-ব্যর্থ-হলেই-মৃত
  return new Promise(resolve => {
    let left = urls.length, settled = false;
    urls.forEach(u => playable(u).then(v => {
      if (settled) return;
      if (v) { settled = true; resolve(true); }
      else if (--left === 0) { settled = true; resolve(false); }
    }));
  });
}
function playable(u, hop) {
  if (!u || !/^https?:/.test(u)) return Promise.resolve(false);
  return new Promise(resolve => {
    const mod = u.indexOf('http:') === 0 ? http : https;
    const req = mod.get(u, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': VIDY_REFERER, 'Connection': 'close' }, timeout: 3500, agent: u.protocol === 'http:' ? HAGENTP : SAGENTP }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hop || 0) < 2) { // a redirect is served by a live server — follow it
        const loc = new URL(res.headers.location, u).toString();
        res.resume();
        return resolve(playable(loc, (hop || 0) + 1));
      }
      const ok = res.statusCode === 200;
      res.destroy(); // শুধু-স্ট্যাটাস-দরকার — প্লেলিস্ট-বডি (৩০০KB-পর্যন্ত) টানা-বৃথা
      resolve(ok);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve(false));
  });
}
function getSources(tmdbId, type, s, e, title, cfg, titleP) { // titleP: টাইটেলের-প্রমিস — sources-সমান্তরালে-ছোটা-হয়
  const qsig = (Array.isArray(cfg && cfg.q) ? cfg.q.slice().sort((a, b) => a - b).join('.') : String((cfg && cfg.q) || '')) + ':' + ((cfg && cfg.sub) === 0 ? 0 : 1) + ':' + ((cfg && Array.isArray(cfg.srv) && cfg.srv.length) ? cfg.srv.slice().sort().join('.') : '');
  const key = ['src', VERSION, tmdbId, type, s || '', e || '', qsig].join('|'); // VERSION+cfg-ভার্সনড — ভিন্ন-ফিল্টার-ভিন্ন-ক্যাশ
  const hit = memoGet(key, 10800000);
  if (hit) return Promise.resolve(hit);
  const hitS = memoShort.get(key);
  if (hitS && (Date.now() - hitS.ts) < 60000) return Promise.resolve(hitS.v);
  return dedupe(key, async () => {
    let lastErr = null;
    let force = false;
    let bestFit = null; let bestFitSrv = null; let bestFitN = -1; let bestFitNs = -1; // আগে-সাব-সমৃদ্ধতা (মূল-অডিও), টাইতে-বেশি-কার্ড
    const nsB = n => Math.min(n, 5); // সাব-বাকেট (৪০-সাব-আর-৩১-সাব-সমান-মর্যাদা)
    let bestAny = null; let bestAnySrv = null; let bestAnyNs = -1; // সবচেয়ে-সাবসমৃদ্ধ (মূল-অডিওর-চিহ্ন)
    let deadJ = null;
    let deadSrv = null;
    const t0 = Date.now();
    // v1.11.2: seed-আগেই-একবার (আগেও-প্রতিটা-one()-এর-প্রথম-await-এই-এক-ই-ছিল — লেটেন্সি-অপরিবর্তিত);
    // পথ-জানা-হলে-বাজেট-পথ-অনুযায়ী: প্রক্সি-চেইন (৪২৯-উইন্ডো) ধীর-কিন্তু-জীবন্ত — বাজেট-প্রশস্ত-না-হলে ৪.৭-৬.৩সে-র-সফল-ফেচ-বাদ-পড়ত
    const sc0 = await getSeed(tmdbId, false).catch(() => null);
    const viaProxy = !!(sc0 && sc0.via === 'proxy');
    const ckFor = srv => ['srvc', VERSION, tmdbId, type, s || '', e || '', srv].join('|');
    const allow = srvOrder().filter(srv => !cfg || !Array.isArray(cfg.srv) || !cfg.srv.length || cfg.srv.indexOf(srv) >= 0); // cfg-সার্ভার-সাবসেট
    const one = async (srv, negBypass) => {
      const ck = ['srvc', VERSION, tmdbId, type, s || '', e || '', srv].join('|');
      const ch = SRV_CACHE.get(ck);
      if (ch && (Date.now() - ch.ts) < 600000) { // ১০মিন-raw-ক্যাশ-হিট → seed/sources/প্রোব-সব-স্কিপ (নেগের-আগে — ক্যাশ-হিট-কখনো-প্রোব-ই-করে-না)
        return { srv, j: ch.j, ok: ch.ok, ns: ch.ns, nfit: ch.ok ? decorate(ch.j, type, s, e, title || '', cfg, srv).length : 0 };
      }
      const nt = SRV_NEG.get(ck);
      if (nt && !negBypass) { // negBypass: the in-call retry re-probes servers that just errored in this same call (their neg was written seconds ago)
        const ttl = GIANT.indexOf(srv) >= 0 ? 45000 : 90000; // giants retry after 45s (per-episode key — fresh episodes always scan live), extras after 90s
        if ((Date.now() - nt) < ttl) return { srv, neg: true };
      }
      // এক-সার্ভার-সম্পূর্ণ-মূল্যায়ন (seed+sources+প্রোব):
      const tS = Date.now(); // try-এর-বাইরে — catch-ও-লগ-দেখাতে-পারে
      try {
        const sc = (sc0 && !force) ? sc0 : await getSeed(tmdbId, force);
        if (process.env.VDBG) console.error('[t1g] ' + srv + ' seed=' + (Date.now() - tS) + 'ms via=' + sc.via);
        const q = { mediaType: type, tmdbId: String(tmdbId), enc: '2', seed: sc.seed, title: title || '' };
        if (type === 'tv') { q.seasonId = String(s || 1); q.episodeId = String(e || 1); } // ভুল-ছিল s/e — upstream-এগুলো-উপেক্ষা-করত → সবসময়-EP1
        const u = API + '/' + srv + '/sources?' + new URLSearchParams(q).toString();
        // v1.11.2 FETCH-HEDGE: আটকে-যাওয়া-আপস্ট্রিম-উত্তরের (phoenix 4.9s, dallas/tampa 7.5s+) +2.5সে-পরে-আরেক-টা-একই-কল;
        // প্রথম-সফল-টা-জেতে, হেরে-যাওয়া-টা-বাদ। প্রতি-সার্ভার-এখনো-এক-স্ক্যান-ফল-দেয়।
        const ct = await hedge2(() => pathGet(u, sc.via, sc.px, 12000), () => pathGet(u, sc.via, sc.px, 12000), 2500, 12500);
        const j = JSON.parse(vidyDecrypt(ct, sc.seed, tmdbId));
        if (process.env.VDBG) console.error('[t1g] ' + srv + ' fetch=' + (Date.now() - tS) + 'ms n=' + (j.sources || []).length);
        if (!j.sources || !j.sources.length) {
          if (process.env.VDBG) console.error('[t1g] ' + srv + ' EMPTY at ' + (Date.now() - tS) + 'ms');
          SRV_NEG.set(ck, Date.now()); // সব-সার্ভার (টিটিএল-ভেদে) — একই-এপিসোডে-বারবার-হাতুড়ে-নয়
          force = true; return { srv, empty: true };
        }
        // v1.9.0 filter-aware probing: never spend probe time on assets the filter will discard.
        const allowD = Array.isArray(cfg && cfg.q) ? cfg.q : qToList(cfg && cfg.q);
        const pass = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && qPass(x, allowD));
        // v1.11.2 PROBE-RACE: top-2-ফিল্টার-পাস-অ্যাসেট-একসাথে-প্রোব; প্রথম-জীবিত-রায়-তৎক্ষণাৎ-জেতে,
        // মৃত-রায়-আসে-কেবল-দুটোই-মৃত-হলে। ধীর/মৃত-প্রথম-লিংক-আর-পুরো-সার্ভার-জিম্মি-করে-না।
        const ok = pass.length > 1 ? await probeAny([pass[0].url, pass[1].url]) : (pass.length ? await playable(pass[0].url) : true); // zero filter-matches -> probe skipped entirely
        const ns = (j.subtitles || []).length;
        const nfit = ok ? decorate(j, type, s, e, title || '', cfg, srv).length : 0;
        if (process.env.VDBG) console.error('[t1g] ' + srv + ' probe=' + (Date.now() - tS) + 'ms ok=' + ok + ' nfit=' + nfit + ' ns=' + ns);
        if (ok) { // শুধু-বাঁচা-ফল-ক্যাশ-হয় (মৃত/খালি-কখনো-নয়):
          SRV_CACHE.set(ck, { ts: Date.now(), j, ok: true, ns });
          if (SRV_CACHE.size > 400) SRV_CACHE.clear();
        } else SRV_NEG.set(ck, Date.now()); // মৃত-অ্যাসেট-ও-সাম্প্রতিক-ব্যর্থতা — ভ্যারিয়েন্ট-বারবার-প্রোব-করে-বাজেট-পোড়াবে-না
        return { srv, j, ok, ns, nfit };
      } catch (er) {
        if (process.env.VDBG) console.error('[t1g] ' + srv + ' ERR at ' + (Date.now() - tS) + 'ms: ' + String(er && er.message).slice(0, 60));
        SRV_NEG.set(ck, Date.now());
        force = true; return { srv, err: er };
      }
    };
    const absorb = r => {
      if (r.neg) return; // নেগেটিভ-হিট — স্কোর-আর-শাস্তি-নয়
      if (r.err) { srvBump(r.srv, -1); lastErr = r.err; return; }
      if (r.empty) { srvBump(r.srv, 0); return; }
      if (r.ok) {
        if (r.nfit > 0 && (nsB(r.ns) > nsB(bestFitNs) || (nsB(r.ns) === nsB(bestFitNs) && r.nfit > bestFitN))) { bestFit = r.j; bestFitSrv = r.srv; bestFitN = r.nfit; bestFitNs = r.ns; }
        if (r.ns > bestAnyNs) { bestAny = r.j; bestAnySrv = r.srv; bestAnyNs = r.ns; }
        srvBump(r.srv, r.nfit > 0 ? (r.ns >= 5 ? 2 : 1) : 0); // ভালো-সার্ভার-সবসময়-আগে
      } else { deadJ = r.j; deadSrv = r.srv; srvBump(r.srv, -1); }
    };
    // সব-নির্বাচিত-সার্ভার-একসাথে-সমান্তরাল — কোনো-আগে-থামা-নয়: "সবগুলা-সোর্স = সবগুলা-স্ট্রিম"
    // প্রতি-সার্ভার-হার্ড-বাজেট: দৈত্য-ত্রয়ী (miami/boise/atlanta) ১০.৫সে — ধীর-হলেও-ফল-সহ্য-করবে; বাকিরা ৭.৫সে:
    // v1.9.0 fix: the timeout timer used to fire even when one() had already won the race,
    // negative-caching healthy servers for 45-90s after every scan (empty-card windows).
    // Now the neg write only happens when the timeout genuinely fires first.
    const budget = (srv, negBypass) => {
      let done = false;
      let fire = null;
      const tmo = setTimeout(() => {
        if (done || !fire) return; // one() won — server is healthy, no neg
        if (process.env.VDBG) console.error('[t1g] ' + srv + ' BUDGET-CUT');
        SRV_NEG.set(ckFor(srv), Date.now()); // genuine budget timeout — recent-failure marker
        fire({ srv, err: new Error('srv-budget') });
      }, GIANT.indexOf(srv) >= 0 ? (viaProxy ? 9500 : 6500) : (viaProxy ? 8000 : 4500)); // v1.11.2 পথ-সচেতন-বাজেট: সরাসরি-পথে 6.5/4.5সে (ঝুলন্ত-সার্ভার-কখনো-কার্ড-দেয়-না), প্রক্সি-পথে (৪২৯-উইন্ডো) 9.5/8সে — প্রক্সি-চেইনের-সফল-ফেচ ৪.৭-৬.৩সে-তে
      return Promise.race([
        one(srv, negBypass).then(r => { done = true; clearTimeout(tmo); return r; }), // timer cleared on win — no dangling timeouts
        new Promise(r => { fire = r; })
      ]);
    };
    // সবাই-একসাথে-ফেল-করলে (যেমন-upstream-সাময়িক-http_500) ১.২-সে-পরে-এক-বার-অটো-রিট্রাই:
    let rs = await Promise.all(allow.map(s => budget(s)));
    if (process.env.VDBG) console.error('[t1g] ALL-SERVERS el=' + (Date.now() - t0) + 'ms ok=' + rs.filter(r => r.ok).length + '/' + rs.length);
    if (!rs.some(r => r.ok) && Date.now() - t0 < 7000) { // gate 7s (was 8s): a 7.5s extras-budget first pass used to slip under and push the retry past the gateway cut
      await new Promise(r2 => setTimeout(r2, 1200)); force = true;
      const failed = {};
      rs.forEach(r => { if (r.err) failed[r.srv] = 1; }); // only genuine errors retry — empty/dead stay negative-cached
      rs = rs.concat(await Promise.all(allow.map(srv => budget(srv, failed[srv]))));
    }
    rs.forEach(absorb);
    // মার্জ: কোনো-ক্রস-সার্ভার-ডিউপ-নয় — প্রতিটা-সার্ভারের-প্রতিটা-স্ট্রিম-কার্ড-থাকবে;
    // ক্রম: দৈত্য-সার্ভার (miami→boise→atlanta) সবার-উপরে, তারপর-বাড়তি, ভেতরে-রেজোলিউশন-বড়→ছোট:
    const PRIO = ['miami', 'boise', 'atlanta', 'phoenix', 'dallas', 'austin', 'seattle', 'delhi', 'munich', 'paris', 'orlando', 'reno', 'oakland', 'vegas', 'cancun', 'tampa'];
    const prio = v => { const i = PRIO.indexOf(v); return i < 0 ? 99 : i; };
    const all = [];
    for (const r of rs) {
      if (!r.j || !r.ok) continue;
      for (const c of decorate(r.j, type, s, e, title || '', cfg, r.srv)) all.push({ c, srv: r.srv });
    }
    all.sort((a, b) => prio(a.srv) - prio(b.srv) || (parseInt(b.c.quality, 10) || 0) - (parseInt(a.c.quality, 10) || 0));
    let out = all.map(x => x.c);
    // কোনো-কার্ড-ফিট-করেনি (অদ্ভুত-লেবেল) → সবচেয়ে-সাবসমৃদ্ধ/শেষ-ভরসা-সেট:
    if (!out.length) {
      let pick = bestAny, pickSrv = bestAnySrv;
      if (!pick) { pick = deadJ; pickSrv = deadSrv; }
      if (pick) out = decorate(pick, type, s, e, title || '', cfg, pickSrv);
    }
    // টাইটেল-প্রমিস-সমান্তরালে-ছুটেছিল → সর্বোচ্চ ৪০০ms-অপেক্ষা, এসে-গেলে-কার্ডে-বসাও (memoSet-এর-আগে-ই):
    if (titleP && out.length) {
      const nm = await Promise.race([titleP.catch(() => ''), new Promise(r => setTimeout(() => r(''), 400))]);
      if (nm) {
        const PRE = '\u29c9 Vidy\n'; // খালি-টাইটেলের-ফলব্যাক-সারি — সম্পূর্ণ-সারি-রিপ্লেস (আংশিক-নয়)
        out = out.map(c => {
          const t2 = c.title.indexOf(PRE) === 0 ? '\u29c9 ' + nm + '\n' + c.title.slice(PRE.length) : c.title;
          return Object.assign({}, c, { title: t2, description: t2 });
        });
      }
    }
    // দৈত্য-সার্ভার-কেউ-এই-পাসে-মিসিং-হলে (transient) ক্যাশ-নয় — পরের-চেষ্টায়-আবার-স্ক্যান-হবে:
    const giantsMissing = rs.some(r => GIANT.indexOf(r.srv) >= 0 && (!r.j || !r.ok));
    if (out.length && !giantsMissing) memoSet(key, out);
    else if (out.length) memoShort.set(key, { ts: Date.now(), v: out }); // দৈত্য-মিসিং → ৬০সে-ক্ষণস্থায়ী
    if (process.env.VDBG) console.error('[vdbg] ' + qsig + ' | ' + rs.map(r => r.srv + ':' + (r.neg ? 'neg' : r.err ? 'err' : r.empty ? 'empty' : 'ok' + r.nfit + '/' + (r.j && r.j.sources || []).length)).join(' '));
    if (!out.length && lastErr) throw lastErr;
    return out;
  });
}
const SUB_LANGS = { english: 'en', bangla: 'bn', bengali: 'bn', hindi: 'hi', japanese: 'ja', korean: 'ko', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', turkish: 'tr', arabic: 'ar', chinese: 'zh', mandarin: 'zh', thai: 'th', indonesian: 'id', malay: 'ms', tamil: 'ta', telugu: 'te', russian: 'ru', urdu: 'ur', malayalam: 'ml', marathi: 'mr', punjabi: 'pa', kannada: 'kn', nepali: 'ne', sinhala: 'si', filipino: 'tl', tagalog: 'tl', bhojpuri: 'bh', persian: 'fa', farsi: 'fa', vietnamese: 'vi' };
function subLang(x) { // subtitle language code — schema-required on strict (TV) validators
  const v = String(x.lang || x.language || '').trim().toLowerCase();
  if (/^[a-z]{2}(-|$)/.test(v)) return v.slice(0, 2);
  const s = v + ' ' + String(x.label || '').toLowerCase();
  for (const k in SUB_LANGS) if (s.indexOf(k) >= 0) return SUB_LANGS[k];
  return 'en';
}
// v1.9.0: shared quality-filter predicate — one() probes ONLY assets the filter would serve,
// decorate keeps exactly the same set. Unknown quality and Auto-HLS always pass.
function nxLangKey(p) { // normalize one dub token → canonical chip key
  p = String(p || '').toLowerCase().trim();
  if (!p || p === 'original') return 'original';
  if (p.indexOf('esla') >= 0 || p.indexOf('spanish') >= 0) return 'spanish';
  if (p.indexOf('ptbr') >= 0 || p.indexOf('portug') >= 0) return 'portuguese';
  return p;
}
function nxLangPass(x, sel) { // sel empty = every language stays
  if (!sel || !sel.length) return true;
  const raw = String(x._lang || '').replace(/\s*dub\s*$/i, '').trim();
  if (!raw) return sel.indexOf('original') >= 0;
  const parts = raw.split('/').map(nxLangKey);
  if (parts.indexOf('original') >= 0) return sel.indexOf('original') >= 0;
  return parts.some(pt => sel.indexOf(pt) >= 0);
}
function qPass(x, allow) {
  if (!allow || !allow.length) return true;
  const h = parseInt(String(x.quality || '0'), 10) || 0;
  return !h || allow.indexOf(h) >= 0;
}
function decorate(j, type, s, e, showTitle, cfg, srv) {
  cfg = cfg || DEFAULT_CFG;
  const headers = { 'User-Agent': UA, 'Referer': VIDY_REFERER };
  const order = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4, 'Auto HLS': 5 };
  // v1.10.2: TV apps validate the stream schema strictly — every subtitle object REQUIRES `lang`
  // (missing lang rejected the whole addon response, e.g. tt9288030:2:2 on TV). Derive a 2-letter
  // code from the upstream fields, fall back to the label text, then 'en' as the safe default.
  // v1.10.3 hardening: strict (TV) validators require url/title/lang to be real strings — a numeric label or non-string url from upstream would reject the whole response (same class as the 1.10.2 lang bug). Coerce here, never emit raw.
  let subs = (j.subtitles || []).slice(0, 40).map(x => ({ title: String(x.label || x.lang || x.language || 'Subtitle'), url: String(x.url || x.file || ''), lang: subLang(x) })).filter(x => x.url && /^https?:/.test(x.url) && x.lang);
  if (!cfg.sub) subs = [];
  const seen = {};
  const allow = Array.isArray(cfg.q) ? cfg.q : qToList(cfg.q);
  const cards = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && !seen[x.url] && (seen[x.url] = 1)).filter(x => qPass(x, allow)).sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).map(x => {
    const q = String(x.quality || 'Auto').replace('p', '');
    const sd = ((srv || 'vidy').charAt(0).toUpperCase() + (srv || 'vidy').slice(1)); // কার্ডে-সার্ভার-নাম
    const line2 = type === 'tv' ? '\u2b21 S' + s + 'E' + e + (subs.length ? ' \u00b7 Subs: ' + subs.length : '') : '\u2b21 Movie';
    const txt = '\u29c9 ' + (showTitle || 'Vidy') + '\n' + line2;
    return {
      name: '\u25eb ' + q.replace('Auto HLS', 'Auto') + ' \u00b7 ' + sd + ' \u25eb',
      title: txt,
      description: txt,
      quality: q === 'Auto HLS' ? '' : q,
      url: String(x.url),
      headers: headers,
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
      subtitles: subs
    };
  });
  return cards;
}

// ---------- config + manifest ----------
// TMDB-TV-জনর আলাদা (TV-তে Thriller/Romance নেই — জনর-আইডি টাইপ-ভেদে ভিন্ন):
const GENRES_TV = [['Drama', 18], ['Comedy', 35], ['Action & Adventure', 10759], ['Crime', 80], ['Mystery', 9648], ['Sci-Fi & Fantasy', 10765], ['Animation', 16], ['Family', 10751], ['Documentary', 99], ['War & Politics', 10768], ['Kids', 10762], ['Reality', 10764]];
const GENRES_MV = [['Action', 28], ['Comedy', 35], ['Thriller', 53], ['Romance', 10749], ['Drama', 18], ['Crime', 80], ['Sci-Fi', 878], ['Horror', 27], ['Mystery', 9648], ['Fantasy', 14], ['Animation', 16], ['Adventure', 12]];
function genreIds(type, names) {
  const gl = type === 'tv' ? GENRES_TV : GENRES_MV;
  return (Array.isArray(names) ? names : names ? [names] : []).map(n => String(n).trim().toLowerCase())
    .map(n => (gl.find(g2 => g2[0].toLowerCase() === n) || [0, 0])[1]).filter(Boolean);
}
const QH = [2160, 1080, 720, 480, 360];
function qToList(q) { // মাল্টি-রেজোলিউশন: অ্যারে/কমা-লিস্ট → ঠিক-ওইগুলো; সংখ্যা → ≤n-ক্যাপ (পুরনো-cfg); 0/খালি → সব
  const pick = [];
  const add = x => { const h = Number(x); if (QH.indexOf(h) >= 0 && pick.indexOf(h) < 0) pick.push(h); };
  if (Array.isArray(q)) { q.forEach(add); return pick; }
  if (typeof q === 'string' && q.indexOf(',') >= 0) { q.split(',').forEach(add); return pick; }
  const n = Math.min(2160, Math.max(0, Number(q) || 0));
  return n ? QH.filter(h => h <= n) : [];
}
const DEFAULT_CFG = { q: 0, sub: 1, cat: 'kd,mv', lang: '', sort: 'pop', era: '', g: [], srv: [], v: 1, nx: 1, nxq: 0, nxl: [] }; // v/nx = per-source master switches; nxq/nxl = NetHex's OWN quality/audio-language filters (independent of the vidy-side q)
function parseCfgFromObj(o) {
  const c = Object.assign({}, DEFAULT_CFG, { g: [] });
  if (o) {
    if (o.q !== undefined && o.q !== null && o.q !== '') c.q = qToList(o.q);
    if (o.sub === 0 || o.sub === '0') c.sub = 0;
    if (typeof o.cat === 'string' && o.cat) c.cat = o.cat;
    if (o.lang === 'ko' || o.lang === 'zh') c.lang = o.lang;
    if (['pop', 'top', 'new'].indexOf(o.sort) >= 0) c.sort = o.sort;
    if (['2020', '2010', '2000'].indexOf(o.era) >= 0) c.era = o.era;
    if (Array.isArray(o.g)) c.g = o.g.map(String).map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (Array.isArray(o.srv)) c.srv = o.srv.map(x => String(x).toLowerCase()).filter(x => SERVERS.indexOf(x) >= 0).slice(0, 16);
    if (o.v === 0 || o.v === '0') c.v = 0;
    if (o.nx === 0 || o.nx === '0') c.nx = 0;
    if (o.nxq !== undefined && o.nxq !== null && o.nxq !== '') c.nxq = qToList(o.nxq);
    if (Array.isArray(o.nxl)) c.nxl = o.nxl.map(x => String(x).toLowerCase().replace(/[^a-z]/g, '')).filter(x => x.length >= 2 && x.length <= 12).slice(0, 12);
  }
  return c;
}
function decodeCfg(b64) {
  try { return parseCfgFromObj(JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))); } catch (e) { return Object.assign({}, DEFAULT_CFG, { g: [], srv: [] }); }
}
function manifest(cfg) {
  return {
    id: 'community.xre.vidy',
    version: VERSION,
    name: 'Vidy',
    description: 'Stream-only, two parallel sources: Vidy (16 servers, up to 4K, subtitles) + MovieBox (direct-MP4 dubs & multi-audio) — every card in one unified format; each source keeps its own filters (quality, audio language, servers).',
    author: 'xre000001-ai',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb'],
    catalogs: []
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
function sendFile2(res, name) {
  try {
    const b = fs.readFileSync(path.join(__dirname, name));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); // CDN-ক্যাশ-নয় — নতুন-ডিপ্লয়ে-সাথে-সাথে-নতুন-পেজ
    return res.end(b);
  } catch (e) { return sendJson(res, 500, { error: 'missing ' + name }); }
}
const server = http.createServer((req, res) => {
  let pRaw = new URL(req.url, 'http://x').pathname;
  let p;
  try { p = decodeURIComponent(pRaw); } catch (eDec) { p = pRaw; } // ডিভাইস ':'-কে %3A-পাঠায় — ডিকোড-বাধ্যতামূলক
  let cfg = null;
  try {
    const cm2 = p.match(/^\/cfg\/([^\/]+)(\/.*)$/); // যেকোনো-অক্ষর-সহ্য — ভাঙা-b64-ও decodeCfg-এর-catch-এ-ডিফল্ট-হয় (404-নয়)
    if (cm2) { cfg = decodeCfg(cm2[1]); p = cm2[2]; }
    else {
      const qs = new URL(req.url, 'http://x').searchParams;
      if ([...qs.keys()].length) cfg = parseCfgFromObj({ q: qs.get('q') || qs.get('maxq'), sub: qs.get('sub') === '0' ? 0 : 1, cat: qs.get('cat') || '', lang: qs.get('lang') || '', sort: qs.get('sort') || '', era: qs.get('era') || '', g: (qs.get('g') || '').split(',').filter(Boolean), srv: (qs.get('srv') || '').split(',').filter(Boolean), v: qs.get('v') === '0' ? 0 : undefined, nx: qs.get('nx') === '0' ? 0 : undefined, nxq: qs.get('nxq') || undefined, nxl: qs.get('nxl') ? qs.get('nxl').split(',') : undefined });
    }
    if (!cfg) cfg = Object.assign({}, DEFAULT_CFG, { g: [], srv: [] });
    if (p === '/' || p === '/config' || p === '/configure') return sendFile2(res, 'config.html');
    if (p === '/manifest.json') return sendJson(res, 200, manifest(cfg));
    if (p === '/_health') return sendJson(res, 200, { ok: 1, version: VERSION, pool: POOL.length, memo: memo.size, nx: NEXBASE ? 1 : 0 });
    if (p === '/_pool') return sendJson(res, 200, POOL);
    if (p === '/_log') return sendJson(res, 200, reqLog.slice(-40).reverse());
    if (p === '/_servers') return sendJson(res, 200, { order: srvOrder(), scores: SRV_SCORE }); // কনফিগ-পেজের-লাইভ-হেলথ
    let m;
    // সব-পথ-লগ (৪০৪-ও-দৃশ্যমান-হোক):
    logReq(p, 0, -1, 'route-in');
    // ── catalog (search + genre + skip — NetHex-ধাঁচ):
    if ((m = p.match(/^\/catalog\/(series|movie)\/(vidy-kdrama|vidy-movies)(?:\/(.*))?\.json$/))) {
      const type = m[1] === 'series' ? 'tv' : 'movie';
      const ex = {};
      if (m[3]) m[3].split('&').forEach(kv => { const i3 = kv.indexOf('='); if (i3 > 0) ex[kv.slice(0, i3)] = decodeURIComponent(kv.slice(i3 + 1)); });
      const q = ex.search || '';
      const gid = [ex.genre].concat(cfg.g || []).filter(Boolean); // নাম-তালিকা → টাইপ-ভেদে-আইডি catalogMeta-র-ভেতরে
      const skip = Number(ex.skip || 0) || 0;
      const t0 = Date.now();
      return catalogMeta(type, q, cfg, gid, skip).then(metas => {
        logReq(p, Date.now() - t0, metas.length);
        sendJson(res, 200, { metas });
      }, e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { metas: [] }); });
    }
    // ── tmdb-নেটিভ-আইডি-স্ট্রিম (Nuvio-মোড):
    if ((m = p.match(/^\/stream\/movie\/tmdb(\d+)\.json$/))) {
      const t0 = Date.now();
      const tp = nameForTmdb(Number(m[1]), 'movie'); // টাইটেল-আর-sources-একসাথে-ছোটা — টাইটেল-শুধু-কার্ডের-জন্য
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('movie', String(m[1]), 0, 0) : null;
      return withNx(vOn ? getSources(Number(m[1]), 'movie', null, null, '', cfg, tp) : Promise.resolve([]), nxP, cfg, t0).then(
        cards => { logReq(p, Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/tmdb(\d+):?(?:(\d+):(\d+))?\.json$/))) {
      const t0 = Date.now();
      const tp = nameForTmdb(Number(m[1]), 'series');
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', String(m[1]), Number(m[2] || 1), Number(m[3] || 1)) : null;
      if (nxOn) nxPrewarm('series', String(m[1]), Number(m[2] || 1), Number(m[3] || 1));
      return withNx(vOn ? getSources(Number(m[1]), 'tv', Number(m[2] || 1), Number(m[3] || 1), '', cfg, tp) : Promise.resolve([]), nxP, cfg, t0).then(
        cards => { logReq(p, Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/movie\/(tt\d+)\.json$/))) {
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('movie', m[1], 0, 0) : null;
      return withNx(vOn ? findTmdbInfo(m[1], 'movie').then(info => (info && info.id > 0) ? getSources(info.id, 'movie', null, null, info.name, cfg) : Promise.resolve([])) : Promise.resolve([]), nxP, cfg, t0).then(
        cards => { logReq(p, Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+):(\d+):(\d+)\.json$/))) {
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', m[1], Number(m[2]), Number(m[3])) : null;
      if (nxOn) nxPrewarm('series', m[1], Number(m[2]), Number(m[3]));
      return withNx(vOn ? findTmdbInfo(m[1], 'series').then(info => (info && info.id > 0) ? getSources(info.id, 'tv', Number(m[2]), Number(m[3]), info.name, cfg) : Promise.resolve([])) : Promise.resolve([]), nxP, cfg, t0).then(
        cards => { logReq(p, Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+)\.json$/))) { // সেফটি-নেট: s:e-ছাড়া কল → S1E1
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', m[1], 1, 1) : null;
      if (nxOn) nxPrewarm('series', m[1], 1, 1);
      return withNx(vOn ? findTmdbInfo(m[1], 'series').then(info => (info && info.id > 0) ? getSources(info.id, 'tv', 1, 1, info.name, cfg) : Promise.resolve([])) : Promise.resolve([]), nxP, cfg, t0).then(
        cards => { logReq(p + ' [no-s:e]', Date.now() - t0, (cards || []).length); sendJson(res, 200, { streams: cards || [] }); },
        e => { logReq(p + ' [no-s:e]', Date.now() - t0, 0, e && e.message); sendJson(res, 200, { streams: [] }); });
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) { sendJson(res, 500, { error: String(e && e.message) }); }
});
// অলস-keep-alive-সকেট-প্রতি-৬০সে-পুড়িয়ে-দেওয়া — দীর্ঘ-অলসতায়-NAT-যেগুলো-নিঃশব্দে-কেটে-দেয় (বিংগের-মধ্যে-তাজা-থাকে):
setInterval(() => { try { HAGENT.destroy(); SAGENT.destroy(); } catch (e) {} }, 60000).unref();
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
