// ============================================================
// vidy — Stremio addon (v1.15.67) · multi-source streams
//   Sources: vidy (own) · MovieBox (embedded nethex child) ·
//   toonworld4all + raretoons (via resolver/ bridge) · multimovies
//   Proxies: NOT scanned locally — pulled from PoolHub sub-spaces
//   (hub /pick every 60s; hub = 293c2a7d7dd6-poolhub.baby-beamup.club)
//   Playback: always direct from CDN — never proxied.
// Full history (Bengali): docs/HISTORY_BN.md · Architecture: docs/ARCHITECTURE.md
// ============================================================
// Vidy addon — stream-only Stremio/Nuvio addon (vidy.st sources)
// Architecture: on 429 during token/seed fetch, race the trained proxy pool; media bytes always go CDN-direct.
// Nuvio/Node-safe: no AbortSignal anywhere — all timeouts use Promise.race/setTimeout.
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const VERSION = '1.15.69';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const VIDY_REFERER = 'https://www.vidy.st/';
const API = 'https://api.wecollege.net';
const TMDBP = 'https://db.wecollege.net/3';
function tmdbGet(path, timeoutMs) { // v1.13.7 IMDb/// v1.13.7 IMDb/free-public-first: official api.themoviedb.org (embedded public key) first, mirror (db.wecollege.net) fallback
  return pooledGet('https://api.themoviedb.org/3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + TMDBK, timeoutMs)
    .catch(() => pooledGet(TMDBP + path, timeoutMs));
}
const CINEMETA = 'https://v3-cinemeta.strem.io';
const SERVERS = ['miami', 'atlanta', 'seattle', 'boise', 'phoenix', 'dallas', 'austin', 'delhi', 'munich', 'cancun', 'vegas', 'oakland', 'orlando', 'paris', 'reno', 'tampa']; // full server family — 7 veterans + 9 discovered from the official player bundle (live-probed)
const GIANT = ['miami', 'boise', 'atlanta']; // giant primaries — carry ~32 sources across a 12-title sample (new servers top out at ~13, measured 10-11 Oct 2026)
let POOL = [];
// v1.15.67 (user: 'no local scanning — fetch from PoolHub'): local pool files fully removed; POOL is hub-fed only (hubMirror below)
// v1.15.0 runtime proxy health: boot-time ms values are never trusted again — wins/failures/EMA latency are remembered and raced by score
const PX_RUN = new Map(); // px → { ok, fail, ms, last }
const PX_LASTOK = new Map(); // v1.15.16 (// v1.15.16 (resolver standard): px -> timestamp of last ANY proof (checker/probe)
// v1.15.55 A3 blackout governor: >=90% failures over last 60 results (>=30 samples) = systemic disaster -> suspend failure writes (counting continues)
const PX_GLOB = { ring: [] };
function pxBlackout() { const r = PX_GLOB.ring; if (r.length < 30) return false; let f = 0; for (const g of r) if (!g) f++; const fr = f / r.length; return fr >= 0.9 ? 1 : (fr < 0.5 ? 0 : -1); }
function pxRec(px, good, ms, srcKey) { // v1.15.56: srcKey-// v1.15.56: with srcKey, that source's space is updated too (win=promote, fail=demote)
  PX_GLOB.ring.push(good ? 1 : 0); if (PX_GLOB.ring.length > 60) PX_GLOB.ring.shift();
  if (good) PX_LASTOK.set(px, Date.now());
  const h = PX_RUN.get(px) || { ok: 0, fail: 0, ms: 0, last: 0 };
  if (good) { h.ok++; h.ms = h.ms ? Math.round(h.ms * 0.7 + ms * 0.3) : ms; }
  else if (pxBlackout() === 1) { /* blackout-suspended — no fault write */ }
  else h.fail++;
  h.last = Date.now();
  PX_RUN.set(px, h);
  if (srcKey && PX_SPACES[srcKey]) { const SP = PX_SPACES[srcKey]; if (good) { SP.set.add(px); SP.ts.set(px, Date.now()); } else { SP.set.delete(px); } }
}
function pxScore(px, bootMs) { // lower is better; failures push a proxy back, cheap wins move it up
  const h = PX_RUN.get(px);
  if (!h) return bootMs || 9999;
  let sc = h.ms || bootMs || 9999;
  if (h.fail && !h.ok) sc += 8000; // // never won, keeps dying
  sc += h.fail * 400 - Math.min(h.ok, 8) * 120;
  return sc;
}
// v1.15.0 warm connections: keep resolver (TW/RT) + MovieBox child sockets alive — saves per-tap DNS+TLS (~0.3-0.6s);
// this was the 'slow reach the resolver' side of video latency. keepAlive agents reuse connections.
function warmBases() {
  for (const b of [TWBASE, RTBASE, NEXBASE]) {
    if (!b) continue;
    directGet(b + '/_health', 8000).catch(() => {});
  }
}
function prunePool(snap) {
  const good = snap.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; });
  const alive = good.length >= 3 ? good : snap; // // if all died, keep the list (retry after reboot)
  POOL.length = 0;
  for (const c of alive) POOL.push(c);
  if (DBG) console.error('[pool] probe: ' + alive.length + '/' + snap.length + ' alive');
}
// v1.15.16 resolver architecture (user: 'vidy must be resolver-grade, awake 24h'):
// every 12s probe the 12 oldest proofs; proof ladder: vidy.st itself reachable = full (resolver _TARGETS parity);
// alive-but-site-blind = spare (kept, scored lower); Google-204-dead and dead = unproven -> 600s cut -> enrich
const PX_SITE_URL = VIDY_REFERER; // // target site itself
const PX_SITE = new Set(); // v1.15.17 // v1.15.17 bench criterion (user): bench = can reach the site + alive — the checker is the sole authority
const PX_COOL = new Map(); // v1.15.16b: // v1.15.16b: fully dead -> 120s cooldown (resolver parity — same 12 dead are not re-beaten wave after wave; 5 chances before the 600s cut)
// v1.15.56 universal pool (user design): one store (POOL) + per-source 'spaces' — each px is promoted to the space where it truly works
const PX_API = new Set(); // // space 'api' — real work (seed API; R2: probe cost ~zero with TTL cache)
const PX_VB = new Set(); // // space 'vb' — vidbolt.xyz resolve
const PX_WO = new Set(); // // space 'wo' — vidout pipeline
const PX_API_URL = API + '/seed?mediaId=95350';
const PX_SPACES = {
  site: { url: 'https://www.vidy.st/robots.txt', min: 80, set: PX_SITE, ts: new Map() }, // v1.15.55 A1 (R1: // v1.15.55 A1 (R1: 106B; full homepage sweep every 32 waves)
  api: { url: PX_API_URL, min: 30, set: PX_API, ts: new Map() },
  vb: { url: 'https://vidbolt.xyz/', min: 200, set: PX_VB, ts: new Map() },
  wo: { url: 'https://vidout.pages.dev/', min: 200, set: PX_WO, ts: new Map() }
};
const PX_SITE_TS = PX_SPACES.site.ts;
// v1.15.67 (// v1.15.67 (user): local space files (px_sources/site) also removed — spaces are hub-fed too
// -- v1.15.67 hub feed (single source): every 60s hub /pick (n=40) -> POOL + spaces; no files, no scanning --
let MIRR_B = false;
async function hubMirror() {
  if (!HUB || MIRR_B) return; MIRR_B = true;
  try {
    for (const sp of ['toonworld4all', 'raretoons', 'vidy', 'moviebox', 'multimovies']) {
      try {
        const rM = await fetch(HUB + '/pick?src=' + sp + '&n=40&cb=' + Date.now() + (HKEY(sp) ? '&key=' + encodeURIComponent(HKEY(sp)) : ''), { signal: AbortSignal.timeout(6000) }); // v1.15.67: cb=nginx-// v1.15.67: cb busts the 2h nginx cache (prevents a stale pick cache)
        const jM = await rM.json(); if (!jM || !Array.isArray(jM.pick)) continue;
        for (const p of jM.pick) { // v1.15.67: own-// v1.15.67: own-filter dropped — every px the hub gives is hub-benched (hub sorts its own spaces first)
          if (!POOL.some(c => c.px === p.px) && POOL.length < 300) POOL.push({ px: p.px, ms: p.ms || 2000 }); // // store locally
          if (!PX_RUN.get(p.px)) PX_RUN.set(p.px, { ok: 1, fail: 0, ms: p.ms || 2000, last: Date.now() }); // // seed hub bench score (no local race yet)
          const lsk = sp === 'vidy' ? 'api' : (sp === 'multimovies' ? 'vb' : null);
          if (lsk && PX_SPACES[lsk]) { PX_SPACES[lsk].set.add(p.px); PX_SPACES[lsk].ts.set(p.px, Date.now()); } // // also into local spaces (api/vb bench gates)
        }
      } catch (e) { }
    }
    console.log('[hub-feed] pool=' + POOL.length + ' | spaces: site=' + PX_SITE.size + ' api=' + PX_API.size + ' vb=' + PX_VB.size + ' wo=' + PX_WO.size);
  } finally { MIRR_B = false; }
}
setInterval(hubMirror, 60000).unref(); setTimeout(hubMirror, 12000).unref();
// v1.15.67 (// v1.15.67 (user): harvest scanning (enrich) fully removed — TheSpeedX/monosans/proxyscrape/proxifly never touched; proxies come from PoolHub only

// ---------- memo + dedupe ----------
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

// ---------- vidy decrypt (byte-exact JS port of VidyDecrypt.kt) ----------
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

// ---------- fetch (direct + CONNECT proxy) ----------
const HAGENT = new http.Agent({ keepAlive: true, maxSockets: 32 }); // // connection reuse — faster cold calls
const SAGENT = new https.Agent({ keepAlive: true, maxSockets: 32 });
const HAGENTP = new http.Agent({ keepAlive: false, maxSockets: 16 }); // // probes run once — clean close
const SAGENTP = new https.Agent({ keepAlive: false, maxSockets: 16 });
function directGet(url, timeoutMs, _re, _hop) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: timeoutMs, agent: u.protocol === 'http:' ? HAGENT : SAGENT }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((_hop || 0) >= 4) return reject(Object.assign(new Error('redirect-loop'), { code: 310 })); // // stop redirect loops
        return resolve(directGet(new URL(res.headers.location, url).toString(), timeoutMs, _re, (_hop || 0) + 1));
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
      // if a keep-alive socket dies silently (NAT/middlebox), retry once on a fresh socket:
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
        let hdrDone = false;
        tl.on('data', d2 => {
          if (!hdrDone) { // // header split across two records handled correctly (before: !headTxt check swallowed part 2 into the body)
            headTxt += d2.toString('latin1');
            const j = headTxt.indexOf('\r\n\r\n');
            if (j < 0) return;
            hdrDone = true;
            chunks.push(Buffer.from(headTxt.slice(j + 4), 'latin1'));
            headTxt = headTxt.slice(0, j);
            return;
          }
          chunks.push(d2);
        });
        tl.on('close', () => {
          clearTimeout(hardTo);
          const raw = Buffer.concat(chunks);
          const body = (/chunked/i.test(headTxt) ? dechunk(raw) : raw).toString('utf8');
          const code = parseInt((headTxt.split('\r\n')[0] || '').split(' ')[1] || '0', 10);
          if (code === 429) return reject(Object.assign(new Error('rate_limited'), { code: 429 }));
          if (code !== 200 && code !== 204) return bail(new Error('http_' + code)); // v1.15.0: // v1.15.0: 204 also counts as success (generate_204 probe target)
          resolve(body);
        });
      });
      tl.once('error', bail);
    };
    sock.on('data', onData);
  });
}
function racePool(url, n, timeoutMs, srcKey) { // v1.15.56: srcKey = // v1.15.56: srcKey = which source — that source's own space first, then api->site->alive
  // v1.11.2: spread samples across the health band — used to take the first n of the list; if those 5 died together,
  // the whole pool was declared pool-exhausted while 19 healthy px remained (exactly what happened in a BreakingBad run)
  // v1.15.0: // v1.15.0: order by runtime score (failures pushed back), dead-heavy pool gets a wider race, results land in PX_RUN
  const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
  const alive = srt.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; }); // // proven dead (3 fails, 0 wins) never races
  // v1.15.17 bench gate (user criterion: bench = site + alive): with 3+ site-proven exits, race bench-only
  // (spares = alive but site-blind are emergency reserve; the checker wave keeps re-testing them for promotion)
  const SPB = (srcKey && PX_SPACES[srcKey]) ? PX_SPACES[srcKey].set : null;
  const sb = SPB ? alive.filter(c => SPB.has(c.px)) : [];
  const good = alive.filter(c => PX_SITE.has(c.px));
  const api3 = alive.filter(c => PX_API.has(c.px));
  const use = sb.length >= 3 ? sb : (api3.length >= 3 ? api3 : (good.length >= 3 ? good : (alive.length >= 3 ? alive : srt))); // // own-space>=3 -> api -> alive -> anyone
  const n2 = Math.min(use.length, Math.max(n, (srt.length - alive.length) >= srt.length / 2 ? n + 3 : n)); // // more than half dead -> width+3
  const cands = [];
  for (let i = 0; i < n2 && use.length; i++) {
    const c = use[Math.floor(i * use.length / n2)];
    if (c && !cands.some(x => x.px === c.px)) cands.push(c);
  }
  if (!cands.length) return Promise.reject(new Error('pool-empty'));
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; reject(new Error('race-timeout')); } }, timeoutMs);
    let fails = 0;
    for (const c of cands) {
      const tP = Date.now();
      proxiedGet(c.px, url, timeoutMs).then(body => {
        pxRec(c.px, true, Date.now() - tP, srcKey); // // race win = real proof — promote straight to the space
        if (done) return;
        done = true; clearTimeout(to);
        resolve({ body, px: c.px });
      }).catch(() => {
        pxRec(c.px, false, 0, srcKey); // // race fail = demote from that source's space
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
  return pooledGet(TMDBP + '/' + (type === 'tv' ? 'tv/' : 'movie/') + x.id + '/external_ids', 10000).then(b => {
    const e = JSON.parse(b);
    return e.imdb_id ? Object.assign({}, base, { id: e.imdb_id }) : Object.assign({}, base, { id: 'tmdb' + x.id });
  }).catch(() => Object.assign({}, base, { id: 'tmdb' + x.id })); // // even throttled, catalogs survive (tmdb-native id)
}
function catalogMeta(type, q, cfg, gn, skip) {
  cfg = cfg || DEFAULT_CFG;
  const gid = genreIds(type, gn);
  let url;
  let cap = 14;
  const off = (skip || 0) % cap; // // in-page offset — skip=14 used to repeat page 1
  if (q) {
    url = TMDBP + '/search/' + type + '?language=en-US&query=' + encodeURIComponent(q);
  } else if (gid.length || cfg.lang || cfg.era || cfg.sort !== 'pop' || skip) {
    // keyless proxy blocks with_genres -> pull 4 pages and filter locally by genre_ids
    const qs = [];
    if (cfg.lang) qs.push('with_original_language=' + cfg.lang);
    if (cfg.sort === 'top') { qs.push('sort_by=vote_average.desc'); qs.push('vote_count.gte=80'); }
    else if (cfg.sort === 'new') qs.push('sort_by=' + (type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc'));
    else qs.push('sort_by=popularity.desc');
    if (cfg.era) qs.push((type === 'tv' ? 'first_air_date.gte=' : 'primary_release_date.gte=') + cfg.era + '-01-01');
    const base = TMDBP + '/discover/' + type + '?language=en-US&' + qs.join('&');
    const p0 = 1 + Math.floor((skip || 0) / cap); // // scroll pagination in genre mode too (4-page window, cap-aligned)
    const pages = gid.length ? [p0, p0 + 1, p0 + 2, p0 + 3] : [p0];
    const one = () => Promise.all(pages.map(p =>
      pooledGet(base + '&page=' + p, 14000).then(b => (JSON.parse(b).results || []), () => [])
    )).then(lists => {
      let all = [].concat.apply([], lists);
      if (gid.length) all = all.filter(x => gid.every(gi => (x.genre_ids || []).indexOf(gi) !== -1));
      return Promise.all(all.slice(off, off + cap).map(x => tmdbMeta(x, type))).then(arr => arr.filter(Boolean));
    });
    return one().catch(() => new Promise(r => setTimeout(r, 900)).then(one)); // // one retry on throttle
  } else {
    url = TMDBP + '/' + (type === 'tv' ? 'tv/top_rated' : 'movie/popular') + '?language=en-US';
  }
  const one = () => pooledGet(url, 14000).then(b => {
    const list = (JSON.parse(b).results || []).slice(off, off + cap);
    return Promise.all(list.map(x => tmdbMeta(x, type))).then(arr => arr.filter(Boolean));
  });
  return one().catch(() => new Promise(r => setTimeout(r, 900)).then(one)); // // one retry on throttle
}

// ---------- tt → TMDB numeric (keyless) ----------
function tmdbSearchPick(name, year, type) { // keyless-search → // keyless search -> year-match preferred, else top-1
  return tmdbGet('/search/' + (type === 'series' ? 'tv' : 'movie') + '?query=' + encodeURIComponent(name), 12000).then(b3 => {
    const list = (JSON.parse(b3).results || []);
    let pick = null;
    for (const x of list) { if (year && String(x.release_date || x.first_air_date || '').slice(0, 4) === year.slice(0, 4)) { pick = x; break; } }
    if (!pick) pick = list[0];
    if (pick && pick.id) return { id: pick.id, name: pick.name || pick.title || name };
    throw new Error('search-empty');
  });
}
function findTmdbInfo(imdb, type) {
  const key = 'find:' + imdb + ':' + type;
  const hit = memoGet(key, 86400000);
  if (hit) return Promise.resolve(hit);
  // v1.15.8: find-empty-// v1.15.8: find-empty memo removed
  const cinemetaMeta = ms => pooledGet(CINEMETA + '/meta/' + type + '/' + encodeURIComponent(imdb) + '.json', ms).then(b2 => (JSON.parse(b2).meta || {})); // // free-public — Stremio's own IMDb CDN, head of the IMDb-first chain
  const suggMeta = () => pooledGet('https://v2.sg.media-imdb.com/suggestion/' + encodeURIComponent(String(imdb)[2]) + '/' + encodeURIComponent(imdb) + '.json', 8000).then(b4 => { // // free-public IMDb CDN
    const hit = (JSON.parse(b4).d || []).find(x => x && x.l && ['TV series', 'TV mini series', 'feature', 'movie', 'TV movie'].indexOf(String(x.q || '')) >= 0) || {};
    if (!hit.l) throw new Error('sugg-empty');
    return { name: hit.l, year: String(hit.y || '') };
  });
  return dedupe(key, () => cinemetaMeta(15000).then(m => { // ① IMDb-// (1) IMDb first: Cinemeta name -> official TMDB search
      const name = m.name || '';
      if (!name) throw new Error('cinemeta-empty');
      return tmdbSearchPick(name, String(m.releaseInfo || m.year || ''), type);
    }).catch(() => suggMeta().then(m2 => tmdbSearchPick(m2.name, m2.year, type))) // ② IMDb-suggestion → // (2) IMDb suggestion -> official search
  ).catch(() => pooledGet(TMDBP + '/find/' + encodeURIComponent(imdb) + '?external_source=imdb_id', 10000).then(body => { // ③ // (3) last resort: mirror find
    const j = JSON.parse(body);
    const r = (type === 'series' ? (j.tv_results || []) : (j.movie_results || []))[0] || null;
    if (r && r.id) { const v = { id: r.id, name: r.name || r.title || '' }; memoSet(key, v); return v; }
    throw new Error('find-empty');
  })).catch(() =>
    // fallback-4 (name-only): without a TMDB id, rt/tw sources still run by name — the whole chain never dies
    cinemetaMeta(12000).then(m5 => {
      const v = { id: 0, name: m5.name || '' };
      if (v.name) memoSet(key, v);
      return v;
    }).catch(() => ({ id: 0, name: '' }))
  ); // // never throws — id:0 means skip vidy source but rt/tw still run
}
function findTmdb(imdb, type) { return findTmdbInfo(imdb, type).then(v => v.id); }
function suggName(imdb) { // // fast title (for rt/tw): IMDb suggestion — skips the TMDB chain
  const key = 'snm:' + imdb;
  const hit = memoGet(key, 86400000);
  if (hit !== undefined && hit !== null) return Promise.resolve(hit);
  return dedupe(key, () => pooledGet('https://v2.sg.media-imdb.com/suggestion/' + encodeURIComponent(String(imdb)[2]) + '/' + encodeURIComponent(imdb) + '.json', 8000).then(b => {
    const hit2 = (JSON.parse(b).d || []).find(x => x && x.l && ['TV series', 'TV mini series', 'feature', 'movie', 'TV movie'].indexOf(String(x.q || '')) >= 0) || {};
    const nm = hit2.l || '';
    if (nm) memoSet(key, nm);
    return nm;
  }).catch(() => ''));
}
function nameForTmdb(tmdbId, type) {
  const key = 'nm:' + type + ':' + tmdbId;
  const hit = memoGet(key, 86400000);
  if (hit) return Promise.resolve(hit);
  if (memoGet(key + ':neg', 600000)) return Promise.resolve(''); // // failed lookups only 10min — not a day-long "Vidy" title
  return dedupe(key, () => tmdbGet('/' + (type === 'series' ? 'tv/' : 'movie/') + tmdbId, 10000).then(b => {
    const j = JSON.parse(b);
    const v = j.name || j.title || '';
    memoSet(key, v);
    return v;
  }).catch(() => { memoSet(key + ':neg', 1); return ''; }));
}

// ---------- seed (direct-first -> pool-race on 429) ----------
let seedCache = { key: null, seed: null, via: 'direct', px: null, ts: 0 };
let seedInflight = null; // // one seed call shared across a parallel pair
function hedge2(f0, f1, delayMs, hardMs) { // // first OK wins; both fail -> reject; nothing lost
  return new Promise((resolve, reject) => {
    let done = false;
    const win = v => { if (!done) { done = true; resolve(v); } };
    const die = () => { if (!done) { done = true; reject(new Error('hedge-dead')); } };
    f0().then(win, () => {});
    setTimeout(() => { if (!done) f1().then(win, () => {}); }, delayMs); // f0 // if f0 wins, no double call at all (halves upstream 429 load)
    setTimeout(die, hardMs);
  });
}
function getSeed(tmdbId, force) {
  if (!force && seedCache.seed && seedCache.key === tmdbId && (Date.now() - seedCache.ts) < 45000) { // // binge-friendly — seed reuse
    return Promise.resolve(seedCache);
  }
  if (!force && seedInflight && seedInflight.key === tmdbId && (Date.now() - seedInflight.ts) < 8000) return seedInflight.p;
  const url = API + '/seed?mediaId=' + tmdbId;
  const p = (async () => {
    // v1.15.7 (user directive, MovieBox model): token/seed via the pool too — later sticky-px path calls stay in the pool;
    // playback always on the user's own IP. Empty/all-dead pool -> direct as last resort (never breaks)
    try {
      let wbody = ''; let wpx = '';
      if (HUB) { // v1.15.59: // v1.15.59: hub draw — the px that fetched the seed is returned (later source calls use the same px — seed IP binding; proof: 'decrypt fa…' on a different px)
        try {
          const r = await fetch(HUB + '/fetch?src=api&ms=9000&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(10500) });
          const j2 = await r.json().catch(() => null);
          if (j2 && j2.ok) { wbody = String(j2.body || ''); wpx = 'hub:' + String(j2.px || ''); }
        } catch { }
      }
      if (!wbody) { const w = await racePool(url, 5, 9000, 'api'); wbody = w.body; wpx = w.px; } // v1.15.56: vidy-seed-// v1.15.56: vidy-seed space
      const j = JSON.parse(wbody);
      if (!j.seed) throw new Error('seed-empty-proxy');
      seedCache = { key: tmdbId, seed: j.seed, via: 'proxy', px: wpx, ts: Date.now() };
      return seedCache;
    } catch (e) {
      const b = await directGet(url, 6000);
      const j = JSON.parse(b);
      if (!j.seed) throw Object.assign(new Error('seed-empty'), { code: 429 });
      seedCache = { key: tmdbId, seed: j.seed, via: 'direct', px: null, ts: Date.now() };
      return seedCache;
    }
  })();
  seedInflight = { key: tmdbId, p, ts: Date.now() };
  return p;
}
function pathGet(url, via, px, timeoutMs) {
  if (via === 'proxy' && HUB && px && String(px).indexOf('hub:') === 0) return hubText(url, timeoutMs, 'api', String(px).slice(4)).then(t => { if (!t) throw new Error('hub-empty'); return t; }).catch(() => directGet(url, timeoutMs)); // v1.15.59: // v1.15.59: hub-sticky px — seed and sources share one px (stops decrypt breaks); direct if the hub dies
  if (via === 'proxy' && HUB) return hubText(url, timeoutMs, 'api').then(t => { if (!t) throw new Error('hub-empty'); return t; }).catch(() => directGet(url, timeoutMs)); // v1.15.57: // v1.15.57: hub path
  return via === 'proxy' && px ? proxiedGet(px, url, timeoutMs) : directGet(url, timeoutMs);
}
// v1.15.5 // v1.15.5 round-2 (user: never let every source ride the pool or the IP gets flagged): direct on the happy path (zero delay); on 429/403/5xx/net-error
// // fall back to the pool race — getSeed's proven model, extended to metadata APIs (TMDB/Cinemeta/IMDb-suggestion can throttle a single busy IP)
function pooledGet(url, timeoutMs, n) {
  return directGet(url, timeoutMs).catch(e => {
    const c2 = String((e && (e.code || e.message)) || '');
    if (!/429|403|rate_limited|http_5|^5\d\d$|timeout|ECONN|EPIPE|socket|EAI_AGAIN|fetch/i.test(c2)) throw e;
    return racePool(url, n || 4, Math.min(timeoutMs + 3000, 12000)).then(w => w.body);
  });
}

// ---------- NetHex parallel source (separate source; NEXBASE env, empty = off) ----------
// vidy servers + NetHex (MovieBox direct-MP4) run in parallel; NetHex cards (♧, distinct style)
// are appended after the vidy cards. Any NetHex failure/timeout/slow = vidy cards alone, never an error.
const DBG = !!process.env.VDBG; // // every debug log is gated by this one flag (VDBG=1 enables)
// v1.15.57 PoolHub-// v1.15.57 PoolHub mode (user design: universal pool as a separate service + API): with POOLHUB set, vidy's proxy needs go to the hub's /fetch first; hub down/absent ->
const HUB = String(process.env.POOLHUB || 'https://293c2a7d7dd6-poolhub.baby-beamup.club').replace(/\/$/, ''); // v1.15.66: // v1.15.66: default = deployed PoolHub (Badhan's app)
// v1.15.62 // v1.15.62 sub-space API keys (user: each source uses the hub with its own key): POOLHUB_KEYS=file path (JSON {space:psk}) — poolhub/poolhub_keys.json locally
let HKEYS = {}; try { HKEYS = JSON.parse(fs.readFileSync(String(process.env.POOLHUB_KEYS || path.join(__dirname, 'config', 'poolhub_keys.json')), 'utf8')); } catch (e) { }
const HKEY = n => String(HKEYS[n] || '');
const HALIAS = { tw: 'toonworld4all', toonworld: 'toonworld4all', rt: 'raretoons', raretoons: 'raretoons', api: 'vidy', site: 'vidy', mb: 'moviebox', vb: 'multimovies', wo: 'multimovies' };
const HSPACE = n => HALIAS[String(n || '')] || String(n || '') || 'vidy';
// v1.15.58 (// v1.15.58 (user design): source-declared conditions — vidy registers each source's condition with the hub at boot; the hub benches every proxy against that condition and passes it into that space
if (HUB) {
  // v1.15.62 (// v1.15.62 (tidy layout): PX_DECL = the 5 sub-spaces, each registering with its own API key (key decides the space)
  const PX_DECL = {
    toonworld4all: { url: 'https://toonworld4all.me/robots.txt', min: 100, contains: 'wp-admin' }, // // real target + WordPress signature
    raretoons: { url: 'https://www.rareanimes.mov/robots.txt', min: 100, contains: 'wp-admin' }, // crawler.py-// crawler.py live target + signature
    vidy: { url: API + '/seed?mediaId=95350', min: 30, contains: '"seed"' }, // vidy-// vidy's real work
    moviebox: { url: '', tokencheck: true, min: 1 }, // v1.15.65 (// v1.15.65 (user proof 83% pass): token-collection bench in hub waves — the front door of searchVerify
    multimovies: { url: 'https://vidbolt.xyz/api/resolve?type=tv&id=1&season=1&episode=1', min: 5 } // // multimovies CDN condition
  };
  setTimeout(() => { for (const sk of Object.keys(PX_DECL)) fetch(HUB + '/register', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, HKEY(sk) ? { 'x-poolhub-key': HKEY(sk) } : {}), body: JSON.stringify(Object.assign({ src: sk }, PX_DECL[sk])) }).catch(() => { }); }, 2500);
}
async function hubText(url, ms, src, px) { // v1.15.59: px-// v1.15.59: with px, sticky (hub makes the single call via that very px — preserves seed IP binding)
  if (!HUB) return '';
  try {
    const sp = HSPACE(src);
    const r = await fetch(HUB + '/fetch?src=' + encodeURIComponent(sp) + (px ? '&px=' + encodeURIComponent(px) : '') + '&ms=' + Math.min(12000, ms || 8000) + (HKEY(sp) ? '&key=' + encodeURIComponent(HKEY(sp)) : '') + '&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(Math.min(13000, (ms || 8000) + 1500)) });
    const j = await r.json().catch(() => null);
    return j && j.ok ? String(j.body || '') : '';
  } catch { return ''; }
}
process.on('unhandledRejection', e => { if (DBG) console.error('[urej] ' + String((e && (e.stack || e.message)) || e).slice(0, 160)); }); // v1.15.6 // v1.15.6 round-43: unhandled rejections never crash the addon
let UCEX = 0; // v1.15.36: // v1.15.36: uncaught-exception counter (transparent in /_health)
process.on('uncaughtException', e => { UCEX++; try { if (DBG) console.error('[ucex#' + UCEX + '] ' + String((e && (e.stack || e.message)) || e).slice(0, 200)); } catch {} }); // v1.15.36: // v1.15.36: never crash — log and continue
// v1.11.8: NEXBASE-// v1.11.8: NEXBASE can be provided externally; otherwise the vendored MovieBox (nethex) child boots itself (single-app deploy)
let NEXBASE = (process.env.NEXBASE || '').replace(/\/$/, '');
const NXDEADLINE = Math.max(Number(process.env.NXDEADLINE || 0), 35000); // v1.15.68: 22→35s (// v1.15.68: 22->35s (cold child: search ~10s + matrix ~15-23s — at 22s MB cards were being cut off)
const NXEXTRA = Math.max(Number(process.env.NXEXTRA || 0), 12000); // v1.15.25 (// v1.15.25 (user: "early result if ready early, else up to 12s"): a 12s grace window for NetHex
const NXCOLDX = Math.max(Number(process.env.NXCOLDX || 0), 15000); // v1.15.68: 12→15s
const NXHARD = Math.max(Number(process.env.NXHARD || 0), 15000); // v1.15.68: 12→15s
const NXCACHE = new Map(); // nx:imdb:s:e -> {ts, v} — NetHex links are signed/fresh + it caches 30min itself
async function nxStreams(imdb, type, s, e) {
  if (!NEXBASE || !imdb) return [];
  if (NXBENCH === 0 && NEXBASE) await waitNxBench(8000); // v1.15.13: // v1.15.13: on a cold replica, wait for the first bench wave (8s cap; single-flight — no bench storm)
  if (NXBENCH === 0) return []; // v1.15.10 // v1.15.10 cold-guard (intact: truly empty pool = no scan storm): an empty bench means every call eats 403s while the bench starves
  const k = 'nx:' + imdb + ':' + (type === 'series' ? (s || 1) + ':' + (e || 1) : 'm');
  const h = NXCACHE.get(k);
  if (h && (Date.now() - h.ts) < 1800000) return h.v;
  try {
    const path2 = type === 'series' ? encodeURIComponent(imdb + ':' + (s || 1) + ':' + (e || 1)) : encodeURIComponent(imdb);
    const epP = epMetaForImdb(imdb, type, s, e); // // year + episode title — parallel with the nethex fetch
    const olP2 = origLangForImdb(imdb); // // original language — used as the dub name when no dub exists (no more literal "Original")
    const t3 = Date.now();
    const b = await directGet(NEXBASE + '/stream/' + type + '/' + path2 + '.json', 40000); // v1.15.67c: 25→40s (// v1.15.67c: 25->40s (cold child: search ~10s + matrix ~14s — at 25s cards were cut)
    const nxMs = Date.now() - t3;
    if (DBG) console.error('[nxdbg] nethex ' + type + '/' + path2 + ' -> ' + nxMs + 'ms');
    // v1.11.7: // v1.11.7: final uniform card — ⧉ Title | Year | / ⧠ SsEe • EpTitle / ⊞ Server ⌗ Audio (resolution only in the name, no "Subs" text)
    // v1.14.3 // v1.14.3 adaptive fence: the fence shrinks for slow child fetches — total nx <= ~2.6s + child minimum
    const nxMeta = Math.max(0, Math.min(1500, 2600 - nxMs));
    const [em, olRaw] = await Promise.all([
      Promise.race([epP.catch(() => null), new Promise(r => setTimeout(() => r(null), nxMeta))]),
      raceVal(olP2, nxMeta)
    ]);
    const olN = langName(olRaw);
    const arr = (JSON.parse(b).streams || []).filter(x => x && typeof x.url === 'string' && /^https?:/.test(x.url)).map(x => {
      const q2 = (/(\d{3,4})p/.exec(String(x.name || '')) || [])[1] || 'Auto';
      const lang = String(x._lang || '').replace(/\s*dub\s*$/i, '').trim();
      const audio = (!lang || /^original/i.test(lang)) ? (olN || 'Original Audio') : lang; // // the dub's own name; else the original language; if TMDB does not know either, say "Original Audio"
      const yr = (/\u25f4\s*(\d{4})/.exec(String(x.description || '')) || [])[1] || (em && em.year) || '';
      const raw = (em && em.name) || (String(x.name || '').split('\u2739')[1] || '').replace(/\s*S\d+\s*-\s*S\d+.*$/i, '').trim() || 'MovieBox'; // // title and IMDb-clean
      const H2 = { 'User-Agent': UA, 'Referer': 'https://movieboxonline.net/' };
      const epLine = type === 'series' ? ('\u29e0 S' + (s || 1) + 'E' + (e || 1) + ((em && em.epT) ? ' \u2022 ' + em.epT : '')) : '\u29e0 Movie';
      const txt = '\u29c9 ' + raw + (yr ? ' | ' + yr + ' |' : '') + '\n' + epLine + '\n\u229e MovieBox \u2317 ' + audio;
      return {
        name: '\u25a5 ' + q2 + ' \u25a5',
        title: txt,
        description: txt,
        quality: q2 === 'Auto' ? '' : q2,
        _lang: lang,
        url: String(x.url),
        headers: H2,
        behaviorHints: { notWebReady: false, isBingeable: true, filename: 'stream.mp4', proxyHeaders: { request: Object.assign({}, H2, { 'Origin': 'https://movieboxonline.net' }) } },
        bingeGroup: 'mbxr|' + raw + '::|' + (/^original/i.test(lang) ? 'Original' : lang) // nethex-// nethex parity — binge grouping shares the audio segment
      };
    });
    if (arr.length) { // empty is NEVER cached — a rate-limited/slow NetHex window must not poison the key for 30min (same rule as inside NetHex itself); the next tap re-fetches
      if (NXCACHE.size > 300) NXCACHE.clear();
      if (arr.length) NXCACHE.set(k, { ts: Date.now(), v: arr }); // v2.10.3: // v2.10.3: empty memos forbidden — an MB site langs:0 wave used to show MB-0 for 30 minutes (r57 principle)
    }
    return arr;
  } catch (e2) { if (DBG) console.error('[nxdbg] nethex ERR: ' + String(e2 && e2.message).slice(0, 80)); return []; } // NetHex down/slow/empty → silently nothing, vidy never breaks
}
const T2IFLIGHT = new Map(); // dedupe concurrent tmdb→imdb translations (tap + prewarm share one mirror call)
const SUBS_CACHE = new Map(); // subtitles-// subtitles resource -> 30min (never repeat the child's expensive chain)
async function tmdbToImdb(tmdbId, type) { // NetHex is tt-only — translate tmdb-native ids through the mirror
  const k = 't2i:' + type + ':' + tmdbId;
  const hit = memoGet(k, 86400000);
  if (hit) return hit;
  if (memoGet(k + ':neg', 600000)) return ''; // // failed translations only 10min — not a 10s timeout burn on every tap
  const fl = T2IFLIGHT.get(k);
  if (fl) return fl;
  const pr = (async () => {
    try {
      const b = await tmdbGet('/' + (type === 'tv' || type === 'series' ? 'tv/' : 'movie/') + tmdbId + '/external_ids', 10000);
      const v = JSON.parse(b).imdb_id || '';
      if (v) memoSet(k, v); else memoSet(k + ':neg', 1);
      return v;
    } catch (e) { return ''; }
    finally { T2IFLIGHT.delete(k); }
  })();
  T2IFLIGHT.set(k, pr);
  return pr;
}
// ---------- v1.11.9 audio language: TMDB original_language → // ---------- v1.11.9 audio language: TMDB original_language -> real name (proven: the vidy payload has no audio field) ----------
const TMDBK = '3fd2be6f0c70a2a598f084ddfb75487c'; // public TMDB key (mirror accepts keyless too; find needs it)
const LANG_NAMES = { hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', ja: 'Japanese', ko: 'Korean', zh: 'Mandarin', cn: 'Mandarin', en: 'English', es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian', pt: 'Portuguese', it: 'Italian', tr: 'Turkish', ar: 'Arabic', th: 'Thai', id: 'Indonesian', ms: 'Malay', fa: 'Persian', ur: 'Urdu', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', tl: 'Filipino', vi: 'Vietnamese', he: 'Hebrew', el: 'Greek', hu: 'Hungarian', ro: 'Romanian', cs: 'Czech', uk: 'Ukrainian', sr: 'Serbian', hr: 'Croatian', bg: 'Bulgarian', ka: 'Georgian', my: 'Burmese', si: 'Sinhala', ne: 'Nepali' };
const OL_CACHE = new Map(); // key -> lang code (6h)
const OL_FLIGHT = new Map();
async function origLangCore(k, url) {
  const hit = OL_CACHE.get(k);
  if (hit && (Date.now() - hit.ts) < 21600000) return hit.v;
  const fl = OL_FLIGHT.get(k);
  if (fl) return fl;
  const pr = (async () => {
    try {
      const b = await tmdbGet(url, 8000); // url=// url is a path — official first, mirror fallback
      const j = JSON.parse(b);
      const cand = j.original_language !== undefined ? j : ((j.movie_results || []).concat(j.tv_results || []))[0] || {}; // detail // detail result, or the first result of find
      const v = String(cand.original_language || '').toLowerCase();
      if (v) { OL_CACHE.set(k, { ts: Date.now(), v }); if (OL_CACHE.size > 5000) OL_CACHE.clear(); return v; }
      OL_CACHE.set(k, { ts: Date.now() - 21000000, v: '' }); return ''; // // TMDB does not know either -> 10min negative (ts rolled back; not an 8s retry per tap)
    } catch (eO) { return ''; } // // network failure -> not negative (retry on the next call)
    finally { OL_FLIGHT.delete(k); }
  })();
  OL_FLIGHT.set(k, pr);
  return pr;
}
const origLangForTmdb = (tmdbId, type) => origLangCore('t:' + tmdbId, '/' + (type === 'tv' ? 'tv/' : 'movie/') + tmdbId);
const origLangForImdb = imdb => origLangCore('i:' + imdb, '/find/' + imdb + '?external_source=imdb_id');
const langName = c => LANG_NAMES[c] || '';
// v1.11.11: HLS-// v1.11.11: if the HLS master itself declares the audio language (EXT-X-MEDIA LANGUAGE="da"), that is the truth — ISO-639-2/3 -> name
const ISO3 = { eng: 'English', dan: 'Danish', ben: 'Bengali', hin: 'Hindi', spa: 'Spanish', fra: 'French', fre: 'French', deu: 'German', ger: 'German', rus: 'Russian', por: 'Portuguese', ita: 'Italian', jpn: 'Japanese', kor: 'Korean', zho: 'Mandarin', cmn: 'Mandarin', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', mar: 'Marathi', pan: 'Punjabi', urd: 'Urdu', ara: 'Arabic', tur: 'Turkish', tha: 'Thai', ind: 'Indonesian', msa: 'Malay', may: 'Malay', fas: 'Persian', per: 'Persian', nld: 'Dutch', dut: 'Dutch', pol: 'Polish', swe: 'Swedish', nor: 'Norwegian', fin: 'Finnish', vie: 'Vietnamese', heb: 'Hebrew', ell: 'Greek', gre: 'Greek', hun: 'Hungarian', ron: 'Romanian', rum: 'Romanian', ces: 'Czech', cze: 'Czech', ukr: 'Ukrainian', srp: 'Serbian', hrv: 'Croatian', bul: 'Bulgarian', kat: 'Georgian', geo: 'Georgian', mya: 'Burmese', bur: 'Burmese', sin: 'Sinhala', nep: 'Nepali', fil: 'Filipino', tgl: 'Filipino', und: '', mis: '', qaa: '', zxx: '' };
const iso3Name = c => ISO3[String(c || '').toLowerCase()] || '';
async function raceVal(pr, ms) { return Promise.race([pr.catch(() => ''), new Promise(r => setTimeout(() => r(''), ms))]); }

function withDeadline(pr, ms, tag) { // // so a cold spike never touches the gateway's ~12s HTML cut — answer partial/empty JSON early
  let to;
  const w = Promise.race([pr, new Promise(r => { to = setTimeout(() => { if (DBG) console.error('[deadline] ' + tag + ' cut at ' + ms + 'ms'); r(null); }, ms); })]);
  Promise.resolve(pr).catch(() => {}).then(() => clearTimeout(to)); // v1.14.5: // v1.14.5: clear the timer when done — clean event loop
  return w;
}

function kickSubs(id, type, s, e, cfg) { // // warms the subtitle chain in parallel with the scan — the /subtitles route answers instantly
  if (!cfg || cfg.sub === 0) return;
  (/^tt\d+$/.test(String(id)) ? Promise.resolve(String(id)) : tmdbToImdb(String(id), type === 'tv' || type === 'series' ? 'tv' : 'movie'))
    .then(iv => iv ? mbSubs(iv, type, s, e) : null).catch(() => {});
}
async function mbSubs(imdb, type, s, e) { // MovieBox-// MovieBox subtitle tracks (child chain is expensive -> 30min cache + in-flight dedupe)
  if (!NEXBASE || !imdb) return [];
  const isTv = type === 'tv' || type === 'series';
  const k = 'subs:' + (isTv ? 'series' : 'movie') + ':' + imdb + (isTv ? ':' + (s || 1) + ':' + (e || 1) : '');
  const h = SUBS_CACHE.get(k);
  if (h && (Date.now() - h.ts) < 1800000) return h.arr;
  return dedupe(k, async () => {
    const idPath = encodeURIComponent(isTv ? imdb + ':' + (s || 1) + ':' + (e || 1) : imdb);
    const b = await directGet(NEXBASE + '/subtitles/' + (isTv ? 'series' : 'movie') + '/' + idPath + '.json', 18000);
    const arr = (JSON.parse(b).subtitles || []).filter(x => x && x.url && /^https?:/.test(String(x.url))).slice(0, 20)
      .map(x => ({ title: String(x.lang || x.id || 'Subtitle').slice(0, 60), url: String(x.url), lang: subLang({ lang: String(x.lang || ''), label: String(x.id || '') }) })) // // resource shape (Stremio-native)
      .filter(x => x.url && /^https?:/.test(x.url) && /^[a-z]{2}$/.test(x.lang));
    if (arr.length) { if (SUBS_CACHE.size > 200) SUBS_CACHE.clear(); SUBS_CACHE.set(k, { ts: Date.now(), arr }); } // // never cache empties
    return arr;
  }).catch(() => []);
}

// ---------- v1.11.5 card meta: // ---------- v1.11.5 card meta: year + per-episode title (Cinemeta, 6h cache) ----------
const EP_META = new Map(); // imdb -> {ts, year, videos:[{s,e,n}]}
async function epMetaCore(imdb, type) {
  const h = EP_META.get(imdb);
  if (h && (Date.now() - h.ts) < 21600000) return h;
  const b = await pooledGet('https://v3-cinemeta.strem.io/meta/' + (type === 'tv' || type === 'series' ? 'series' : 'movie') + '/' + imdb + '.json', 8000); // 'series'-// 'series' also means tv (nxStreams sends 'series')
  const meta = JSON.parse(b).meta || {};
  const rec = {
    ts: Date.now(),
    name: String(meta.name || '').slice(0, 80),
    year: String(meta.releaseInfo || meta.year || meta.released || '').slice(0, 4),
    videos: (meta.videos || []).map(v => ({ s: Number(v.season) || 0, e: Number(v.episode) || 0, n: String(v.name || '').slice(0, 60) })).filter(v => v.n),
  };
  if (rec.year || rec.videos.length || rec.name) { if (EP_META.size > 200) EP_META.clear(); EP_META.set(imdb, rec); }
  return rec;
}
function epMetaForImdb(imdb, type, s, e) {
  return (async () => {
    try {
      const rec = await epMetaCore(imdb, type);
      if (!rec) return null;
      let epT = '';
      if (type === 'tv' || type === 'series') { const v = rec.videos.find(v => v.s === Number(s || 1) && v.e === Number(e || 1)); if (v) epT = v.n; } // 'series'-// 'series' is the canonical type in Cinemeta videos
      return (rec.year || epT || rec.name) ? { name: rec.name, year: rec.year, epT } : null;
    } catch (eE) { return null; }
  })();
}
function epMetaFor(tmdbId, type, s, e) { // tmdb-// tmdb-native id -> translation -> Cinemeta
  return tmdbToImdb(String(tmdbId), type).then(imdb => imdb ? epMetaForImdb(imdb, type, s, e) : null).catch(() => null);
}
function nxFor(type, id, s, e) { // starts the parallel fetch immediately; null when source is off
  if (!NEXBASE) return null;
  if (/^tt\d+$/.test(id)) return nxStreams(id, type, s, e);
  return tmdbToImdb(id, type).then(v => v ? nxStreams(v, type, s, e) : []);
}
function twRtPrewarm(nameP, type, s, e) { // v1.14.5 series tap → // v1.14.5 series tap -> pre-warm the next 2 episodes on the resolver (cold episode resolve is 8s+ -> the 2nd binge click is instant)
  if ((!TWBASE && !RTBASE) || type !== 'series') return;
  setTimeout(() => { Promise.resolve(nameP).then(nm => {
    if (!nm) return;
    for (let k = 1; k <= 2; k++) {
      if (TWBASE) twrStreams(TWBASE, 'toonworld', nm, 'series', s, e + k, 1).catch(() => {});
      if (RTBASE) twrStreams(RTBASE, 'raretoons', nm, 'series', s, e + k, 1).catch(() => {});
    }
  }).catch(() => {}); }, 1200);
}
function nxPrewarm(type, id, s, e) { // series tap → quietly fetch the next 3 episodes' NetHex into NXCACHE (binge tap-2 = instant)
  if (!NEXBASE) return;
  // v1.11.2: // v1.11.2: the main tap's resolve takes the pool's first bite (an instant flood of 4 resolves slowed cold E1)
  setTimeout(() => {
    for (let k = 1; k <= 3; k++) {
      nxFor(type, id, s, e + k).catch(() => {});
    }
  }, 900);
}
async function withNx(cardsP, nxP, cfg, t0) {
  // v1.11.2: vidy-// v1.11.2: even if vidy meta/scan dies (cinemeta-empty / srv-budget / 429 storm), nx is no longer orphaned —
  // // the empty cards hand nx-hold its full budget (a Westworld tap once answered empty at 1.4s while nx arrived at 9.8s with 10 cards, wasted)
  const cards = await cardsP.catch(e => { if (DBG) console.error('[nxdbg] cardsP died: ' + String(e && e.message || e).slice(0, 90) + (e && e.stack ? ' | ' + String(e.stack).split('\n')[1].trim().slice(0, 90) : '')); return []; });
  if (!nxP || (cfg && cfg.nx === 0)) return cards; // nx disabled per-source → zero hold, zero cards
  try {
    const el = Date.now() - t0;
    if (DBG) console.error('[nxdbg] withNx el=' + el + 'ms grace-pending');
    // FIRST-COLD-REQUEST goal: everything resolves on tap-1. NetHex starts with the vidy scan,
    // so on a cold call it already had `el` ms — the hold tops it up toward the hard deadline.
    // vidy answered from cache (<400ms) -> instant-path: only NXEXTRA (a cold NetHex resolve
    // catches the next tap via its own background re-resolve + cache).
    // v1.11.3: // v1.11.3: completely empty cards (v=0 nx-only mode, or vidy found nothing) -> not NXEXTRA's 1s,
    // // keep the full hard budget — an nx-only user's first cold tap must never get a guaranteed empty
    const grace = cards.length === 0 ? Math.max(0, NXHARD - el) : (el < 400 ? NXEXTRA : Math.max(0, Math.min(NXCOLDX, NXHARD - el)));
    const left = Math.max(0, Math.min(NXDEADLINE, el + grace) - el);
    const nx = await Promise.race([nxP.then(v => { if (DBG) console.error('[nxdbg] nxP resolved: ' + (v || []).length + ' cards at ' + (Date.now() - t0) + 'ms'); return v; }).catch(() => []), new Promise(r => setTimeout(() => { if (DBG) console.error('[nxdbg] nxP TIMED OUT at ' + (Date.now() - t0) + 'ms'); r(null); }, Math.max(0, left)))]);
    if (nx && nx.length) {
      // v1.11.3 per-source filters: NetHex answers to nxq/nxl (its OWN chips), NOT the vidy-side q
      const nxAllow = qToList(cfg && cfg.nxq);
      const nxSel = Array.isArray(cfg && cfg.nxl) ? cfg.nxl : [];
      return cards.concat(nx.filter(x => qPass(x, nxAllow) && nxLangPass(x, nxSel))); // appended last
    }
  } catch (e) { if (DBG) console.error('[nxdbg] withNx ERR: ' + String(e && e.message).slice(0, 80) + ' @ ' + String(e && e.stack).split('\n')[1].trim().slice(0, 100)); }
  return cards;
}

// ---------- ToonWorld + RareToons // ---------- ToonWorld + RareToons parallel sources (resolver; TWBASE/RTBASE env, empty = off) ----------
let TWBASE = String(process.env.TWBASE || '');
if (!TWBASE) TWBASE = 'https://3404d3c5dc63-raretoons.baby-beamup.club'; // // fallback: the same resolver (with ToonWorld sources)
else if (/\.a\.baby-beamup\.club/.test(TWBASE)) TWBASE = TWBASE.replace('.a.baby-beamup.club', '.baby-beamup.club'); // // domain migration
let RTBASE = String(process.env.RTBASE || '');
if (!RTBASE) RTBASE = 'https://3404d3c5dc63-raretoons.baby-beamup.club'; // // fallback: new public domain
else if (/\.a\.baby-beamup\.club/.test(RTBASE)) RTBASE = RTBASE.replace('.a.baby-beamup.club', '.baby-beamup.club'); // beamup-// beamup domain migration (drop a.)
function showCore(t) { // v1.15.4 // v1.15.4 universal title: 'One Piece S1E1' / 'One Piece season 1 episode 8' / 'One Piece s01e0001' / '1x01' / hindi-dub quality tokens
  let c2 = String(t || ''); // // normalize every format in one place — external addons never need per-format updates (user directive)
  const before = c2.trim();
  c2 = c2.replace(/\b(?:s\d{1,2}[\s._-]?e\d{1,4}|\d{1,2}x\d{1,4}|season[\s._-]?\d{1,2}|episodes?[\s._-]?\d{1,4}|ep[\s._-]?\d{1,4})\b/gi, ' ');
  c2 = c2.replace(/\b(?:hindi|dubbed|dub|subbed|sub|720p|1080p|480p|web[\s.-]?dl|bluray|hevc|x264|x265)\b/gi, ' ');
  c2 = c2.replace(/\s+/g, ' ').replace(/^[\s\-_:.,]+|[\s\-_:.,]+$/g, '').trim();
  return c2.length >= 2 ? c2 : (before || String(t || ''));
}
async function twrStreams(base, tag, title, type, s, e, pre) {
  if (!base || !title) return [];
  const tRaw = String(title);
  const tCore = showCore(tRaw); // v1.15.4: // v1.15.4: any format -> canonical show name — search/season-variants/alt/gate/cache all run on the core; card text keeps the user's original name
  // v1.15.8: // v1.15.8: no twr cache — a fresh resolver query per tap (a miss is never pinned); prewarm keeps the resolver warm so speed is preserved
  const t3 = Date.now();
  const tries = [tCore]; // v1.15.4: // v1.15.4: canonical first (pure-name core === original — behavior unchanged)
  if (tCore.toLowerCase() !== tRaw.toLowerCase()) tries.push(tRaw); // // if the format was mangled, race the original in wave 1 too
  const sq = tRaw.replace(/[^A-Za-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]/g, ''); // // squash spaces/punctuation as a fallback
  if (sq && !tries.some(t2 => t2.toLowerCase() === sq.toLowerCase())) tries.push(sq);
  // v1.15.3: Season-// v1.15.3: season-capable variants race in wave 1 (the old sequential fallback summed 5+6=11s > the 9.3s window -> One Piece-class titles were cut);
  // // mass-test proof: running in parallel harms no show — whichever format answers first wins (Naruto = plain, One Piece/JJK = Season form)
  const seasTry = (type === 'series' && s && tag === 'toonworld') ? [tCore + ' Season ' + s] : []; // v1.15.4: // v1.15.4: core-based (no 'One Piece S1E1 Season 1'-style abominations)
  // v1.13.5 // v1.13.5 parallel fan-out: original+squash together, alt lookups race too — no sequential-wait summing (wall time = one try's time)
  const altP = tmdbAltTitles(tCore);
  const first = tries.concat(seasTry.filter(a => !tries.some(t => t.toLowerCase() === a.toLowerCase())));
  const w1 = first.map(t => twrFetch(base, tag, t, type, s, e, t3));
  tries.push(...first.slice(tries.length));
  // v1.15.3 // v1.15.3 first-winner race: Promise.all waited for slow siblings (a Season variant answering 3 results in 1s still waited for a 10-12s slow scrape -> window cut);
  // // now whichever try answers non-empty first wins; fallbacks only when all are empty
  let used = -1;
  {
    let settled = false;
    const anyHit = new Promise(res => w1.forEach((p1, i1) => p1.then(v => { if (!settled && v && v.length) { settled = true; res(i1); } }).catch(() => {})));
    const allDone = Promise.all(w1.map(p1 => p1.catch(() => []))).then(() => -1);
    used = await Promise.race([anyHit, allDone]);
  }
  let r0 = used >= 0 ? await w1[used] : [];
  if (!r0.length) { // // last fallback: season-capable title + TMDB alt title — all together, first winner in priority order
    // v1.15.2 // v1.15.2 mass-test proof: TW catalog matching is query-form dependent — One Piece/Jujutsu Kaisen answer 3 results on 'X Season N' (0 on plain titles);
    // Naruto-// Naruto is the opposite (plain=3, season=0) — so the season variant is fallback-only (where plain wins, wave 1 already wins)
    const tSq = tCore.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]/g, '');
    const lcs4 = a => { // // a >=4-char common segment of the two squashed titles — else a translation/abbreviation-born meaningless alt
      const aSq = String(a).toLowerCase().replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]/g, '');
      for (let i = 0; i + 4 <= aSq.length; i++) if (tSq.indexOf(aSq.slice(i, i + 4)) >= 0) return true; // aSq-// is any 4-char segment of aSq inside tSq
      return false;
    };
    const seas = type === 'series' ? [tCore + ' Season ' + s, tCore + ' Season ' + String(s).padStart(2, '0')] : [];
    const alts = (await altP).filter(a => !tries.some(t => t.toLowerCase() === String(a).toLowerCase()) && lcs4(a)).slice(0, 4);
    const extra = seas.concat(alts).filter(a => !tries.some(t => t.toLowerCase() === String(a).toLowerCase()));
    tries.push(...extra);
    // v1.15.9: Promise.all → // v1.15.9: Promise.all -> first-winner race (the proven wave-1 pattern) — the fallback no longer waits for all 5 variants:
    // // whichever variant answers first wins (less resolver hammering — the site throttles less in cold windows), slow siblings stop wasting time
    const w2 = extra.map(a => twrFetch(base, tag, a, type, s, e, t3));
    if (w2.length) {
      let settled2 = false;
      const anyHit2 = new Promise(res => w2.forEach((p2, i2) => p2.then(v => { if (!settled2 && v && v.length) { settled2 = true; res(i2); } }).catch(() => {})));
      const allDone2 = Promise.all(w2.map(p2 => p2.catch(() => []))).then(() => -1);
      const u2 = await Promise.race([anyHit2, allDone2]);
      if (u2 >= 0) { r0 = await w2[u2]; used = tries.length - extra.length + u2; }
    }
  }
  if (r0.length) {
    if (used >= 0 && tries[used].toLowerCase() !== tRaw.toLowerCase()) r0 = r0.map(z => { // // card text keeps the user's original display title (v1.15.4: remap even on a core win)
      const t2 = String(z.title || '').split(tries[used]).join(tRaw);
      return Object.assign({}, z, { title: t2, description: t2 });
    });
  } // v1.15.8: // v1.15.8: nothing is pinned
  if (DBG) console.error('[twr] ' + tag + ' ' + String(title).slice(0, 30) + ' S' + (s || 1) + 'E' + (e || 1) + ' -> ' + r0.length + ' cards @' + (Date.now() - t3) + 'ms');
  return r0;
}

const ALTCACHE = new Map(); // // name -> latin alt titles[] — remembered once per miss
async function tmdbAltTitles(name) {
  const k0 = String(name).toLowerCase();
  if (ALTCACHE.has(k0)) return ALTCACHE.get(k0);
  const out = [];
  try {
    const b = await tmdbGet('/search/multi?query=' + encodeURIComponent(String(name)), 8000);
    const hit = ((JSON.parse(b)).results || [])[0];
    if (hit && hit.id != null) {
      const ty = hit.media_type === 'movie' ? 'movie' : 'tv';
      const b2 = await tmdbGet('/' + ty + '/' + hit.id + '/alternative_titles', 8000);
      const arr = ((JSON.parse(b2)).results || []).map(r => String(r.title || '')).filter(t => t && /^[\x20-\x7E]+$/.test(t) && t.toLowerCase() !== k0);
      out.push(...arr.slice(0, 6));
    }
  } catch (_) {}
  ALTCACHE.set(k0, out);
  if (ALTCACHE.size > 1200) ALTCACHE.clear();
  return out;
}

function twTitleOk(title, fn) { // v1.13.5 // v1.13.5 wrong-title blocker: the resolver's token gate slips ("Breaking Bad" -> "The Bad Guys Breaking In") — every word of the query must appear in order
  const c = String(fn || '').replace(/^\[[^\]]*\]\s*/, '').replace(/[\u2018\u2019\u02BC']/g, '').toLowerCase(); // v1.15.11c: // v1.15.11c: apostrophes stripped, one token (I'll -> ill)
  const q = String(title || '').toLowerCase().replace(/[\u2018\u2019\u02BC']/g, '').replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]+/g, ' ').trim();
  if (!c || !q) return true; // // unjudgeable -> let it pass
  const qt = q.split(' ');
  const cts = c.replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]+/g, ' ').trim().split(' ');
  const qs2 = q.split(' ').join('');
  if (qs2.length >= 5 && cts.join('').indexOf(qs2) >= 0) return true; // // squash-phrase — only for >=5-char queries (stops small "bb"-"dubbed" collisions)
  let i = 0;
  for (const t of cts) { if (t === qt[i]) i++; }
  return i >= Math.min(qt.length, Math.max(2, Math.ceil(qt.length * 0.6))); // v1.15.11: RT-// v1.15.11: RT post titles are often just the query's start -> 60% sequential match
}

async function twrFetch(base, tag, title, type, s, e, t3) {
  const qs = new URLSearchParams({ source: tag, title: String(title || '').replace(/[\u2018\u2019\u02BC]/g, "'"), _: String(Date.now()) }); // v1.15.11: // v1.15.11: unicode-safe query params
  if (type === 'series') { qs.set('season', String(s || 1)); qs.set('episode', String(e || 1)); }
  try {
    if (DBG) console.error('[twrURL] ' + base + '/find?' + qs.toString());
    const FU = base + '/find?' + qs.toString(); let b = '';
    if (HUB && !process.env.TWRT_BRIDGE) { // v1.15.63: TWRT_BRIDGE=// v1.15.63: with TWRT_BRIDGE this branch is off — the resolver bridge itself consumes the tw/rt sub-spaces (the user's final map: vidy=vidy/moviebox/multimovies, resolver=tw/rt)
      try {
        const sp2 = HSPACE(tag); const kp = HKEY(sp2) ? '&key=' + encodeURIComponent(HKEY(sp2)) : '';
        const hr = await fetch(HUB + '/fetch?src=' + encodeURIComponent(sp2) + kp + '&ms=8000&url=' + encodeURIComponent(FU), { signal: AbortSignal.timeout(9500) });
        const hj = await hr.json();
        if (hj && hj.ok && String(hj.body || '')[0] === '{') { b = String(hj.body); console.error('[twrHUB] ' + tag + '-space-px=' + hj.px + ' ✓'); }
        else if (hj && hj.px) fetch(HUB + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ px: hj.px, ok: false, src: sp2 }) }).catch(() => { }); // echo-// echo-trap/crooked body -> drop the proof (it gets demoted from the wave's space)
      } catch { }
    }
    if (!b) b = await directGet(FU, 30000);
    const j = JSON.parse(b);
    // v1.12.3: twr-// v1.12.3: twr cards also in the uniform video format (⧉ Title / ⧠ SsEe • EpTitle / ⨞ Server ⌧ Audio) — resolution only as a name badge, always 1080 (not Auto/360 labels)
    const raws = ((j && j.results) || []).filter(x => x && typeof x.url === 'string' && /^https?:/.test(x.url));
    const cat0 = (j && j.catalog) || {}; // raretoons-// raretoons match-post identity — two shapes: {show} (index path) / {live: slug} (live path)
    const catShow = String(cat0.show || cat0.live || '').replace(/-/g, ' ');
    const named = raws.filter(x => { // // judgeable name = >=4 chars, not a generic MQ-HLS name
      const nm = String(x.name || '');
      return nm.length >= 4 && !/\b(raretoons|toonworld)?\s*mq\b/i.test(nm);
    });
    const qG = showCore(title); // v1.15.4 // v1.15.4 gate fix: the verdict only on the pure show name — 'Season 1'-style query tokens never reach card text (so/se matches are resolved earlier anyway)
    const keep = catShow ? twTitleOk(qG, catShow) // // with a match-post, that is the final verdict
          : (named.length ? named.some(x => twTitleOk(qG, x.name)) : false); // // else verdict by named cards; all-generic + unidentified -> drop (kills wrong-show MQ links — sound policy)
    if (DBG) console.error('[twrGATE] ' + tag + ' title=' + String(title).slice(0, 34) + ' cat=' + (catShow || '(none)').slice(0, 50) + ' named=' + named.length + '/' + raws.length + ' keep=' + keep + ' names=' + raws.map(x => String(x.name || '').slice(0, 26)).join(' | ').slice(0, 110));
    const arr = (keep ? raws : []).map(x => {
      const hq = parseInt(String(x.quality || ''), 10) || 0; // // the resolver's real height — for the twq filter
      const fn = String(x.name || '');
      const q2 = '1080';
      const lang = String(x.lang || '');
      const audio = lang || (/\b(multi|dual)\b/i.test(fn) ? 'Multi Audio' : 'Hindi Audio');
      const epLine = type === 'series' ? ('\u29e0 S' + (s || 1) + 'E' + (e || 1) + ((x.ep_title || '') ? ' \u2022 ' + x.ep_title : '')) : '\u29e0 Movie';
      const lbl = tag === 'toonworld' ? 'ToonWorld' : 'RareToons';
      const hu = String(x.url || '');
      const host = /pixeldrain/.test(hu) ? 'Pixeldrain' : (x.kind === 'hls' || /\/hls\//.test(hu)) ? 'MQ' : /hubcloud|yournewdomain/.test(hu) ? 'HubCloud' : 'Direct';
      const txt = '\u29c9 ' + String(title) + '\n' + epLine + '\n\u229e ' + lbl + ' \u00b7 ' + host + ' \u2317 ' + audio;
      return {
        name: '\u25a5 ' + q2 + ' \u25a5',
        title: txt,
        description: txt,
        quality: q2,
        _hq: hq,
        _lang: lang,
        url: String(x.url),
        behaviorHints: { notWebReady: false, isBingeable: true, filename: fn || (tag === 'toonworld' ? 'toonworld.mkv' : 'raretoons.mkv') },
        bingeGroup: (tag === 'toonworld' ? 'tw|' : 'rt|') + String(title).toLowerCase() + '::|' + (lang || 'Hindi')
      };
    });
    if (DBG) console.error('[twr] ' + tag + ' ' + String(title).slice(0, 30) + ' S' + (s || 1) + 'E' + (e || 1) + ' -> ' + arr.length + ' cards @' + (Date.now() - t3) + 'ms');
    return arr;
  } catch (e2) {
    if (DBG) console.error('[twr] ' + tag + ' ERR ' + String(e2 && e2.message).slice(0, 70) + ' @' + (Date.now() - t3) + 'ms');
    return [];
  }
}

/* ---------- Watchout (v1.15.39: TMDB-native public index; server-friendly, referer-keyed) ---------- */
const WOBASE = String(process.env.WOBASE || 'https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main'); // // stream index (movies: hls/movie/{tmdb}, tv: hls/tv/{tmdb})
const WO_REF = 'https://vidout.pages.dev/'; // // the secret key: this exact Referer opens the stream CDN (404 without it)
const VB_REF = 'https://vidbolt.xyz/'; // v1.15.46: vidbolt-MM-// v1.15.46: vidbolt-MM resolver referer (professional constant — no hardcoding)
// v1.15.52: // v1.15.52: persistent hash memory — during vidbolt rotation, cards from a previously seen animecurx hash (proof: old hashes stay playable for days; rotation sometimes empties Lanterns mid-way)
const MMHC_FILE = require('path').join(__dirname, 'vidy_mm_hashes.json');
const MMHC = new Map();
try { for (const [kk, vv] of Object.entries(JSON.parse(require('fs').readFileSync(MMHC_FILE, 'utf8')))) MMHC.set(kk, vv); } catch { }
let MMHC_T = null;
const MM_MC = new Map(); // v1.15.55 // v1.15.55 bug#9: m -> {ts, raw} — 60s master-text cache (stops re-traveling upstream on every player re-request; segments still go CDN-direct)
const MM_VC = new Map(); // v1.15.55: vbq → {ts, m} — // v1.15.55: vbq -> {ts, m} — 60s sticky-resolve memory (no hammering vidbolt resolve)
function mmPut(map, k, v) { if (map.size > 300) map.clear(); map.set(k, { ts: Date.now(), v }); }
function mmGet(map, k, ttl) { const e = map.get(k); return e && (Date.now() - e.ts) < ttl ? e.v : null; }
function mmhcSave() { if (MMHC_T) return; MMHC_T = setTimeout(() => { MMHC_T = null; try { require('fs').writeFileSync(MMHC_FILE, JSON.stringify(Object.fromEntries(MMHC))); } catch { } }, 4000); }
function mmhcKey(isSeries, tmdbId, s2, e2) { return isSeries ? ('tv:' + tmdbId + ':' + (parseInt(s2, 10) || 1) + ':' + (parseInt(e2, 10) || 1)) : ('mv:' + tmdbId); }
const WO_LANGS = { eng: 'English', en: 'English', hin: 'Hindi', hi: 'Hindi', ara: 'Arabic', fra: 'French', spa: 'Spanish', por: 'Portuguese', rus: 'Russian', zho: 'Chinese', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu' };
function woAudioTag(pl) { // v1.15.47: // v1.15.47: truthful audio claim — EXT-X-MEDIA:TYPE=AUDIO count in the master playlist (user proof: most streams have exactly one audio; 'Multi Audio' labels lie)
  if (!pl) return '';
  const langs = [...String(pl).matchAll(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*/g)].map(m => {
    const l = (String(m[0]).match(/LANGUAGE="([^"]+)"/i) || [])[1] || (String(m[0]).match(/NAME="([^"]+)"/i) || [])[1] || '';
    return String(l).trim();
  }).filter(l => l && !/^(audio|def|main|default)$/i.test(l));
  const uniq = [...new Set(langs)];
  if (uniq.length >= 2) return uniq.length + ' Audio (' + uniq.slice(0, 3).join('+') + ')';
  if (uniq.length === 1) return uniq[0];
  return '';
}
function mmMiniKey(m, ref, h, vbq) { // v1.15.53: // v1.15.53: stateless — the key carries everything (master|ref|height|vbq); .48's server memory map died on restart/deploy/another instance
  return Buffer.from(m + '|' + (ref || WO_REF) + '|' + (h | 0) + '|' + (vbq || '')).toString('base64url');
}
function mmMiniOpen(k) { // // recover params from the key — any instance, any time
  try {
    const pp = Buffer.from(k, 'base64url').toString('utf8').split('|');
    if (pp.length < 3 || !/^https?:\/\//.test(pp[0])) return null;
    return { m: pp[0], ref: pp[1] || WO_REF, h: parseInt(pp[2], 10) || 0, vbq: pp[3] || '' };
  } catch { return null; }
}
function mmMiniBuild(masterUrl, wantH, raw) { // v1.15.49: // v1.15.49: all qualities stay (switchable in the player menu — user proof: a single-variant mini has no options), the wanted one first
  const L = String(raw).split('\n'); const tags = []; const vars = [];
  for (let i = 0; i < L.length; i++) {
    let ln = L[i];
    if (ln.charAt(0) === '#' && /EXT-X-(MEDIA|KEY|MAP|I-FRAME-STREAM-INF|SESSION)/.test(ln)) { tags.push(ln.replace(/URI="([^"]*)"/g, (mm, uu) => { try { return 'URI="' + new URL(uu, masterUrl).href + '"'; } catch { return mm; } })); continue; }
    if (/^#EXT-X-STREAM-INF/.test(ln)) {
      const nxt = L[i + 1] && L[i + 1].charAt(0) !== '#' ? L[i + 1].trim() : '';
      if (!nxt) continue;
      const r2 = (ln.match(/RESOLUTION=(\d+)x(\d+)/i) || [])[2];
      const hh = r2 ? parseInt(r2, 10) || 0 : 0;
      let abs2 = nxt; try { abs2 = new URL(nxt, masterUrl).href; } catch { }
      vars.push({ ln: ln, uri: abs2, h: hh, w: hh === wantH ? 0 : 1 });
      i++;
      continue;
    }
  }
  vars.sort((a, b) => a.w - b.w || b.h - a.h); // // wanted quality first, then high to low
  const seenK = new Set(); const out = tags.slice();
  for (const v of vars.slice(0, 6)) { if (seenK.has(v.uri)) continue; seenK.add(v.uri); out.push(v.ln, v.uri); }
  if (!vars.length) return null; // // no variants -> caller falls back to raw
  return out.join('\n');
}
function woHasAudioGrp(pl) { // v1.15.47: EXT-X-MEDIA:TYPE=AUDIO = // v1.15.47: EXT-X-MEDIA:TYPE=AUDIO = audio in an external group -> variant-only video (HLS spec); without the master URL the player gets no audio
  return /#EXT-X-MEDIA:TYPE=AUDIO/i.test(String(pl || ''));
}
function woPoolText(url, ms) { // v1.15.44: // v1.15.44: direct first; vidy's own pool only for rescue — .42/.43 flooded ~40 pool probes per tap and drowned the shared pool + PX pipeline
  const T = ms || 7000;
  return fetch(url, { headers: { 'User-Agent': UA, Referer: VB_REF }, signal: AbortSignal.timeout(Math.ceil(T * 0.55)) }).then(x => x.ok ? x.text() : '').catch(() => '').then(t => {
    if (t) return t;
    const sk = String(url).indexOf('vidbolt') >= 0 ? 'vb' : 'wo';
    if (HUB) return hubText(url, T, sk).then(h2 => h2 || racePool(url, 4, Math.ceil(T * 0.4), sk).then(r => String(r.body || '')).catch(() => '')).catch(() => ''); // v1.15.57: // v1.15.57: hub pool first -> local-race fallback
    return racePool(url, 4, Math.ceil(T * 0.4), sk).then(r => String(r.body || '')).catch(() => '');
  });
}
function woFetch(url, ms) {
  return fetch(url, { headers: { 'User-Agent': UA, Referer: WO_REF, Accept: '*/*' }, signal: AbortSignal.timeout(ms || 7000) });
}
async function woSubs(tmdb, type, s, e, ms) { // sub/tv/{id}/{s}/{e}/subtitles.json | sub/movie/{id}/subtitles.json
  try {
    const u = type === 'series' ? (WOBASE + '/sub/tv/' + tmdb + '/' + (parseInt(s, 10) || 1) + '/' + (parseInt(e, 10) || 1) + '/subtitles.json') : (WOBASE + '/sub/movie/' + tmdb + '/subtitles.json');
    const r = await woFetch(u, Math.min(5000, ms || 5000));
    if (!r.ok) return [];
    const d = await r.json().catch(() => null);
    const subs = (d && d.subtitles) || {};
    return Object.keys(subs).slice(0, 8).map(k => ({ url: String(subs[k]), lang: WO_LANGS[String(k).toLowerCase()] || String(k).toUpperCase() })).filter(x => /^https?:/.test(x.url));
  } catch { return []; }
}
async function woVidbolt(tmdbId, isSeries, s, e, ms) { // v1.15.46: MM-// v1.15.46: full MM-resolver use — all sources (hls bridge + direct MP4), kind/quality/language fields intact
  const vT0 = Date.now(); const vLeft = cap => Math.max(350, Math.min(cap, (ms || 6500) - (Date.now() - vT0)));
  try {
    const q = isSeries ? ('type=tv&id=' + tmdbId + '&season=' + (parseInt(s, 10) || 1) + '&episode=' + (parseInt(e, 10) || 1)) : ('type=movie&id=' + tmdbId);
    const ck = mmhcKey(isSeries, tmdbId, s, e);
    const out = []; const oseen = new Set();
    const push = (h, url, ref, mp4, lang, aud, mini, k) => { const kk = k || url; if (kk && !oseen.has(kk)) { oseen.add(kk); out.push({ h: h | 0, url: url, ref: ref, mp4: mp4 ? 1 : 0, lang: lang || '', aud: aud || '', mini: mini ? 1 : 0, vbq: mini ? q : '' }); } };
    for (let draw = 0; draw < 3; draw++) { // v1.15.54: // v1.15.54: a different server per rotation draw — on a dead draw (0 results) retry after 450ms; proof: different servers at the same moment
      let j = null;
      const jtxt = await woPoolText('https://vidbolt.xyz/api/resolve?' + q, vLeft(6500));
      try { j = jtxt ? JSON.parse(jtxt) : null; } catch { }
      let srcs = (j && j.stream && Array.isArray(j.stream.sources) ? j.stream.sources : []).slice(0, 8);
      if (!srcs.length) { // // rotation gap -> memory hashes (direct master; the pipeline verifies itself — honest empty if dead)
        const cm = MMHC.get(ck);
        if (cm && cm.m) { if (DBG) console.error('[mm] hash-memory used ' + ck); srcs = [{ url: cm.m, kind: 'hls', quality: cm.q || '', language: cm.lang || '' }]; }
        if (!srcs.length) continue;
      } else {
        for (const sc of srcs) { // // remember hashes of permanent nature (exclude signed other-hosts — those die at expiry)
          const hm = sc && sc.url && String(sc.url).match(/\/tvshows\/([a-f0-9]{8,40})\/index\.m3u8/);
          if (hm) { MMHC.set(ck, { m: sc.url, q: String(sc.quality || ''), lang: String(sc.language || ''), at: Date.now() }); mmhcSave(); break; }
        }
        if (MMHC.size > 2500) { const cut = Date.now() - 30 * 86400e3; for (const [kk2, vv2] of MMHC) if (vv2.at < cut) MMHC.delete(kk2); }
      }
    await Promise.all(srcs.map(async sc => {
      const u = sc && sc.url;
      if (!u || !/^https?:/.test(u)) return;
      const hq = parseInt(String(sc.quality || ''), 10) || 0;
      const lang = String(sc.language || '').trim();
      if (String(sc.kind || '').toLowerCase() === 'mp4' || /\.mp4($|\?)/i.test(u)) { // // direct MP4 (proxy.vidbolt.xyz) — straight card on a HEAD check; no playlist needed
        try {
          const hd = await fetch(u, { headers: { 'User-Agent': UA, Referer: VB_REF }, method: 'GET', signal: AbortSignal.timeout(vLeft(4500)) }); // // proven: this proxy passes proxy.vidbolt.xyz
          if (hd.ok) { try { if (hd.body) hd.body.cancel(); } catch { } push(hq, u, VB_REF, 1, lang); } // // headers alone are enough — cancel the body (no point pulling 1.45GB)
        } catch { }
        return;
      }
      try {
        const pl = await woPoolText(u, vLeft(5500)); // hls-// hls bridge — direct first, pool for rescue
        if (!pl || pl.indexOf('#EXTM') < 0) return;
        let base = u; try { base = new URL(u).href.replace(/[^/]*$/, ''); } catch { }
        const lines = pl.split('\n'); let found = 0; const atag = woAudioTag(pl); // v1.15.47: // v1.15.47: this playlist's truthful audio
        if (woHasAudioGrp(pl)) { // // audio group declared -> one mini-master card per quality (resolution pinned + audio intact; v1.15.48)
          let pcount = 0;
          for (let jj = 0; jj < lines.length - 1 && pcount < 4; jj++) {
            if (lines[jj].indexOf('#EXT-X-STREAM-INF') < 0) continue;
            const r2 = lines[jj].match(/RESOLUTION=(\d+)x(\d+)/i);
            const hh = r2 ? parseInt(r2[2], 10) || 0 : 0;
            const kk = 'm' + hh;
            if (oseen.has(kk)) continue;
            oseen.add(kk);
            push(hh || hq, u, VB_REF, 0, lang, atag, 1, kk);
            pcount++;
          }
          if (!pcount) push(hq, u, VB_REF, 0, lang, atag, 1, 'mx');
          return;
        }
        for (let jj = 0; jj < lines.length - 1 && found < 3; jj++) {
          if (lines[jj].indexOf('#EXT-X-STREAM-INF') < 0) continue;
          const rm = lines[jj].match(/RESOLUTION=(\d+)x(\d+)/i);
          const uri = String(lines[jj + 1] || '').trim();
          if (!uri || uri.charAt(0) === '#') continue;
          let abs = uri; try { abs = new URL(uri, base).href; } catch { }
          push(rm ? parseInt(rm[2], 10) || 0 : hq, abs, VB_REF, 0, lang, atag);
          found++;
        }
        if (!found && /#EXTINF/.test(pl)) push(hq, u, VB_REF, 0, lang, atag); // // media playlist direct — height from the quality field
      } catch { }
    }));
      if (DBG) console.error('[mm] vb draw-' + draw + ' sources=' + srcs.length + ' out=' + out.length + ' @' + (Date.now() - vT0) + 'ms');
      if (out.length) break;
      if (draw < 2 && vLeft(1500) > 800) await new Promise(r3 => setTimeout(r3, 450));
    }
    return out.slice(0, 10);
  } catch { return []; }
}

async function woStreams(tmdbId, title, type, s, e, cfg, origin) { // origin: v1.15.48-// origin: for the v1.15.48 mini-master URL // TMDB id direct — no title matching needed
  if (!WOBASE || !tmdbId) return [];
  const t3 = Date.now(); const WOB = 9000; const left = () => Math.max(300, WOB - (Date.now() - t3));
  try {
    const isSeries = type === 'series';
    const u = isSeries ? (WOBASE + '/hls/tv/' + tmdbId + '/S' + (parseInt(s, 10) || 1) + '.json') : (WOBASE + '/hls/movie/' + tmdbId);
    const vbP = woVidbolt(tmdbId, isSeries, s, e, left()).catch(() => []); // v1.15.41: // v1.15.41: parallel — index present or not
    const idxRes = await woFetch(u, left()).catch(() => null); // v1.15.45: // v1.15.45: direct woFetch(WO_REF) — a headerless pool race on the vidout index path guaranteed 404s
    const idxTxt = idxRes && idxRes.ok ? await idxRes.text().catch(() => '') : '';
    const r0ok = !!idxTxt;
    let servers = [];
    if (r0ok) {
      if (isSeries) {
        const d = (() => { try { return JSON.parse(idxTxt); } catch { return null; } })();
        const ep = String(parseInt(e, 10) || 1);
        if (d && typeof d[ep] === 'string') servers = [d[ep]]; // // the exact episode — never the wrong one (honest)
      } else {
        const txt = idxTxt.trim();
        if (txt && /^https?:/.test(txt)) servers = [txt.split('\n')[0].trim()];
      }
    }
    servers = servers.slice(0, 6);
    const lists = servers.length ? await Promise.all(servers.map(su => woFetch(su, Math.min(6500, left())).then(x => x.ok ? x.text() : '').catch(() => ''))) : []; // v1.15.45: // v1.15.45: parallel
    const woq = Array.isArray(cfg && cfg.woq) ? cfg.woq : [];
    const seen = new Set(); const raws = [];
    for (let i = 0; i < lists.length; i++) {
      const pl = lists[i];
      if (!pl || pl.indexOf('#EXTM') < 0) continue;
      let base = servers[i]; try { base = new URL(servers[i]).href.replace(/[^/]*$/, ''); } catch { }
      const atag = woAudioTag(pl); // v1.15.47: // v1.15.47: truthful audio (e.g. Squid Game hi+en)
      const lines = pl.split('\n'); // // declared earlier (TDZ bug fix)
      if (woHasAudioGrp(pl)) { // // audio group declared -> one mini-master card per quality (resolution pinned + audio intact; v1.15.48)
        let pcount = 0;
        for (let j2 = 0; j2 < lines.length - 1 && pcount < 4; j2++) {
          if (lines[j2].indexOf('#EXT-X-STREAM-INF') < 0) continue;
          const r3 = lines[j2].match(/RESOLUTION=(\d+)x(\d+)/i);
          const hh = r3 ? parseInt(r3[2], 10) || 0 : 0;
          const kk = 'm' + i + 'h' + hh;
          if (seen.has(kk)) continue;
          seen.add(kk);
          raws.push({ h: hh, url: servers[i], aud: atag, mini: 1 });
          pcount++;
        }
        if (!pcount && !seen.has(servers[i])) { seen.add(servers[i]); raws.push({ h: 0, url: servers[i], aud: atag, mini: 1 }); }
        continue;
      }
      let found = 0;
      for (let j = 0; j < lines.length - 1; j++) {
        if (lines[j].indexOf('#EXT-X-STREAM-INF') < 0) continue;
        const rm = lines[j].match(/RESOLUTION=(\d+)x(\d+)/i);
        const uri = String(lines[j + 1] || '').trim();
        if (!uri || uri.charAt(0) === '#') continue;
        let abs = uri; try { abs = new URL(uri, base).href; } catch { }
        const h = rm ? parseInt(rm[2], 10) || 0 : 0;
        if (!seen.has(abs)) { seen.add(abs); raws.push({ h, url: abs, aud: atag }); found++; }
        if (found >= 6) break;
      }
      if (!found && /#EXTINF/.test(pl) && !seen.has(servers[i])) { seen.add(servers[i]); raws.push({ h: 0, url: servers[i], aud: atag }); } // // master-level fallback
    }
    try { const vbl = await vbP; for (const v of (vbl || [])) if (v && v.url && !seen.has(v.url)) { seen.add(v.url); raws.push(v); } } catch { } // v1.15.41: vidbolt-// v1.15.41: vidbolt results merge in parallel too
        if (DBG) console.error('[mm] ' + tmdbId + '/' + (isSeries ? 'S' + (s || 1) + 'E' + (e || 1) : 'movie') + ' servers=' + servers.length + ' variants=' + raws.length + ' @' + (Date.now() - t3) + 'ms');
    let vars = raws.filter(x => !woq.length || woq.indexOf(x.h) >= 0);
    vars.sort((a, b) => b.h - a.h);
    vars = vars.slice(0, 12);
    if (!vars.length) return [];
    const subs = await woSubs(tmdbId, type, s, e, left()).catch(() => []);
    const T = String(title || 'Multimovies');
    const epLine = isSeries ? ('\u29e0 S' + (parseInt(s, 10) || 1) + 'E' + (parseInt(e, 10) || 1)) : '\u29e0 Movie';
    return vars.map(x => {
      const q2 = x.h ? String(x.h) : (x.mp4 ? 'MP4' : 'HLS');
      const aud = [x.aud, x.lang].filter(Boolean).join(' \u00b7 '); // v1.15.47: // v1.15.47: truthful audio count + vidbolt language — nothing written when there is no claim
      const txt = '\u29c9 ' + T + '\n' + epLine + '\n\u229e Multimovies \u00b7 ' + (x.mp4 ? 'MM-MP4' : 'MM-HLS') + (aud ? ' \u2317 ' + aud : '') + (subs.length ? ' \u2022 \ud83c\udfac' : '');
      return {
        name: '\u25a5 ' + q2 + ' \u25a5',
        title: txt,
        description: txt,
        quality: q2,
        url: x.mini ? (origin ? origin + '/mm/' + mmMiniKey(x.url, x.ref || WO_REF, x.h, x.vbq) + '/mini.m3u8' : x.url) : x.url, // v1.15.49: +vbq — // v1.15.49: +vbq — a bright signature that survives player refresh
        behaviorHints: { notWebReady: false, isBingeable: true, filename: x.mp4 ? 'multimovies.mp4' : 'multimovies.m3u8', proxyHeaders: { request: { Referer: x.ref || WO_REF, 'User-Agent': UA } } }, // v1.15.41: // multimovies shape
        bingeGroup: 'mm|' + T.toLowerCase() + '::',
        ...(subs.length ? { subtitles: subs.map(y => ({ url: y.url, lang: y.lang })) } : {})
      };
    });
  } catch (e2) {
    if (DBG) console.error('[mm] ERR ' + String(e2 && e2.message).slice(0, 70) + ' @' + (Date.now() - t3) + 'ms');
    return [];
  }
}

// ---------- // ---------- multi-source merge (a general form of withNx — same grace budget, all sources race together) ----------
async function withSources(cardsP, srcs, cfg, t0) {
  const cards = await cardsP.catch(e => { if (DBG) console.error('[srcdbg] cardsP died: ' + String(e && e.message || e).slice(0, 90)); return []; });
  const live = (srcs || []).filter(x => x && x.p && !(cfg && cfg[x.key] === 0));
  if (!live.length) return cards; // // everything off -> zero wait
  try {
    const el = Date.now() - t0;
    // v1.14.6 // v1.14.6 unified first-click deadline (user top priority: first click for every selected source):
    // // all live sources share one absolute limit ~9.3s (inside root safety 10s / edge cut 12s) — whichever source settles first,
    // // the answer follows it (2-5s when fast), while slow sources get the maximum time before being cut. Separate 5.5/8.5s windows dropped —
    // // prod child/resolver latency wobble made separate windows miss the first click (MB sometimes 16 cards at 6.6s, sometimes >5.5s).
    const uniLeft = Math.max(0, Math.min(NXDEADLINE, 10800) - el); // v1.15.12: // v1.15.12: first-click limit 9.3->10.8s (user report: n=0 at the boundary; log proof tt7326322 10s -> 0)
    let errFlag = false; // v1.15.3: // v1.15.3: a source error (rebuild/network) is not a real empty — count it as partial
    const outs = await Promise.all(live.map(x => Promise.race([
      x.p.catch(() => { errFlag = true; return []; }),
      new Promise(r => setTimeout(() => r(null), uniLeft))
    ])));
    let all = cards.slice();
    for (let i = 0; i < live.length; i++) {
      const v = outs[i];
      if (!v || !v.length) continue;
      if (live[i].key === 'nx') {
        const nxAllow = qToList(cfg && cfg.nxq);
        const nxSel = Array.isArray(cfg && cfg.nxl) ? cfg.nxl : [];
        const strict = v.filter(z => qPass(z, nxAllow) && nxLangPass(z, nxSel));
        if (strict.length || !v.length) all = all.concat(strict); // // strict match when present
        else { // v1.15.14 // v1.15.14 loose fallback: when the strict combo is 0, take what is close (quoted case: only-1080 = Kannada, English/Hindi only 480p -> used to be a total zero)
          const qOnly = v.filter(z => qPass(z, nxAllow));
          all = all.concat(qOnly.length ? qOnly : v);
          if (DBG) console.error('[nxFALLBACK] strict=0 -> ' + (qOnly.length ? 'quality-only ' + qOnly.length : 'raw ' + v.length) + ' cards');
        }
      } else if (live[i].key === 'rt') {
        const rtSel = Array.isArray(cfg && cfg.rtl) ? cfg.rtl : [];
        all = all.concat(v.filter(z => rtLangPass(z, rtSel)));
      } else if (live[i].key === 'tw') {
        const twAllow = qToList(cfg && cfg.twq); // ToonWorld-// ToonWorld's own chips — at the resolver's real height
        all = all.concat(twAllow.length ? v.filter(z => !z._hq || twAllow.indexOf(z._hq) >= 0) : v);
      } else all = all.concat(v);
    }
    if (DBG) console.error('[srcdbg] withSources el=' + el + 'ms uniLeft=' + uniLeft + 'ms → ' + all.length + ' cards (partial=' + !!all.$partial + ')');
    all.$partial = outs.some(v => v === null) || errFlag; // v1.15.3: // v1.15.3: cut or erroring source -> 90s cache instead of 30min (full upgrade on the next tap)
    return all;
  } catch (e) { if (DBG) console.error('[srcdbg] ERR ' + String(e && e.message).slice(0, 80)); return cards; }
}

// ---------- sources ----------
// // server scores: whatever runs well always goes first (persisted to file — survives restarts):
const SRV_SCORE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_server_scores.json'), 'utf8')); } catch (e) { return {}; } })();
function srvBump(srv, d) {
  SRV_SCORE[srv] = Math.max(-20, Math.min(20, (SRV_SCORE[srv] || 0) + d));
  try { fs.writeFileSync(path.join(__dirname, 'vidy_server_scores.json'), JSON.stringify(SRV_SCORE)); } catch (e) {}
}
const srvOrder = () => SERVERS.slice().sort((a, b) => (SRV_SCORE[b] || 0) - (SRV_SCORE[a] || 0));
// // is the first source URL alive (master-m3u8 is small — a cheap GET; CDNs 403 without Referer):
function probePlaylist(u, hop) { // Auto-HLS-master // reads an Auto-HLS master and extracts the highest real height (ok=200); big bodies cut at 128KB
  return new Promise(resolve => {
    const mod2 = u.indexOf('http:') === 0 ? http : https;
    const req = mod2.get(u, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': VIDY_REFERER, 'Connection': 'close' }, timeout: 3500, agent: u.indexOf('http:') === 0 ? HAGENTP : SAGENTP }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hop || 0) < 2) { res.resume(); return resolve(probePlaylist(new URL(res.headers.location, u).toString(), (hop || 0) + 1)); }
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, h: 0 }); }
      const ch = []; let n = 0;
      res.on('data', d => { n += d.length; if (n <= 131072) ch.push(d); });
      res.on('end', () => {
        const t = Buffer.concat(ch).toString('latin1');
        if ((hop || 0) < 2 && t.trim().charAt(0) === '{') { // player-config JSON (dallas-// player-config JSON (dallas-class) — find the inner .m3u8 and re-probe
          const m3 = (t.match(/https?:[^"'\s]+\.m3u8[^"'\s]*/) || [])[0];
          if (m3) return resolve(probePlaylist(m3, (hop || 0) + 1));
        }
        const hs = [...t.matchAll(/RESOLUTION=\d+x(\d+)/g)].map(m => Number(m[1]));
        let h = hs.length ? Math.max(...hs) : 0;
        if (!h) { // BANDWIDTH-only masters (majorplay): industry ladder heuristic
          const bws = [...t.matchAll(/BANDWIDTH=(\d+)/g)].map(m => Number(m[1]));
          if (bws.length) { const b = Math.max(...bws); h = b >= 2200000 ? 1080 : b >= 900000 ? 720 : b >= 450000 ? 480 : 360; }
        }
        const auds = [...new Set([...t.matchAll(/TYPE=AUDIO[^>'"\n]*?LANGUAGE="([a-zA-Z]{2,3})"/g)].map(m2 => iso3Name(m2[1])).filter(Boolean))]; // // the source's own declaration beats the TMDB guess
        resolve({ ok: true, h, auds });
      });
      res.on('error', () => resolve({ ok: false, h: 0 }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok: false, h: 0 }));
  });
}
function probeAny(urls) { // // first live verdict wins immediately; dead only when all fail
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
      res.destroy(); // // only the status is needed — pulling the playlist body (up to 300KB) is pointless
      resolve(ok);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve(false));
  });
}
function getSources(tmdbId, type, s, e, title, cfg, titleP) { // titleP: // titleP: a title promise — races sources in parallel
  const qsig = (Array.isArray(cfg && cfg.q) ? cfg.q.slice().sort((a, b) => a - b).join('.') : String((cfg && cfg.q) || '')) + ':' + ((cfg && cfg.sub) === 0 ? 0 : 1) + ':' + ((cfg && Array.isArray(cfg.srv) && cfg.srv.length) ? cfg.srv.slice().sort().join('.') : '');
  const key = ['src', VERSION, tmdbId, type, s || '', e || '', qsig].join('|'); // VERSION+cfg-// VERSION+cfg versioned — different filters, different cache
  // v1.15.8 (// v1.15.8 (user): the 3h memo + 60s short memo removed — that was the biggest miss-pinner (miss answers stayed stuck for 3 hours); every tap is a real scan
  return dedupe(key, async () => {
    const epMetaP = epMetaFor(tmdbId, type, s, e); // // year + episode title — parallel with the scan
    const olP = origLangForTmdb(tmdbId, type); // // original audio language (TMDB) — in parallel
    let lastErr = null;
    let force = false;
    let bestAny = null; let bestAnySrv = null; let bestAnyNs = -1; // // the most subtitle-rich (the main-audio marker)
    let deadJ = null;
    let deadSrv = null;
    const t0 = Date.now();
    // v1.11.2: seed-// v1.11.2: seed once up front (previously every one() repeated it on its first await — same latency);
    // // with the path known, budget per path: the proxy chain (429 window) is slower but alive — without a wider budget, successful 4.7-6.3s fetches were dropped
    const sc0 = await getSeed(tmdbId, false).catch(() => null);
    const viaProxy = !!(sc0 && sc0.via === 'proxy');
    const ckFor = srv => ['srvc', VERSION, tmdbId, type, s || '', e || '', srv].join('|');
    const allow = srvOrder().filter(srv => !cfg || !Array.isArray(cfg.srv) || !cfg.srv.length || cfg.srv.indexOf(srv) >= 0); // cfg-// cfg server subset
    const one = async srv => {
      const ck = ['srvc', VERSION, tmdbId, type, s || '', e || '', srv].join('|');
      // v1.15.8 (// v1.15.8 (user): SRV_CACHE/SRV_NEG removed — a live scan per tap; new/missed streams get caught on the very next click
      // // one full server evaluation (seed + sources + probe):
      const tS = Date.now(); // try-// outside try — catch can log it too
      try {
        const sc = (sc0 && !force) ? sc0 : await getSeed(tmdbId, force);
        if (DBG) console.error('[t1g] ' + srv + ' seed=' + (Date.now() - tS) + 'ms via=' + sc.via);
        const q = { mediaType: type, tmdbId: String(tmdbId), enc: '2', seed: sc.seed, title: title || '' };
        if (type === 'tv') { q.seasonId = String(s || 1); q.episodeId = String(e || 1); } // // it was wrongly s/e — upstream ignored these -> always EP1
        const u = API + '/' + srv + '/sources?' + new URLSearchParams(q).toString();
        // v1.11.2 FETCH-HEDGE: // v1.11.2 FETCH-HEDGE: for a stuck upstream answer (phoenix 4.9s, dallas/tampa 7.5s+) one more identical call after +2.5s;
        // // the first success wins, the loser is discarded. Each server still yields one scan result.
        const ct = await hedge2(() => pathGet(u, sc.via, sc.px, 12000), () => pathGet(u, sc.via, sc.px, 12000), 2500, 12500);
        const j = JSON.parse(vidyDecrypt(ct, sc.seed, tmdbId));
        if (DBG) console.error('[t1g] ' + srv + ' fetch=' + (Date.now() - tS) + 'ms n=' + (j.sources || []).length + ' | jkeys=' + Object.keys(j).join(',') + ' | s0=' + JSON.stringify((j.sources || [])[0] || {}).slice(0, 220) + (j.audios ? ' | audios=' + JSON.stringify(j.audios).slice(0, 200) : '') + (j.audio ? ' | audio=' + JSON.stringify(j.audio).slice(0, 120) : ''));
        if (DBG && j.playlist) console.error('[t1g] ' + srv + ' PLAYLIST=' + JSON.stringify(j.playlist).slice(0, 500));
        if (!j.sources || !j.sources.length) {
          if (DBG) console.error('[t1g] ' + srv + ' EMPTY at ' + (Date.now() - tS) + 'ms');
          force = true; return { srv, empty: true };
        }
        // v1.9.0 filter-aware probing: never spend probe time on assets the filter will discard.
        const allowD = Array.isArray(cfg && cfg.q) ? cfg.q : qToList(cfg && cfg.q);
        const pass = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && qPass(x, allowD));
        // v1.11.2 PROBE-RACE: top-2-// v1.11.2 PROBE-RACE: top-2 filter-passing assets probe together; the first live verdict wins instantly,
        // // a dead verdict only after both are dead. A slow/dead first link no longer holds a whole server hostage.
        // v1.11.9: Auto-// v1.11.9: with an Auto label, read the master playlist and store the real highest height
        const autoRows = pass.filter(x => !/^\d{3,4}$/.test(String(x.quality || '').replace('p', '')));
        let autoH = 0;
        // v1.11.11: payload-// v1.15.8 cache-writes removed — fresh per tap
        const masterU = (j.playlist && /^https?:/.test(String(j.playlist))) ? String(j.playlist) : '';
        let pr = masterU ? await probePlaylist(masterU) : null;
        if (!pr || !pr.ok) {
          if (autoRows.length) { let r2 = await probePlaylist(autoRows[0].url); if (!r2.ok && autoRows[1]) r2 = await probePlaylist(autoRows[1].url); if (!pr || r2.ok) pr = r2; }
          else if (pass.length > 1) pr = { ok: await probeAny([pass[0].url, pass[1].url]), h: 0, auds: [] };
          else if (pass.length) pr = { ok: await playable(pass[0].url), h: 0, auds: [] };
          else if (!pr) pr = { ok: true, h: 0, auds: [] }; // zero filter-matches -> probe skipped entirely
        }
        autoH = pr.h || 0;
        if (pr.auds && pr.auds.length) j._audN = pr.auds.join('/'); // // source-declared language — beats the TMDB guess
        const ok = !!pr.ok;
        if (autoH) j.sources.forEach(x => { if (!/^\d{3,4}$/.test(String(x.quality || '').replace('p', ''))) x.quality = autoH + 'p'; });
        const ns = (j.subtitles || []).length;
        const nfit = ok ? decorate(j, type, s, e, title || '', cfg, srv).length : 0;
        if (DBG) console.error('[t1g] ' + srv + ' probe=' + (Date.now() - tS) + 'ms ok=' + ok + ' nfit=' + nfit + ' ns=' + ns);
        // v1.15.8: // v1.15.8: cache writes removed — fresh per tap
        return { srv, j, ok, ns, nfit };
      } catch (er) {
        if (DBG) console.error('[t1g] ' + srv + ' ERR at ' + (Date.now() - tS) + 'ms: ' + String(er && er.message).slice(0, 60));
        force = true; return { srv, err: er };
      }
    };
    const absorb = r => {
      if (r.late) return; // v1.14.2 early-harvest-// v1.14.2 early-harvest cut — no fault, no penalty/negative (it lands in the background cache)
      if (r.neg) return; // // negative hit — no more scoring or penalties
      if (r.err) { srvBump(r.srv, -1); lastErr = r.err; return; }
      if (r.empty) { srvBump(r.srv, 0); return; }
      if (r.ok) {
        if (r.ns > bestAnyNs) { bestAny = r.j; bestAnySrv = r.srv; bestAnyNs = r.ns; }
        srvBump(r.srv, r.nfit > 0 ? (r.ns >= 5 ? 2 : 1) : 0); // // good servers always first
      } else { deadJ = r.j; deadSrv = r.srv; srvBump(r.srv, -1); }
    };
    // // all selected servers in parallel — no stopping early: "all sources = all streams"
    // // per-server hard budget: the giant trio (miami/boise/atlanta) 10.5s — slow but their results are worth it; the rest 7.5s:
    // v1.9.0 fix: the timeout timer used to fire even when one() had already won the race,
    // negative-caching healthy servers for 45-90s after every scan (empty-card windows).
    // Now the neg write only happens when the timeout genuinely fires first.
    let okWave = 0; // v1.14.2 early-harvest: // v1.14.2 early-harvest: how many servers have already won
    const pend = new Map(); // v1.14.2 early-harvest: // v1.14.2 early-harvest: resolvers of still-pending servers
    const budget = srv => {
      let done = false;
      let fire = null;
      const tmo = setTimeout(() => {
        if (done || !fire) return; // one() won — server is healthy, no neg
        if (DBG) console.error('[t1g] ' + srv + ' BUDGET-CUT');
        pend.delete(srv); // v1.14.2: // v1.14.2: settled — keep early-harvest math correct
        fire({ srv, err: new Error('srv-budget') });
      }, GIANT.indexOf(srv) >= 0 ? (viaProxy ? 6500 : 5500) : (viaProxy ? 5500 : 3800)); // v1.15.24 (// v1.15.24 (user: "all cards in 6-7s"): proxy-path budget 8.5/7 -> 6.5/5.5s — vidout needs a snappier wall
      return Promise.race([
        one(srv).then(r => { done = true; clearTimeout(tmo); pend.delete(srv); if (r.ok) okWave++; return r; }), // timer cleared on win — no dangling timeouts
        new Promise(r => { fire = r; pend.set(srv, v => { done = true; clearTimeout(tmo); fire(v); }); }) // v1.14.2: tighten-// v1.14.2: a tighten cut also clears the timer
      ]);
    };
    // // if everyone failed together (e.g. a transient upstream http_500), one auto-retry after 1.2s:
    // v1.14.2 EARLY-HARVEST: // v1.14.2 EARLY-HARVEST: visitor-ready work finishes in ~1s (fetch 0.2-0.6s + probe); pending servers no longer hold the whole wave hostage.
    // ≥// at >=6 ok (after 2.2s) cut the rest — no penalty (a budget cut, not one); they finish in the background into SRV_CACHE
    // giants-// giants-only source (old series) never reaches okWave 6 -> the old full-budget behavior stays intact
    const stopTighten = setInterval(() => {
      const el2 = Date.now() - t0;
      // // tier 1: sweeping success (>=6 ok) -> cut pending from 2.2s on
      // // tier 2: nearly all settled (<=2 pending) + >=1 ok + 3.9s -> cut the last stragglers (usually the slow giant that ends err/empty anyway)
      if (pend.size && el2 >= 2200 && (okWave >= 6 || (okWave >= 1 && el2 >= 3900 && allow.length - pend.size >= allow.length - 2))) {
        if (DBG) console.error('[t1g] TIGHTEN ok=' + okWave + ' cut=' + pend.size + ' at ' + el2 + 'ms');
        for (const [srv2, f2] of Array.from(pend)) { pend.delete(srv2); f2({ srv: srv2, late: true }); }
      }
    }, 150);
    let rs = await Promise.all(allow.map(s => budget(s)));
    clearInterval(stopTighten); pend.clear();
    if (DBG) console.error('[t1g] ALL-SERVERS el=' + (Date.now() - t0) + 'ms ok=' + rs.filter(r => r.ok).length + '/' + rs.length);
    if (!rs.some(r => r.ok) && Date.now() - t0 < 3400) { // gate 3.4s (// gate 3.4s (tuned to the new budget): on a fast all-fail the retry still finishes inside the 9.8s limit
      await new Promise(r2 => setTimeout(r2, 800)); force = true;
      rs = rs.concat(await Promise.all(allow.map(srv => budget(srv)))); // v1.15.10: // v1.15.10: the full recovery wave is back (the v1.15.9 filter was breaking cold-window card recovery — restored per user report)
    }
    rs.forEach(absorb);
    // v1.11.5: // v1.11.5: when episode meta (year + title) arrives, put it on the cards — wait at most 1.8s (usually arrives while the scan runs):
    let EXT0 = null;
    try {
      // v1.14.2 // v1.14.2 adaptive wait: when the scan is slow, no extra dressing wait (total scan+dress never exceeds ~4.6s);
      // // on a fast scan the full 1.5s fence remains (meta has usually already arrived — instant return)
      const metaWait = Math.max(0, Math.min(1500, 4600 - (Date.now() - t0)));
      const [em, olc] = await Promise.all([ // // both metas together — worst case +1.5s (smooth with the scan budget)
        Promise.race([epMetaP.catch(() => null), new Promise(r => setTimeout(() => r(null), metaWait))]),
        raceVal(olP, metaWait) // // original language name (hi->Hindi, bn->Bengali, ta->Tamil…)
      ]);
      if (em || olc) EXT0 = { year: (em && em.year) || '', epT: (em && em.epT) || '', audio: langName(olc) || '' };
    } catch (eE) {}
    // // merge: no cross-server dupes — every server's every stream card stays;
    // // order: giant servers (miami->boise->atlanta) on top, then extras, resolution big->small inside:
    const PRIO = ['miami', 'boise', 'atlanta', 'phoenix', 'dallas', 'austin', 'seattle', 'delhi', 'munich', 'paris', 'orlando', 'reno', 'oakland', 'vegas', 'cancun', 'tampa'];
    const prio = v => { const i = PRIO.indexOf(v); return i < 0 ? 99 : i; };
    const all = [];
    for (const r of rs) {
      if (!r.j || !r.ok) continue;
      for (const c of decorate(r.j, type, s, e, title || '', cfg, r.srv, EXT0)) all.push({ c, srv: r.srv });
    }
    all.sort((a, b) => prio(a.srv) - prio(b.srv) || (parseInt(b.c.quality, 10) || 0) - (parseInt(a.c.quality, 10) || 0));
    let out = all.map(x => x.c);
    // // no card fits (odd labels) -> the most subtitle-rich / last-resort set:
    if (!out.length) {
      let pick = bestAny, pickSrv = bestAnySrv;
      if (!pick) { pick = deadJ; pickSrv = deadSrv; }
      if (pick) out = decorate(pick, type, s, e, title || '', cfg, pickSrv, EXT0);
    }
    // // the title promise raced in parallel -> wait at most 400ms and put it on the cards (before memoSet):
    if (titleP && out.length) {
      const nm = await Promise.race([titleP.catch(() => ''), new Promise(r => setTimeout(() => r(''), 400))]);
      if (nm) {
        const PRE = '\u29c9 Vidy'; // // empty-title fallback token — name replace only (year/ep/⊞ lines intact)
        out = out.map(c => {
          const t2 = c.title.indexOf(PRE) === 0 ? '\u29c9 ' + nm + c.title.slice(PRE.length) : c.title;
          return Object.assign({}, c, { title: t2, description: t2 });
        });
      }
    }
    // v1.15.8: // v1.15.8: no result caching — a miss gets a fresh scan on the very next click
    if (DBG) console.error('[vdbg] ' + qsig + ' | ' + rs.map(r => r.srv + ':' + (r.neg ? 'neg' : r.err ? 'err' : r.empty ? 'empty' : 'ok' + r.nfit + '/' + (r.j && r.j.sources || []).length)).join(' '));
    if (!out.length && lastErr) throw lastErr;
    return out;
  });
}
const SUB_LANGS = { english: 'en', bangla: 'bn', bengali: 'bn', hindi: 'hi', japanese: 'ja', korean: 'ko', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', turkish: 'tr', arabic: 'ar', chinese: 'zh', mandarin: 'zh', thai: 'th', indonesian: 'id', malay: 'ms', tamil: 'ta', telugu: 'te', russian: 'ru', urdu: 'ur', malayalam: 'ml', marathi: 'mr', punjabi: 'pa', kannada: 'kn', nepali: 'ne', sinhala: 'si', filipino: 'tl', tagalog: 'tl', bhojpuri: 'bh', persian: 'fa', farsi: 'fa', vietnamese: 'vi' };
const NATIVE_SUB = { 'العربية': 'ar', 'اَلْعَرَبِيَّةُ': 'ar', 'français': 'fr', 'हिन्दी': 'hi', 'বাংলা': 'bn', 'indonesia': 'id', 'bahasa indonesia': 'id', 'melayu': 'ms', 'bahasa melayu': 'ms', 'español': 'es', 'deutsch': 'de', 'русский': 'ru', '日本語': 'ja', '한국어': 'ko', 'தமிழ்': 'ta', 'తెలుగు': 'te', 'മലയാളം': 'ml', 'português': 'pt', 'italiano': 'it', 'türkçe': 'tr', 'tiếng việt': 'vi', 'ไทย': 'th', 'فارسی': 'fa' };
function subLang(x) { // subtitle language code — schema-required on strict (TV) validators
  const raw = String(x.lang || x.language || '').trim();
  if (NATIVE_SUB[raw] || NATIVE_SUB[raw.toLowerCase()]) return NATIVE_SUB[raw] || NATIVE_SUB[raw.toLowerCase()];
  const v = raw.toLowerCase();
  if (/^[a-z]{2}(-|$)/.test(v)) return v.slice(0, 2);
  const s = v + ' ' + String(x.label || '').toLowerCase();
  for (const k in SUB_LANGS) if (s.indexOf(k) >= 0) return SUB_LANGS[k];
  return 'en';
}
// v1.9.0: shared quality-filter predicate — one() probes ONLY assets the filter would serve,
// decorate keeps exactly the same set. Unknown quality and Auto-HLS always pass.
function nxLangKey(p) { // normalize one dub token → canonical chip key
  p = String(p || '').toLowerCase().trim();
  if (!p || p.indexOf('original') >= 0) return 'original'; // v1.11.12: 'Original Audio'-// v1.11.12: 'Original Audio' counts as original too (nethex standalone semantics: startsWith('original') — without this the original chip filtered itself out)
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
function decorate(j, type, s, e, showTitle, cfg, srv, ext) {
  cfg = cfg || DEFAULT_CFG;
  const headers = { 'User-Agent': UA, 'Referer': VIDY_REFERER };
  const order = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4 };
  // v1.11.14: payload-// v1.11.14: payload sub-links proven dead (api.playhq.net/sub -> 400, inner domain inactive) — no longer attached
  // // the working MovieBox tracks sit on every card at getSources' merge level (mbSubs), gated by cfg.sub=0
  const seen = {};
  const allow = Array.isArray(cfg.q) ? cfg.q : qToList(cfg.q);
  const cards = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && !seen[x.url] && (seen[x.url] = 1)).filter(x => qPass(x, allow)).sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).map(x => {
    let q = String(x.quality || 'Auto').replace('p', '');
    if (!/^\d{3,4}$/.test(q)) q = 'Auto'; // v1.11.7: 'Auto HLS'/'Streamwish'/'Vidara'-// v1.11.7: non-numeric labels like 'Auto HLS'/'Streamwish' -> Auto (only real height numbers stay numeric)
    const sd = ((srv || 'vidy').charAt(0).toUpperCase() + (srv || 'vidy').slice(1)); // // server name on the card
    // v1.11.6: // v1.11.6: the server name always in the slot; the source name only for server-less sources (MovieBox takes its own)
    const yTx = (ext && ext.year) ? ' | ' + ext.year + ' |' : '';
    // v1.11.7: description = ⧉ Title | Year | / ⧠ SsEe • EpTitle / ⊞ Server ⌗ Audio — resolution // v1.11.7: description = ⧉ Title | Year | / ⧠ SsEe • EpTitle / ⊞ Server ⌗ Audio — no resolution, no "Subs" text (resolution only in the name slot)
    const epLine = type === 'tv'
      ? '\u29e0 S' + s + 'E' + e + ((ext && ext.epT) ? ' \u2022 ' + ext.epT : '')
      : '\u29e0 Movie';
    const txt = '\u29c9 ' + (showTitle || 'Vidy') + yTx + '\n' + epLine + '\n\u229e ' + sd + ' \u2317 ' + (j._audN || (ext && ext.audio) || 'Original Audio'); // // source-declared > TMDB > Original Audio
    return {
      name: '\u25a5 ' + q + ' \u25a5',
      title: txt,
      description: txt,
      quality: q === 'Auto' ? '' : q,
      url: String(x.url),
      headers: headers,
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } }
    };
  });
  return cards;
}

// ---------- config + manifest ----------
// TMDB-TV-// TMDB TV genres differ (TV has no Thriller/Romance — genre ids differ per type):
const GENRES_TV = [['Drama', 18], ['Comedy', 35], ['Action & Adventure', 10759], ['Crime', 80], ['Mystery', 9648], ['Sci-Fi & Fantasy', 10765], ['Animation', 16], ['Family', 10751], ['Documentary', 99], ['War & Politics', 10768], ['Kids', 10762], ['Reality', 10764]];
const GENRES_MV = [['Action', 28], ['Comedy', 35], ['Thriller', 53], ['Romance', 10749], ['Drama', 18], ['Crime', 80], ['Sci-Fi', 878], ['Horror', 27], ['Mystery', 9648], ['Fantasy', 14], ['Animation', 16], ['Adventure', 12]];
function genreIds(type, names) {
  const gl = type === 'tv' ? GENRES_TV : GENRES_MV;
  return (Array.isArray(names) ? names : names ? [names] : []).map(n => String(n).trim().toLowerCase())
    .map(n => (gl.find(g2 => g2[0].toLowerCase() === n) || [0, 0])[1]).filter(Boolean);
}
const QH = [2160, 1080, 720, 480, 360];
function rtLangPass(x, sel) { // RareToons-// RareToons' own filter: empty sel = keep all languages; what the card shows is the criterion (_lang+filename+display)
  if (!sel || !sel.length) return true;
  const blob = (String(x._lang || '') + ' ' + String((x.behaviorHints || {}).filename || '') + ' ' + String(x.name || '') + ' ' + String(x.title || '')).toLowerCase();
  if (!blob.trim()) return false;
  return sel.some(l => blob.indexOf(l) >= 0);
}
function qToList(q) { // // multi-resolution: array/comma-list -> exactly those; number -> <=n cap (old cfg); 0/empty -> all
  const pick = [];
  const add = x => { const h = Number(x); if (QH.indexOf(h) >= 0 && pick.indexOf(h) < 0) pick.push(h); };
  if (Array.isArray(q)) { q.forEach(add); return pick; }
  if (typeof q === 'string' && q.indexOf(',') >= 0) { q.split(',').forEach(add); return pick; }
  const n = Math.min(2160, Math.max(0, Number(q) || 0));
  return n ? QH.filter(h => h <= n) : [];
}
const DEFAULT_CFG = { q: 0, sub: 1, cat: 'kd,mv', lang: '', sort: 'pop', era: '', g: [], srv: [], v: 1, nx: 1, nxq: 0, nxl: [], tw: 1, rt: 1, twq: [], rtl: [], wo: 1, woq: [] }; // wo/woq = Watchout master + its own quality chips (v1.15.39) // v/nx/tw/rt = per-source master switches (tw=ToonWorld, rt=RareToons) // v/nx = per-source master switches; nxq/nxl = NetHex's OWN quality/audio-language filters (independent of the vidy-side q)
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
    if (o.tw === 0 || o.tw === '0') c.tw = 0;
    if (o.wo === 0 || o.wo === '0') c.wo = 0; // Watchout-// Watchout master (v1.15.39)
    if (o.twq !== undefined && o.twq !== null && o.twq !== '') c.twq = qToList(o.twq); // ToonWorld-// ToonWorld's own quality filter (at the real height, not card labels)
    if (o.rt === 0 || o.rt === '0') c.rt = 0;
    if (o.nxq !== undefined && o.nxq !== null && o.nxq !== '') c.nxq = qToList(o.nxq);
    if (Array.isArray(o.nxl)) c.nxl = o.nxl.map(x => String(x).toLowerCase().replace(/[^a-z]/g, '')).filter(x => x.length >= 2 && x.length <= 12).slice(0, 12);
    if (Array.isArray(o.rtl)) c.rtl = o.rtl.map(x => String(x).toLowerCase().replace(/[^a-z]/g, '')).filter(x => ['hindi', 'tamil', 'telugu', 'malayalam', 'bengali'].indexOf(x) >= 0).slice(0, 5); // RareToons-// RareToons' own audio-language filter
    if (o.woq !== undefined && o.woq !== null && o.woq !== '') c.woq = qToList(o.woq); // Watchout-// Watchout's own quality chips (v1.15.39)
  }
  return c;
}
function decodeCfg(b64) {
  try { return parseCfgFromObj(JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))); } catch (e) { return Object.assign({}, DEFAULT_CFG, { g: [], srv: [] }); }
}
const crypto = require('crypto');
function manifest(cfg, origin, cfgged) {
  // v1.13.8 PHOENIX-// v1.13.8 PHOENIX parity: Stremio caches per manifest id — reusing a broken install's id is forbidden
  const m = {
    id: cfgged ? 'community.xre.vidy.' + crypto.createHash('md5').update(JSON.stringify(cfg || {})).digest('hex').slice(0, 8) : 'community.xre.vidy.p7',
    version: VERSION,
    name: 'Phoenix',
    logo: (origin || '') + '/logo.png',
    description: 'Stream-only, parallel sources: Vidy (16 servers, up to 4K, subtitles) + MovieBox (direct-MP4 dubs & multi-audio) + RareToons (Hindi/Tamil/Telugu anime & cartoons, auto-HLS) + ToonWorld4All (multi-audio movies & anime via encrypted-link resolver) — every card in one unified format; each source keeps its own filters (quality, audio language, servers).',
    author: 'xre000001-ai',
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false, logging: false } // // the addon never appears in-app without its configure page
  };
  if (cfgged) { // // configured install: full notation resources (per-type idPrefixes) — top-level dropped (PHOENIX rule)
    m.resources = [
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'] },
      { name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'] }
    ];
    delete m.idPrefixes;
  } else m.resources = ['stream', 'subtitles']; // v1.11.13: MovieBox-// v1.11.13: MovieBox subtitle tracks
  return m;
}

// ---------- HTTP ----------
const reqLog = [];
function logReq(path, ms, n, err, ua) {
  reqLog.push({ t: new Date().toISOString().slice(11, 19), path: path.slice(0, 60), ms, n, err: err || undefined, ua: (ua || '').split(')')[0].split('(')[1] || (ua || '').slice(0, 24) });
  if (reqLog.length > 60) reqLog.shift();
}
function originOf(req) { // beamup-// beamup's proxy Host header sometimes carries an internal dotless name -> known public domain; http in local tests
  const h = req.headers || {};
  let host = String(h['x-forwarded-host'] || '').split(',')[0].trim() || String(h.host || '');
  let proto = String(h['x-forwarded-proto'] || '').split(',')[0].trim() || (/^(127\.|localhost|\[)/.test(host) ? 'http' : 'https');
  if (!host || host.indexOf('.') < 0) { host = '3404d3c5dc63-vidy.baby-beamup.club'; proto = 'https'; } // // internal name -> public
  return proto + '://' + host;
}
function sendJson(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(b);
}
// v1.13.9 // v1.13.9 stream-response cache — nethex v2.4.0 parity: TTL 30min + max 400, oldest evicted first
const stripCards = cards => (cards || []).map(({ _hq, _lang, quality, headers, subtitles, ...r }) => r); // nethex-// nethex-parity shape: strip embedded subs + non-spec fields
function sendStreams(res, skey, plog, ms, cards, ua) {
  const partial = !!(cards && cards.$partial);
  const n = (cards || []).length; // v1.15.8: // v1.15.8: no stash — fresh per response
  logReq(plog, ms, n, null, ua);
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  return res.end(JSON.stringify({ streams: stripCards(cards) }));
}

function sendFile2(res, name) {
  try {
    const b = fs.readFileSync(path.join(__dirname, name));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); // CDN-// no CDN caching — a new deploy ships a new page immediately
    return res.end(b);
  } catch (e) { return sendJson(res, 500, { error: 'missing ' + name }); }
}
const server = http.createServer((req, res) => {
  req.on('error', () => {}); res.on('error', () => {}); // v1.15.37 R2: // v1.15.37 R2: if the client walks away mid-flight (abort/EPIPE) the socket-error event falls into nothing — not a disaster
  const RVA = String(req.headers['user-agent'] || '');
  let pRaw = new URL(req.url, 'http://x').pathname;
  let p;
  try { p = decodeURIComponent(pRaw); } catch (eDec) { p = pRaw; } // // devices send ':' as %3A — decoding is mandatory
  let cfg = null;
  let cfgged = false; // v1.13.8: /cfg/-// v1.13.8: /cfg/ installs -> own md5 manifest id (no Stremio cache collisions)
  try {
    const cm2 = p.match(/^\/cfg\/([^\/]+)(\/.*)$/); // // tolerate any characters — broken b64 also defaults in decodeCfg's catch (not 404)
    if (cm2) { cfg = decodeCfg(cm2[1]); p = cm2[2]; cfgged = true; }
    else {
      const qs = new URL(req.url, 'http://x').searchParams;
      if ([...qs.keys()].length) cfg = parseCfgFromObj({ q: qs.get('q') || qs.get('maxq'), sub: qs.get('sub') === '0' ? 0 : 1, cat: qs.get('cat') || '', lang: qs.get('lang') || '', sort: qs.get('sort') || '', era: qs.get('era') || '', g: (qs.get('g') || '').split(',').filter(Boolean), srv: (qs.get('srv') || '').split(',').filter(Boolean), v: qs.get('v') === '0' ? 0 : undefined, nx: qs.get('nx') === '0' ? 0 : undefined, tw: qs.get('tw') === '0' ? 0 : undefined, rt: qs.get('rt') === '0' ? 0 : undefined, rtl: qs.get('rtl') ? qs.get('rtl').split(',') : undefined, wo: qs.get('wo') === '0' ? 0 : undefined, woq: qs.get('woq') ? qs.get('woq').split(',').map(Number) : undefined, nxq: qs.get('nxq') || undefined, nxl: qs.get('nxl') ? qs.get('nxl').split(',') : undefined });
    }
    if (!cfg) cfg = Object.assign({}, DEFAULT_CFG, { g: [], srv: [] });
    if (p === '/' || p === '/config' || p === '/configure') return sendFile2(res, 'config.html');
    if (p === '/manifest.json') return sendJson(res, 200, manifest(cfg, originOf(req), cfgged));
    if (p === '/logo.png') {
      try {
        const lb = fs.readFileSync(path.join(__dirname, 'logo.png'));
        res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' });
        return res.end(lb);
      } catch (eL) { return sendJson(res, 404, { error: 'no logo' }); }
    }
    if (p === '/rt_logo.png') { // RareToons-// official RareToons logo (transparent — from rareanimes.mov)
      try {
        const lb = fs.readFileSync(path.join(__dirname, 'assets', 'raretoons_logo.png'));
        res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' });
        return res.end(lb);
      } catch (eL) { return sendJson(res, 404, { error: 'no rt logo' }); }
    }
    const mmR = p.match(/^\/mm\/([A-Za-z0-9_-]{8,2400})\/mini\.m3u8$/); // v1.15.49: // v1.15.49: signed bridge master keys run ~1400 chars — the 300 limit made them all 404 (user proof)
    if (mmR) return (async () => { // v1.15.48: // v1.15.48: mini-master — resolution pinned + audio intact; fresh fetch per request (not the stream-result cache)
      const ent = mmMiniOpen(mmR[1]); // // the key knows everything — no memory needed; a real key never dies
      if (!ent) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('gone'); }
      try {
        if (ent.vbq) { // v1.15.49: // v1.15.49: signatures rotate fast — sticky resolve (v1.15.55: 60s memory — no hammering resolve on every player master pull)
          const cm2 = mmGet(MM_VC, ent.vbq, 60000);
          if (cm2) ent.m = cm2;
          else {
            try {
              const rj2 = await woPoolText('https://vidbolt.xyz/api/resolve?' + ent.vbq, 6000);
              const jj2 = rj2 ? JSON.parse(rj2) : null;
              const fh = jj2 && jj2.stream && jj2.stream.sources && jj2.stream.sources.find(x2 => x2 && x2.kind === 'hls' && /^https?:/.test(x2.url || ''));
              if (fh) { ent.m = fh.url; mmPut(MM_VC, ent.vbq, ent.m); }
            } catch { }
          }
        }
        let raw = mmGet(MM_MC, ent.m, 60000); // v1.15.55: // v1.15.55: 60s master cache — on a hit there is no upstream travel at all
        if (!raw) {
          const rr = await fetch(ent.m, { headers: { 'User-Agent': UA, Referer: ent.ref }, signal: AbortSignal.timeout(8000) });
          raw = rr.ok ? await rr.text() : '';
          if (raw.indexOf('#EXTM') < 0) { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('upstream'); }
          mmPut(MM_MC, ent.m, raw);
        } else if (DBG) console.error('[mm] mini-cache hit');
        const mini = mmMiniBuild(ent.m, ent.h, raw) || raw; // // fall back to the full absolute master when no variants
        ent.at = Date.now();
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
        return res.end(mini);
      } catch { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('upstream-err'); }
    })();
    if (p === '/_health') return sendJson(res, 200, { ok: 1, version: VERSION, pool: POOL.length, pxbench: POOL.filter(c => PX_SITE.has(c.px)).length, apibench: PX_API.size, vbbench: PX_VB.size, wobench: PX_WO.size, memo: memo.size, nx: NEXBASE ? 1 : 0, nxpool: NXBENCH, nxwaves: NXWAVES, nxsize: NXSIZE, tw: TWBASE ? 1 : 0, rt: RTBASE ? 1 : 0, wo: WOBASE ? 1 : 0, up: Math.floor(process.uptime()), ucex: UCEX }); // v1.15.36: +up(// v1.15.36: +up(seconds)+ucex — additive counters // v1.15.18: pxbench = site-proven bench (v1.15.8: nxpool = MB bench)
    if (p === '/_pool') return sendJson(res, 200, POOL.map(c => Object.assign({}, c, PX_RUN.get(c.px) || {}, { site: PX_SITE.has(c.px) ? 1 : 0, cool: Math.max(0, ((PX_COOL.get(c.px) || 0) - Date.now()) / 1000 | 0), lastok: PX_LASTOK.get(c.px) || 0, sp: ['site', 'api', 'vb', 'wo'].filter(k => PX_SPACES[k].set.has(c.px)) }))); // v1.15.56: +sp(// v1.15.56: +sp (which source spaces this px belongs to)
    if (p === '/_nxring') { if (!NEXBASE) return sendJson(res, 200, { off: 1 }); directGet(NEXBASE + '/debug/ring', 4000).then(b => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(b); }).catch(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"err":1}'); }); return; } // v2.10.2 // v2.10.2 child resolve-step proof
    if (p === '/_log') return sendJson(res, 200, reqLog.slice(-40).reverse());
    if (p === '/_servers') return sendJson(res, 200, { order: srvOrder(), scores: SRV_SCORE }); // // live health for the configure page
    let m;
    // // log every path (404s visible too):
    logReq(p, 0, -1, 'route-in', RVA);
    // v1.15.8 (// v1.15.8 (user): no cache-send on stream responses — a 30min pinned miss used to show the same miss on the 2nd click; now every click is a real scan
    // ── catalog (search + genre + skip — NetHex-// -- catalog (search + genre + skip — NetHex pattern):
    if ((m = p.match(/^\/catalog\/(series|movie)\/(vidy-kdrama|vidy-movies)(?:\/(.*))?\.json$/))) {
      const type = m[1] === 'series' ? 'tv' : 'movie';
      const ex = {};
      if (m[3]) m[3].split('&').forEach(kv => { const i3 = kv.indexOf('='); if (i3 > 0) ex[kv.slice(0, i3)] = decodeURIComponent(kv.slice(i3 + 1)); });
      const q = ex.search || '';
      const gid = [ex.genre].concat(cfg.g || []).filter(Boolean); // // name list -> ids per type inside catalogMeta
      const skip = Number(ex.skip || 0) || 0;
      const t0 = Date.now();
      return catalogMeta(type, q, cfg, gid, skip).then(metas => {
        logReq(p, Date.now() - t0, metas.length);
        sendJson(res, 200, { metas });
      }, e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { metas: [] }); });
    }
    // ── tmdb-// -- tmdb-native-id streams (Nuvio mode):
    if ((m = p.match(/^\/stream\/movie\/tmdb(\d+)\.json$/))) {
      const t0 = Date.now();
      const tp = nameForTmdb(Number(m[1]), 'movie'); // // title and sources race together — the title is only for cards
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('movie', String(m[1]), 0, 0) : null;
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? tp.then(n => twrStreams(TWBASE, 'toonworld', n, 'movie', 0, 0)).catch(() => []) : null; // v1.12: // v1.12: races from the title promise
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? tp.then(n => twrStreams(RTBASE, 'raretoons', n, 'movie', 0, 0)).catch(() => []) : null;
      const woP = (WOBASE && !(cfg && cfg.wo === 0)) ? tp.then(n => woStreams(Number(m[1]), n, 'movie', 0, 0, cfg, originOf(req))).catch(() => []) : null; // v1.15.39: TMDB-// v1.15.39: TMDB native
      kickSubs('tmdb' + m[1], 'movie', null, null, cfg);
      return withDeadline(withSources(vOn ? getSources(Number(m[1]), 'movie', null, null, '', cfg, tp) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (user: 12s card timeout) — ~= NXHARD(12s), 100ms under the edge cut so the answer is never lost */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/tmdb(\d+):?(?:(\d+):(\d+))?\.json$/))) {
      const t0 = Date.now();
      const tp = nameForTmdb(Number(m[1]), 'series');
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', String(m[1]), Number(m[2] || 1), Number(m[3] || 1)) : null;
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? tp.then(n => twrStreams(TWBASE, 'toonworld', n, 'series', Number(m[2] || 1), Number(m[3] || 1))).catch(() => []) : null;
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? tp.then(n => twrStreams(RTBASE, 'raretoons', n, 'series', Number(m[2] || 1), Number(m[3] || 1))).catch(() => []) : null;
      const woP = (WOBASE && !(cfg && cfg.wo === 0)) ? tp.then(n => woStreams(Number(m[1]), n, 'series', Number(m[2] || 1), Number(m[3] || 1), cfg, originOf(req))).catch(() => []) : null; // v1.15.39
      if (nxOn) nxPrewarm('series', String(m[1]), Number(m[2] || 1), Number(m[3] || 1));
      twRtPrewarm(tp, 'series', Number(m[2] || 1), Number(m[3] || 1));
      kickSubs('tmdb' + m[1], 'series', Number(m[2] || 1), Number(m[3] || 1), cfg);
      return withDeadline(withSources(vOn ? getSources(Number(m[1]), 'tv', Number(m[2] || 1), Number(m[3] || 1), '', cfg, tp) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (user: 12s card timeout) — ~= NXHARD(12s), 100ms under the edge cut so the answer is never lost */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/movie\/(tt\d+)\.json$/))) {
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('movie', m[1], 0, 0) : null;
      const infoP = vOn ? findTmdbInfo(m[1], 'movie') : null; // v1.12: // v1.12: one call feeds all sources
      const nmP = suggName(m[1]); // v1.12.6: rt/tw-// v1.12.6: rt/tw fast name
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? nmP.then(nm => nm ? twrStreams(TWBASE, 'toonworld', nm, 'movie', 0, 0) : []).catch(() => []) : null; // v1.15.15: infoP-// v1.15.15: infoP gate dropped — TW/RT stay alive even on v=0 configs (before: vidy source off = TW/RT silently dead — the 'MovieBox only' root cause)
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? nmP.then(nm => nm ? twrStreams(RTBASE, 'raretoons', nm, 'movie', 0, 0) : []).catch(() => []) : null;
      const woOn = !!WOBASE && !(cfg && cfg.wo === 0); // v1.15.39
      const woIdP = woOn ? ((vOn && infoP) ? infoP.then(v => (v && v.id > 0) ? v.id : 0) : findTmdb(m[1], 'movie').catch(() => 0)) : null; // infoP-// share the id from infoP (no second call)
      const woP = woOn ? woIdP.then(id => id ? nmP.then(nm => woStreams(id, nm || '', 'movie', 0, 0, cfg, originOf(req))) : []).catch(() => []) : null;
      kickSubs(m[1], 'movie', null, null, cfg);
      return withDeadline(withSources(vOn ? (infoP ? infoP.then(info => (info && info.id > 0) ? getSources(info.id, 'movie', null, null, info.name, cfg) : Promise.resolve([])) : Promise.resolve([])) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (user: 12s card timeout) — ~= NXHARD(12s), 100ms under the edge cut so the answer is never lost */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+):(\d+):(\d+)\.json$/))) {
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', m[1], Number(m[2]), Number(m[3])) : null;
      const infoP = vOn ? findTmdbInfo(m[1], 'series') : null;
      const nmP = suggName(m[1]); // v1.12.6: rt/tw-// v1.12.6: rt/tw fast name
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? nmP.then(nm => nm ? twrStreams(TWBASE, 'toonworld', nm, 'series', Number(m[2]), Number(m[3])) : []).catch(() => []) : null; // v1.15.15: infoP-// v1.15.15: infoP gate dropped — TW/RT alive even at v=0 (nmP = IMDb suggestion, v-independent)
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? nmP.then(nm => nm ? twrStreams(RTBASE, 'raretoons', nm, 'series', Number(m[2]), Number(m[3])) : []).catch(() => []) : null;
      const woOn = !!WOBASE && !(cfg && cfg.wo === 0); // v1.15.39
      const woIdP = woOn ? ((vOn && infoP) ? infoP.then(v => (v && v.id > 0) ? v.id : 0) : findTmdb(m[1], 'series').catch(() => 0)) : null;
      const woP2 = woOn ? woIdP.then(id => id ? nmP.then(nm => woStreams(id, nm || '', 'series', Number(m[2]), Number(m[3]), cfg, originOf(req))) : []).catch(() => []) : null;
      if (nxOn) nxPrewarm('series', m[1], Number(m[2]), Number(m[3]));
      twRtPrewarm(nmP, 'series', Number(m[2]), Number(m[3]));
      kickSubs(m[1], 'series', Number(m[2]), Number(m[3]), cfg);
      return withDeadline(withSources(vOn ? (infoP ? infoP.then(info => (info && info.id > 0) ? getSources(info.id, 'tv', Number(m[2]), Number(m[3]), info.name, cfg) : Promise.resolve([])) : Promise.resolve([])) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP2, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (user: 12s card timeout) — ~= NXHARD(12s), 100ms under the edge cut so the answer is never lost */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+)\.json$/))) { // // safety net: a call without s:e -> S1E1
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', m[1], 1, 1) : null;
      const infoP = vOn ? findTmdbInfo(m[1], 'series') : null;
      const nmP = suggName(m[1]); // v1.12.6: rt/tw-// v1.12.6: rt/tw fast name
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? nmP.then(nm => nm ? twrStreams(TWBASE, 'toonworld', nm, 'series', 1, 1) : []).catch(() => []) : null;
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? nmP.then(nm => nm ? twrStreams(RTBASE, 'raretoons', nm, 'series', 1, 1) : []).catch(() => []) : null;
      const woOn = !!WOBASE && !(cfg && cfg.wo === 0); // v1.15.39
      const woIdP = woOn ? ((vOn && infoP) ? infoP.then(v => (v && v.id > 0) ? v.id : 0) : findTmdb(m[1], 'series').catch(() => 0)) : null;
      const woP3 = woOn ? woIdP.then(id => id ? nmP.then(nm => woStreams(id, nm || '', 'series', 1, 1, cfg)) : []).catch(() => []) : null;
      if (nxOn) nxPrewarm('series', m[1], 1, 1);
      twRtPrewarm(nmP, 'series', 1, 1);
      kickSubs(m[1], 'series', 1, 1, cfg);
      return withDeadline(withSources(vOn ? (infoP ? infoP.then(info => (info && info.id > 0) ? getSources(info.id, 'tv', 1, 1, info.name, cfg) : Promise.resolve([])) : Promise.resolve([])) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP3, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (user: 12s card timeout) — ~= NXHARD(12s), 100ms under the edge cut so the answer is never lost */, p).then(
        cards => { sendStreams(res, req.url, p + ' [no-s:e]', Date.now() - t0, cards, RVA); },
        e => { logReq(p + ' [no-s:e]', Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    // ── subtitles-// -- subtitles resource (MovieBox subtitle tracks — proxy of the embedded child's /subtitles) --
    if ((m = p.match(/^\/subtitles\/(movie|series)\/([^/]+?)(?:\.json)?$/))) {
      const t0 = Date.now();
      const done2 = arr => { logReq(p, Date.now() - t0, (arr || []).length); sendJson(res, 200, { subtitles: arr || [] }); };
      if (!NEXBASE) return done2([]);
      // // cache management lives inside mbSubs (SUBS_CACHE) — the route only maps the shape
      (async () => {
        const pp0 = String(m[2]).split(':'); // [id, s?, e?] — s:e-// [id, s?, e?] — split s:e first (lost in translation otherwise)
        let id2 = pp0[0];
        if (/^tmdb\d+$/.test(id2)) { const iv = await tmdbToImdb(id2.slice(4), m[1] === 'series' ? 'tv' : 'movie'); if (!iv) return done2([]); id2 = iv; } // Nuvio-tmdb-// Nuvio-tmdb id
        const isTv = m[1] === 'series';
        const canon = await mbSubs(id2, isTv ? 'tv' : 'movie', Number(pp0[1] || 1), Number(pp0[2] || 1)); // // real s:e
        done2(canon.map(x => ({ id: x.lang, url: x.url, lang: x.lang }))); // // resource shape (Stremio-native)
      })().catch(e2 => { if (DBG) console.error('[nxdbg] subs ERR: ' + String(e2 && e2.message).slice(0, 60)); done2([]); });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) { try { if (!res.headersSent) sendJson(res, 500, { error: String(e && e.message) }); else { try { res.end(); } catch {} } } catch (e2) { try { res.destroy(); } catch {} } } // v1.15.37 R2: headers-// v1.15.37 R2: a disaster after headers were sent closes the socket politely — zero second-disaster risk
});
// v1.15.0: // v1.15.0: dropped the 60s destroy-all-agent-sockets ritual — it defeated keep-alive (per-tap DNS+TLS again);
// warmBases()-// warmBases()'s 45s traffic keeps sockets alive (NAT cuts warded off naturally); dead sockets are dropped by the agent itself on server FIN.
// ---------- v1.11.8 embedded MovieBox (vendored nethex child; single-app deploy) ----------
let _nxEnsure = null;
function ensureNxChild(nxPort) { // v1.15.8: // v1.15.8: verify 7137 every 90s; set NEXBASE when alive; respawn when dead (3min spawn guard — no spawn storm)
  if (_nxEnsure) return;
  let lastSpawn = 0;
  _nxEnsure = setInterval(() => {
    if (NEXBASE) return;
    const rq = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r => {
      r.resume();
      if (r.statusCode === 200) { NEXBASE = 'http://127.0.0.1:' + nxPort; console.log('[nx-embed] MovieBox alive (late boot): ' + NEXBASE); }
    });
    rq.on('error', () => {
      if (Date.now() - lastSpawn < 180000) return;
      lastSpawn = Date.now();
      if (DBG) console.error('[nx-embed] ensure: no child — respawn');
      try { require('child_process').spawn(process.execPath, [path.join(__dirname, 'nethex', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(nxPort) }), stdio: 'ignore' }); } catch (e) {}
    });
    rq.on('timeout', () => { rq.destroy(); });
  }, 90000);
  _nxEnsure.unref();
}
function startEmbeddedNx() {
  return new Promise(resolve => {
    try {
      if (!fs.existsSync(path.join(__dirname, 'nethex', 'server.js'))) return resolve('');
      const nxPort = Number(process.env.PORT || 7000) + 137;
      const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'nethex', 'server.js')], {
        env: Object.assign({}, process.env, { PORT: String(nxPort) }),
        stdio: 'ignore',
      });
      ensureNxChild(nxPort); // v1.15.8: // v1.15.8: guard from boot — even if the child failed at boot, verify/respawn every 90s (it used to go permanently off)
      let nxRespawned = false;
      child.on('exit', c2 => { // v1.15.6 // v1.15.6 round-36: if the child dies mid-flight, respawn once after 90s (guarded — exactly once, unref)
        if (DBG) console.error('[nx-embed] child exited ' + c2);
        if (nxRespawned) return;
        nxRespawned = true;
        setTimeout(() => {
          try {
            const c3 = require('child_process').spawn(process.execPath, [path.join(__dirname, 'nethex', 'server.js')], {
              env: Object.assign({}, process.env, { PORT: String(nxPort) }),
              stdio: 'ignore',
            });
            c3.on('exit', () => { // v1.15.7 // v1.15.7 round-8: even when the respawned child dies, verify first — if something already serves 7137, calling it 'off' would be a lie
              const rq3 = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r3 => {
                r3.resume();
                console.error('[nx-embed] respawn exited — 7137 still serving, MovieBox up');
              });
              rq3.on('error', () => { if (DBG) console.error('[nx-embed] respawn exited — MovieBox off'); });
              rq3.on('timeout', () => { rq3.destroy(); if (DBG) console.error('[nx-embed] respawn exited — MovieBox off'); });
            });
            const t4 = Date.now();
            (function ping2() {
              const rq2 = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r2 => {
                r2.resume();
                if (r2.statusCode === 200) { NEXBASE = 'http://127.0.0.1:' + nxPort; console.log('[nx-embed] MovieBox respawned on ' + NEXBASE); return; }
                retry2();
              });
              rq2.on('error', retry2); rq2.on('timeout', () => { rq2.destroy(); retry2(); });
              function retry2() { if (Date.now() - t4 > 20000) { if (DBG) console.error('[nx-embed] respawn not ready — MovieBox off'); return; } setTimeout(ping2, 500); }
            })();
          } catch (eR) { if (DBG) console.error('[nx-embed] respawn failed: ' + eR.message); }
        }, 90000).unref();
      });
      const t0 = Date.now();
      (function ping() {
        const rq = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r => {
          r.resume();
          if (r.statusCode === 200) { const u = 'http://127.0.0.1:' + nxPort; console.log('[nx-embed] MovieBox child ready on ' + u); return resolve(u); }
          retry();
        });
        rq.on('error', retry); rq.on('timeout', () => { rq.destroy(); retry(); });
        function retry() { if (Date.now() - t0 > 20000) { console.error('[nx-embed] child not ready in 20s — MovieBox off'); return resolve(''); } setTimeout(ping, 500); }
      })();
    } catch (eE) { console.error('[nx-embed] spawn failed: ' + eE.message); resolve(''); }
  });
}
const PORT = Number(process.env.PORT || 7000);
let NXBENCH = -1, NXWAVES = -1, NXSIZE = -1; // v2.10.1: waves=// v2.10.1: waves = the child's total scan waves (verifiable frequency)
function nxBenchHealth() {
  if (!NEXBASE) { NXBENCH = -1; return Promise.resolve(-1); }
  return directGet(NEXBASE + '/health', 3000).then(b => { const j = JSON.parse(b); NXBENCH = typeof j.pool === 'number' ? j.pool : -1; NXWAVES = typeof j.waves === 'number' ? j.waves : NXWAVES; NXSIZE = typeof j.size === 'number' ? j.size : NXSIZE; return NXBENCH; }).catch(() => { NXBENCH = -1; return -1; });
}
let nxBenchWait = null; // single-flight — // single-flight — one wait even under dense taps (no bench storm)
function waitNxBench(maxMs) { // v1.15.13: NXBENCH===0 → // v1.15.13: NXBENCH===0 -> wait for the first bench wave instead of a hard [] (child streaming boot ~5-15s)
  if (NXBENCH !== 0) return Promise.resolve(NXBENCH);
  if (nxBenchWait) return nxBenchWait;
  const t0 = Date.now();
  nxBenchWait = (async () => {
    while (Date.now() - t0 < maxMs) {
      await new Promise(r => setTimeout(r, 700));
      const n = await nxBenchHealth();
      if (n !== 0) break;
    }
    nxBenchWait = null;
    return NXBENCH;
  })();
  return nxBenchWait;
}
setInterval(() => { nxBenchHealth(); }, 15000).unref();
(async () => {
  // v1.15.67b (beamup-// v1.15.67b (beamup lint fix): listen first — waiting for the nethex child must never block HTTP (manifest/health instant; the child joins behind)
  server.listen(PORT, '0.0.0.0', () => console.log('[vidy] ' + VERSION + ' on :' + PORT + ' | pool=' + POOL.length + (NEXBASE ? ' | moviebox embedded' : '')));
  (async () => { if (!NEXBASE) NEXBASE = await startEmbeddedNx(); nxBenchHealth(); })().catch(e => console.error('[nx-embed] deferred boot failed: ' + (e && e.message || e)));
  server.on('error', e => { const pre = !server.listening; console.error('[listen] port-' + PORT + ' failed: ' + (e && e.code || '') + (e && e.code === 'EADDRINUSE' && pre ? ' — another vidy is already on this port; stop it (pkill -f "node server.js") or set a different PORT' : ' — ' + String(e && e.message).slice(0, 100))); if (pre) process.exit(1); }); // v1.15.40: exit only on pre-listen errors — while running, log only, never die
  // v1.15.18 (r68b // v1.15.18 (r68b user-approved): replica-awakening self-ping — /_health on its own public URL every 4min
  // (// (stops scale-to-zero/idle sleep; the router stays warm) + warmBases (keeps resolver/child sockets' DNS+TLS hands warm — the root of cold first taps)
  const SELF_URL = String(process.env.SELFPING_URL || 'https://3404d3c5dc63-vidy.baby-beamup.club/_health');
  const SELF_SEC = Math.max(60, Number(process.env.SELFPING_SEC || 180)); // v1.15.19: // v1.15.19: 4min -> 3min
  const selfPing = () => { directGet(SELF_URL, 8000).then(() => { if (DBG) console.error('[selfping] ok ' + SELF_URL); }).catch(() => {}); try { warmBases(); } catch (e) {} };
  setInterval(selfPing, SELF_SEC * 1000).unref();
  setTimeout(selfPing, 20000).unref(); // // first ping 20s after boot
  const warmBases0 = () => { try { warmBases(); } catch (e) {} };
  setTimeout(warmBases0, 1500).unref();
  setInterval(warmBases0, 45000).unref(); // // sockets warmed every 45s
})();

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