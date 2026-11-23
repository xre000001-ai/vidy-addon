'use strict';
/* tools/vidy-runtime/hindmovie.cjs — HindMovie: স্বাধীন verified-pool মডিউল (v1.34.427, নতুন করে লেখা)
 *
 * ইউজারের নিয়ম: "HM স্বাধীন সোর্স — পুল ছাড়া বেশি কোড লাগে না, 1st tap-এ সব স্ট্রিম (৬–৯সে)"
 * সাইট-স্ট্রাকচার (মাপা):
 *   v5.hindmovie.im/<post-slug>/            ← সার্চ (wp-json) বা ?s=
 *     └── mvlink.blog/<id> | links.joshapp.blog/<id>   ← পোস্ট-পেজ (এম্বেড-লিংক)
 *           └── hshare.lol/?id=<filename>              ← ফাইল-পেজ, ফাইলনাম + ৪ বাটন
 *                 ├── gdshine.org/api/share/<short> → …workers.dev/d/…      (Fast)
 *                 └── hubcloud (hcloud.ink / …workers.dev/0:/…)             (Hub)
 *
 * নীতি:
 *   • প্রতি পোস্টের **প্রতিটি ফাইল** (৬টি) × **দুটি পথ** = ১২ কার্ড — কিছুই বাদ নয়
 *   • প্রতিটি নেটওয়ার্ক-কল verified-pool নোড দিয়ে (always-ready), ডিরেক্ট সমান্তরাল ব্যাকআপ
 *   • verify (Range-probe) নেই: HM মৃত হোস্ট ব্যবহার করে না (ইউজার-নির্দেশ)
 *   • প্ল্যান-ক্যাশ: একবার সফল হলে post+file তালিকা ৩০মিন ধরে রাখি ⇒ পরের ট্যাপ ~২সে
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const POOL_FILE = path.join(__dirname, '..', '..', 'hm_proxy_pool.json');
const TRACE = process.env.HMTRACE === '1';

/* ── পুল ───────────────────────────────────────────────────────────── */
const COOKIES = new Map();   // host → { name: value }
function cookieHeader(host) {
  const c = COOKIES.get(host);
  if (!c) return '';
  return Object.entries(c).map(([k, v]) => k + '=' + v).join('; ');
}
function cookieSet(host, setCookie) {
  if (!setCookie) return;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  let c = COOKIES.get(host);
  if (!c) { c = {}; COOKIES.set(host, c); }
  for (const sc of arr) {
    const kv = String(sc).split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) c[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
}
const POOL = new Map();     // "ip:port" → { ok, att, ms, ts, cap:{site,hs,gd,bb,pl} }
const DIR = { ok: 0, fail: 0 };
/* ★ v1.34.428: **হোস্ট-প্রতি ট্রান্সপোর্ট-মেমোরি** — কোন হোস্টে ডিরেক্ট কাজ করে, কোনটায় প্রক্সি
   লাগে। মাপা: hshare/gdshine-এ ডিরেক্ট-ই দ্রুত (প্রক্সি ৪০০ দিয়ে সময় নষ্ট করত); mvlink-এ
   ডিরেক্ট ব্লকড (প্রোডে files=0)। এখন সফল-পথটাই আগে যায় ⇒ প্রতি-হোস্ট ২–৩সে সাশ্রয়। */
const HPREF = new Map();   // host → { d: n, px: n }
function hpOf(host) { let h = HPREF.get(host); if (!h) { h = { d: 0, px: 0 }; HPREF.set(host, h); } return h; }
function hpBest(host) { const h = HPREF.get(host); if (!h) return 'both'; return (h.d >= 2) ? 'd' : ((h.px >= 2 && h.d === 0) ? 'px' : 'both'); }
const CAPS = ['site', 'hs', 'gd', 'bb', 'pl'];

function poolLoad() {
  try {
    const raw = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) {
      if (!v || !(v.ok > 0)) continue;
      POOL.set(k, { ok: v.ok || 0, att: v.att || 0, ms: v.ms || 0, ts: v.ts || 0, cap: v.cap || {} });
    }
  } catch (e) { if (TRACE) console.error('[hm.pool] load fail ' + e.message); }
  return POOL.size;
}
function poolSave() {
  try {
    const out = {};
    for (const [k, v] of POOL) out[k] = v;
    fs.writeFileSync(POOL_FILE, JSON.stringify(out));
  } catch (e) { }
}
function capOf(url) {
  const u = String(url);
  if (/mvlink\.|joshapp\./.test(u)) return 'pl';      // পোস্ট-পেজ
  if (/hshare\./.test(u)) return 'hs';
  if (/gdshine\.|gdtot\./.test(u)) return 'gd';
  if (/hcloud\.|workers\.dev/.test(u)) return 'bb';
  return 'site';
}
function poolPick(n, cap) {
  const AGE = Number(process.env.HMAGE || 7 * 24 * 3600e3);
  const arr = [];
  for (const [k, v] of POOL) {
    if (!(v.ok > 0)) continue;
    if (Date.now() - (v.ts || 0) > AGE) continue;
    const c = v.cap || {};
    const bad = (v.bad || {})[cap] || 0;
    if (bad >= 2) continue;   /* একই ক্যাপে ২ বার ব্যর্থ ⇒ বাদ */
    const sc = (c[cap] ? 100 : 0) - bad * 30 + (cap === 'site' && c.site ? 10 : 0);
    arr.push([k, v, sc]);
  }
  arr.sort((a, b) => (b[2] - a[2]) || (((b[1].ok || 0) / Math.max(1, b[1].att || 1)) - ((a[1].ok || 0) / Math.max(1, a[1].att || 1))) || ((a[1].ms || 9e9) - (b[1].ms || 9e9)));
  return arr.slice(0, Math.max(1, n)).map(x => x[0]);
}
function poolNote(node, ok, ms, cap) {
  const v = POOL.get(node);
  if (!v) return;
  if (!ok && cap) { v.bad = v.bad || {}; v.bad[cap] = (v.bad[cap] || 0) + 1; }
  v.att = (v.att || 0) + 1;
  if (ok) { v.ok++; v.ms = ms ? Math.round(ms) : v.ms; if (cap) { v.cap = v.cap || {}; v.cap[cap] = 1; v.ts = Date.now(); } }
}
function poolStats() {
  const s = { total: POOL.size, ok: 0, cap: { site: 0, hs: 0, gd: 0, bb: 0, pl: 0 }, best: '' };
  let bm = 9e9;
  for (const [k, v] of POOL) {
    if (!v.ok) continue;
    s.ok++;
    for (const c of Object.keys(v.cap || {})) if (s.cap[c] !== undefined) s.cap[c]++;
    if ((v.ms || 9e9) < bm) { bm = v.ms || 9e9; s.best = k; }
  }
  return s;
}
function dirStats() { return { ok: DIR.ok, fail: DIR.fail, poolFirst: true }; }

/* ── HTTP: এক কল (ডিরেক্ট বা প্রক্সি) ───────────────────────────────── */
function parseProxy(px) {
  if (!px) return null;
  const s = String(px);
  if (s.includes('://')) { try { const u = new URL(s); return { host: u.hostname, port: Number(u.port) || 80, auth: u.username ? (u.username + ':' + u.password) : '' }; } catch (e) { return null; } }
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  return { host: s.slice(0, i), port: Number(s.slice(i + 1)) || 80, auth: '' };
}

function once(url, ms, ref, px, depth, post) {
  depth = depth || 0;
  return new Promise(resolve => {
    let done = false, req = null;
    const t0 = Date.now();
    const fin = (r) => { if (done) return; done = true; clearTimeout(timer); try { if (req) req.destroy(); } catch (e) { } resolve(r); };
    const timer = setTimeout(() => fin(null), Math.max(2600, ms) + 400);
    let u;
    try { u = new URL(url); } catch (e) { clearTimeout(timer); return fin(null); }
    const goDirect = () => {
      const mod = u.protocol === 'https:' ? https : http;
      try {
        req = mod.request({
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: post ? 'POST' : 'GET',
          headers: { 'user-agent': UA, 'accept': 'text/html,application/json,*/*', 'accept-encoding': 'identity', 'accept-language': 'en-US,en;q=0.9', ...(cookieHeader(u.hostname) ? { cookie: cookieHeader(u.hostname) } : {}), ...(ref ? { referer: ref } : {}), ...(post ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(post) } : {}) },
          timeout: Math.max(1000, ms)
        }, res => collect(res, 'd'));
        req.on('error', () => fin(null));
        req.end(post || undefined);
      } catch (e) { fin(null); }
    };
    const goProxy = (p) => {
      const P = parseProxy(p);
      if (!P) return fin(null);
      const authH = P.auth ? { 'proxy-authorization': 'Basic ' + Buffer.from(P.auth).toString('base64') } : {};
      /* ★ HTTPS-টার্গেটের জন্য **CONNECT টানেল** দরকার — নইলে প্রক্সি 400/501 দেয় (মাপা) */
      if (u.protocol === 'https:') {
        try {
          const creq = http.request({
            host: P.host, port: P.port, method: 'CONNECT', path: u.hostname + ':443',
            headers: { host: u.hostname + ':443', 'user-agent': UA, ...authH }, timeout: Math.max(1500, ms)
          });
          creq.on('connect', (cres, socket) => {
            if (cres.statusCode !== 200) { try { socket.destroy(); } catch (e) { } return fin(null); }
            try {
              req = https.request({
                hostname: u.hostname, path: u.pathname + u.search, method: 'GET', socket, agent: false,
                headers: { host: u.hostname, 'user-agent': UA, accept: 'text/html,application/json,*/*', 'accept-encoding': 'identity', 'accept-language': 'en-US,en;q=0.9', ...(cookieHeader(u.hostname) ? { cookie: cookieHeader(u.hostname) } : {}), ...(ref ? { referer: ref } : {}) },
                timeout: Math.max(1500, ms)
              }, res => collect(res, p));
              req.on('error', () => fin(null));
              req.end();
            } catch (e) { fin(null); }
          });
          creq.on('error', () => fin(null));
          creq.on('timeout', () => { try { creq.destroy(); } catch (e) { } fin(null); });
          creq.end();
        } catch (e) { fin(null); }
        return;
      }
      try {
        req = http.request({
          host: P.host, port: P.port, path: url, method: 'GET',
          headers: { host: u.host, 'user-agent': UA, 'accept': '*/*', 'accept-encoding': 'identity', connection: 'close', ...authH },
          timeout: Math.max(1200, ms)
        }, res => collect(res, p));
        req.on('error', () => fin(null));
        req.end();
      } catch (e) { fin(null); }
    };
    const follow = (nu, d) => {
      once(nu, Math.max(1500, ms - (Date.now() - t0)), ref, px, d).then(r => fin(r), () => fin(null));
    };
    const collect = (res, via) => {
      const chunks = []; let size = 0;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', d => { size += d.length; if (size < 3.2e6) chunks.push(d); else { try { res.destroy(); } catch (e) { } } });
      const st = res.statusCode || 0;
      try { cookieSet(u.hostname, res.headers['set-cookie']); } catch (e) { }
      const GOOD = st >= 200 && st < 400;
      /* ★ v1.34.427: `end`-এর **ভেতরে** বডি বানাই (আগে হ্যান্ডলার বসানোর আগেই বানিয়ে ফেলছিলাম
         ⇒ সবসময় ০ বাইট — মাপা বাগ)। আর বৈধ-নয় স্টেটাস (400/403/5xx) ⇒ ব্যর্থ, রেস চলবে। */
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        /* ★ v1.34.427: **রিডাইরেক্ট ফলো** (৩ ধাপ) — `hshare.lol/?id=…` → `302 /r.php?d=…`
           (মাপা: রিডাইরেক্ট ফলো না করায় finalUrls সবসময় ০ হচ্ছিল) */
        const loc = res.headers.location;
        if (st >= 300 && st < 400 && loc && depth < 3) {
          let next = loc;
          try { next = new URL(loc, url).toString(); } catch (e) { }
          if (TRACE) console.error('[hm.redir] ' + st + ' → ' + next.slice(0, 70));
          return follow(next, depth + 1);
        }
        if (TRACE) console.error('[hm.' + (via === 'd' ? 'd' : 'px') + '] ' + st + ' ' + body.length + 'b ' + url.slice(0, 60));
        fin(GOOD ? { st, t: body, via, ms: Date.now() - t0, h: res.headers } : null);
      });
      stream.on('error', () => fin(null));
      res.on('aborted', () => fin(null));
    };
    /* একক-প্রয়াস: px থাকলে প্রক্সি দিয়ে, নাহলে ডিরেক্ট। রেস সামলায় get() */
    if (px) goProxy(px); else goDirect();
  });
}

/* ── HTTP: পুল-ফার্স্ট রেস (একটাই অ্যাক্সেস-পয়েন্ট) ───────────────── */
function get(url, ms, ref, post) {
  return new Promise(resolve => {
    let done = false;
    const t0 = Date.now();
    const fin = r => { if (!done) { done = true; resolve(r || { st: 0, t: '', via: '', ms: Date.now() - t0 }); } };
    const cap = capOf(url);
    const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
    const pref = hpBest(host);
    const nodes = (pref === 'd') ? [] : poolPick(Number(process.env.HMPXN || 1), cap);
    let pendingProxy = nodes.length;
    let directStarted = false;
    const startDirect = () => {
      if (directStarted) return; directStarted = true;
      once(url, ms, ref, null, 0, post).then(r => {
        if (r) { DIR.ok++; hpOf(host).d++; fin(r); } else { DIR.fail++; }
      }, () => { DIR.fail++; });
    };
    for (const p of nodes) {
      once(url, Math.max(2400, ms), ref, p, 0, post).then(r => {
        if (r && r.st > 0) { hpOf(host).px++; poolNote(p, true, r.ms, cap); fin(r); }
        else { poolNote(p, false, 0, cap); }
      }, () => { poolNote(p, false, 0, cap); });
    }
    /* ডিরেক্ট-IP ব্যাকআপ: নোড না থাকলে সাথে সাথে, থাকলে HMDIRBACK পরে (সমান্তরাল) */
    setTimeout(startDirect, nodes.length ? Number(process.env.HMDIRBACK || (pref === 'px' ? 900 : 300)) : 0);
    setTimeout(() => fin(null), Math.max(2600, ms) + 800);
  });
}

/* ── হোস্ট-আবিষ্কার (ডোমেইন বদলায়) ──────────────────────────────── */
let BASE = '';
const CAND = String(process.env.HMBASE || 'https://v5.hindmovie.im,https://hindmovie.vin,https://hindmovie.im').split(',');
async function discover(force) {
  if (BASE && !force) return BASE;
  const probe = CAND.map(async u => {
    const r = await get(u.replace(/\/$/, '') + '/wp-json/', 2600);
    return (r && r.st >= 200 && r.st < 400) ? u.replace(/\/$/, '') : null;
  });
  const out = await Promise.all(probe);
  BASE = out.find(Boolean) || CAND[0];
  if (TRACE) console.error('[hm.base] ' + BASE);
  return BASE;
}

/* ── সার্চ ──────────────────────────────────────────────────────── */
const SEARCH_MEM = new Map();
async function search(title, ms) {
  const q = String(title || '').trim();
  if (!q) return [];
  const ck = q.toLowerCase();
  const c = SEARCH_MEM.get(ck);
  if (c && Date.now() - c.ts < Number(process.env.HMSMEM || 1800000)) return c.v;
  const B = await discover();
  const out = [];
  const push = u => {
    const s = String(u || '');
    if (!/^https:\/\/(?:[a-z0-9-]+\.)?hindmovie\.[a-z]{2,6}\/[a-z0-9][a-z0-9-]*\/?$/i.test(s)) return;
    if (!out.includes(s)) out.push(s);
  };
  const [r1, r2] = await Promise.all([
    get(B + '/wp-json/wp/v2/search?search=' + encodeURIComponent(q) + '&per_page=8', Math.min(3800, ms || 4000)),
    get(B + '/?s=' + encodeURIComponent(q), Math.min(3800, ms || 4000))
  ]);
  try { const a = JSON.parse(r1.t); if (Array.isArray(a)) a.forEach(x => push(x.url)); } catch (e) { }
  for (const m of (r2.t || '').match(/href="(https:\/\/(?:[a-z0-9-]+\.)?hindmovie\.[a-z]{2,6}\/[a-z0-9][a-z0-9-]*\/)"/gi) || []) push(m.slice(6, -1));
  if (TRACE) console.error('[hm.search] ' + out.length + ' @' + (r1.ms || r2.ms));
  if (out.length) { if (SEARCH_MEM.size > 200) SEARCH_MEM.clear(); SEARCH_MEM.set(ck, { ts: Date.now(), v: out }); }
  return out;
}

/* ── পোস্ট-পেজ → ফাইল-নাম (hshare) ─────────────────────────────────── */
const FILE_OK = /\.(mkv|mp4|avi|webm)$/i;
function parseFiles(html) {
  /* ★ v1.34.428: hshare-এর `?id=` **ফাইলনাম নয়** — md5-টোকেন (মাপা: ফাইলনাম দিলে `302 /404`)।
     তাই `{ name, id }` দুটোই রাখি; id থাকলে সেটাই ব্যবহার করি, নাহলে ফাইলনাম দিয়ে চেষ্টা। */
  const byId = new Map();
  for (const m of (html || '').matchAll(/hshare\.lol\/?\?id=([^"'&<>\s]+)/gi)) {
    let id = m[1];
    try { id = decodeURIComponent(id); } catch (e) { }
    if (!id) continue;
    const looksName = FILE_OK.test(id) && /\s|\(|\)/i.test(id) === false && id.length > 24 && /[A-Z]/i.test(id) && /\d{3,4}p/i.test(id);
    if (looksName) byId.set(id, { name: id.replace(/[#?].*$/, ''), id: '' });
    else byId.set(id, { name: '', id });
  }
  /* পোস্ট-পেজে থাকা ফাইলনাম-প্যাটার্ন (id না পেলে ফলব্যাক) */
  const names = [];
  for (const m of (html || '').matchAll(/([A-Za-z0-9][A-Za-z0-9._()\-\[\] ]{6,120}\.(?:mkv|mp4))/gi)) {
    const n = m[1].trim();
    if (n.length > 8 && FILE_OK.test(n)) names.push(n);
  }
  const out = [];
  for (const v of byId.values()) out.push(v);
  for (const n of names) if (!out.some(x => x.name === n)) out.push({ name: n, id: '' });
  return out;
}
function embedsOf(html) {
  const out = [];
  for (const m of (html || '').matchAll(/(?:href|src|data-[a-z]+)="(https?:\/\/(?:mvlink\.blog|links\.joshapp\.blog)\/[^"'<>]+)"/gi)) out.push(m[1]);
  for (const m of (html || '').matchAll(/https?:\/\/(?:mvlink\.blog|links\.joshapp\.blog)\/[a-z0-9]+/gi)) out.push(m[0]);
  return [...new Set(out)];
}
async function post(url, ms) {
  const r = await get(url, ms || 4000);
  const html = r.t || '';
  const title = (html.match(/<title[^>]*>([^<]{3,160})<\/title>/i) || [])[1] || '';
  /* ★ v1.34.428: পোস্ট-পেজের লিংকগুলো `links.joshapp.blog/<id>` / `mvlink.blog/<id>` — ওগুলো
     খুললে ফাইল-নাম পাওয়া যায়, আর joshapp-এর wp-json-এ আসল গন্তব্য `boldb.site/?id=<file>`। */
  const mv = [];
  for (const m of (html || '').matchAll(/https?:\/\/(?:mvlink\.blog|links\.joshapp\.blog)\/[a-z0-9]+/gi)) mv.push(m[0]);
  const uniqMv = [...new Set(mv)];
  const boldb = new Set();
  const names = new Set();
  const addName = n => { const s = String(n || '').trim(); if (s.length > 8 && FILE_OK.test(s)) names.add(s); };
  const addBold = u => { for (const m of String(u).matchAll(/boldb\.site\/\?id=([^"'&<>\s]+)/gi)) { let v = m[1]; try { v = decodeURIComponent(v); } catch (e) { } addName(v); boldb.add(v); } };

  const parseAll = h => {
    for (const f of parseFiles(h)) { if (f.name) addName(f.name); if (f.id) boldb.add(f.id); }
    addBold(h);
  };
  parseAll(html);

  if (!names.size && uniqMv.length) {
    /* joshapp/mvlink পোস্ট: wp-json থেকে দ্রুত, না পেলে HTML */
    const jobs = [];
    for (const u of uniqMv.slice(0, 4)) {
      const mwp = u.match(/joshapp\.blog\/(\d+)/);
      if (mwp) jobs.push(get('https://links.joshapp.blog/wp-json/wp/v2/posts/' + mwp[1], Math.min(4000, ms || 4000), u));
      jobs.push(get(u, Math.min(4000, ms || 4000), url));
    }
    const rs = await Promise.all(jobs);
    for (const rr of rs) parseAll(rr.t || '');
  }

  const files = [];
  for (const n of names) files.push({ name: n, id: '' });
  for (const b of boldb) if (!files.some(f => f.name === b)) files.push({ name: b, id: '' });
  if (TRACE) console.error('[hm.post] mv=' + uniqMv.length + ' files=' + files.length + ' ' + url.slice(-40));
  return { url, title, mv: uniqMv, files };
}

/* ── ফাইলনাম → {Fast, Hub} চূড়ান্ত লিংক ───────────────────────────── */
function qualityOf(name) {
  const n = String(name || '');
  if (/2160|4k/i.test(n)) return '2160';
  if (/1080/i.test(n)) return '1080';
  if (/720/i.test(n)) return '720';
  if (/480/i.test(n)) return '480';
  return 'MKV';
}
function audioOf(name) {
  const n = String(name || '').toLowerCase();
  const langs = [];
  if (/hindi/.test(n)) langs.push('Hindi');
  if (/english/.test(n)) langs.push('English');
  if (/tamil/.test(n)) langs.push('Tamil');
  if (/telugu/.test(n)) langs.push('Telugu');
  if (!langs.length) return '';
  const dual = /dual|multi/.test(n);
  return (dual ? 'Multi ' : '') + langs.join('-');
}

function cleanUrl(u) {
  const s = String(u || '').replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
  const m = s.match(/^https?:\/\/[^"'<>\n]*(?:\.mkv|\.mp4|\.avi|\.webm)/i);
  return (m ? m[0] : (/\.mkv|\.mp4/i.test(s) ? s : '')).replace(/ /g, '%20');
}
/* hcloud: redirect.php?url=<b64> → (ভেতরে আরেক b64) → workers.dev/0:/… */
function hcloudDecode(first) {
  const dec = s => { try { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4), 'base64').toString('utf8'); } catch (e) { return ''; } };
  let cur = dec(first);
  for (let i = 0; i < 4 && cur; i++) {
    const m = cur.match(/https?:\/\/[^"'<>\n]*?workers\.dev\/0:\/[^"'<>\n]*?\.(?:mkv|mp4|avi|webm)/i);
    if (m) return m[0].trim().replace(/ /g, '%20');
    const n = cur.match(/[?&]url=([^\s"'<>&]+)/);
    if (!n) break;
    const nx = dec(n[1]);
    if (!nx || nx === cur) break;
    cur = nx;
  }
  return '';
}

async function finalUrls(entry, ms, kind) {
  const name = (entry && entry.name) || String(entry || '');
  const hid = (entry && entry.id) || '';
  const B = Number(ms || 8000);
  const t0 = Date.now();
  const left = () => Math.max(1800, B - (Date.now() - t0));
  const out = [];
  const push = u => { const c = cleanUrl(u); if (c && !out.includes(c)) out.push(c); };
  const grab = (html) => {
    for (const m of String(html || '').matchAll(/https?:\/\/[^"'\\ <>]*(?:workers\.dev|gdshine\.org|gdtot)[^"'\\ <>]*/g)) push(m[0].replace(/\\\//g, '/'));
  };

  /* ১) **boldb.site/?id=<ফাইলনাম>** — সবচেয়ে সস্তা: এক কলেই workers.dev স্ট্রিম + gdshine short */
  if (name) {
    const rb = await get('https://boldb.site/?id=' + encodeURIComponent(name), Math.min(6000, left()), 'https://boldb.site/');
    if (rb.t) {
      grab(rb.t);
      /* hcloud (hcloud.shop / hcloud.ink) → base64 → workers.dev/0:/… */
      for (const m of (rb.t || '').matchAll(/hcloud\.(?:shop|ink)\/redirect\.php\?url=([^"'<>\s&]+)/g)) {
        const dir = hcloudDecode(m[1]);
        if (dir) push(dir);
      }
    }
  }

  /* ★ v1.34.428: boldb এক কলেই **সরাসরি workers.dev স্ট্রিম** দেয় ⇒ পেলেই hshare/gdshine-চেইন
     বাদ (মাপা: প্রতি ফাইলে ৪–৬সে সাশ্রয়)।-chain তখনই চালাই যখন boldb কিছু দেয়নি। */
  const gotDirect = out.length > 0;
  /* ২) hshare.lol (?id= টোকেন থাকলে সেটাই, নাহলে ফাইলনাম) — gdshine + hcloud বাটন */
  if (!gotDirect && left() > 2500) {
    const hs = 'https://hshare.lol/?id=' + encodeURIComponent(hid || name);
    const r = await get(hs, Math.min(5000, left()), 'https://hshare.lol/');
    const h = r.t || '';
    if (h) {
      grab(h);
      const shorts = [...new Set([...h.matchAll(/gdshine\.org\/(?:s|api\/share)\/([A-Za-z0-9_\-]{6,})/g)].map(m => m[1]))];
      for (const m of (h || '').matchAll(/hcloud\.(?:shop|ink)\/redirect\.php\?url=([^"'<>\s&]+)/g)) {
        const dir = hcloudDecode(m[1]);
        if (dir) push(dir);
      }
      /* Fast পথ: short → file.id → POST via-worker (কপি-ড্রাইভ না থাকলে ৪০০) */
      await Promise.all(shorts.slice(0, 2).map(async short => {
        const a = await get('https://gdshine.org/api/share/' + short, Math.min(4000, left()), 'https://gdshine.org/');
        let fid = '';
        try { const j = JSON.parse(a.t || '{}'); fid = j && j.data && j.data.file && j.data.file.id || ''; } catch (e) { }
        if (!fid) return;
        const p2 = await get('https://gdshine.org/api/downloads/' + fid + '/via-worker', Math.min(2500, left()), 'https://gdshine.org/', '{}');
        try {
          const j2 = JSON.parse(p2.t || '{}');
          const d = (j2 && j2.data) || {};
          for (const k of ['copyUrl', 'downloadUrl', 'url']) if (d[k]) push(d[k]);
        } catch (e) { }
      }));
    }
  }
  if (TRACE) console.error('[hm.file] ' + name.slice(-30) + ' → ' + out.length + ' @' + (Date.now() - t0));
  return out;
}

/* ── প্ল্যান-ক্যাশ + কার্ড-মেমো ─────────────────────────────────────── */
const PLAN = new Map();   // title|type|s|e → { ts, posts, files }
const CARDS = new Map();  // একই key → { ts, v }
const LAST = {};

function keyOf(title, type, s, e) {
  return (String(title || '').toLowerCase() + '|' + (type || 'movie') + '|' + (s || 0) + '|' + (e || 0));
}

/* মূল কাজ: সব ফাইল × সব পথ → কার্ড (প্রথম ফল পেলেও বাকিগুলো শেষ করে) */
async function cardsInner(title, type, s, e, mk, budget, sink, onFirst) {
  const T0 = Date.now();
  const B = Number(budget || process.env.HMCARDS || 11000);
  const left = () => Math.max(600, B - (Date.now() - T0));
  LAST.title = String(title || ''); LAST.at = T0; LAST.posts = 0; LAST.files = 0; LAST.urls = 0; LAST.cards = 0; LAST.stage = 'start';

  const pk = keyOf(title, type, s, e);
  const plan = PLAN.get(pk);
  const planOk = plan && Date.now() - plan.ts < Number(process.env.HMPLAN || 1800000) && plan.files.length;

  let files = [];
  let posts = [];
  const T1 = Date.now();
  if (planOk) { files = plan.files.slice(); LAST.stage = 'plan'; if (TRACE) console.error('[hm.plan] ' + files.length); }
  else {
    posts = await search(title, Math.min(4000, left()));
    LAST.posts = posts.length; LAST.stage = posts.length ? 'posts' : 'no-posts';
    if (!posts.length) { LAST.ms = Date.now() - T0; return sink; }
    /* ★ v1.34.428: মুভিতে **১টি পোস্টই** যথেষ্ট (ফাইল-তালিকা একই) ⇒ পোস্ট-পর্যায় অর্ধেক */
    const want = posts.slice(0, type === 'series' ? 2 : 1);
    const got = new Set();
    const collect = [];
    await Promise.all(want.map(async u => {
      const p = await post(u, Math.min(4200, left()));
      for (const f of (p.files || [])) { const kk = (f && (f.id || f.name)) || String(f); if (!got.has(kk)) { got.add(kk); collect.push(f); } }
    }));
    files = collect;
    if (files.length) { if (PLAN.size > 120) PLAN.clear(); PLAN.set(pk, { ts: Date.now(), posts: posts.length, files: files.slice(0, 24) }); }
  }
  LAST.tPost = Date.now() - T1; LAST.tSearch = T1 - T0;
  LAST.files = files.length;
  if (!files.length) { LAST.stage = 'no-files'; LAST.ms = Date.now() - T0; return sink; }

  /* ★ সাইট-স্ট্রাকচার: প্রতিটি ফাইলের **দুটি পথই** (Hub+Fast) — ৬ ফাইল ⇒ ১২ কার্ড */
  const expire = () => { const p = PLAN.get(pk); if (p) p.ts = 0; };
  /* ★★ v1.34.428 (ইউজার: "hindmovie only 1080p and 4k stream e pick koro, time kom lagbe") —
     **শুধু 1080p ও 4K/2160p** রিজলভ করি ⇒ ৬-এর বদলে ২–৩ ফাইল × ২ পথ = ৪–৬ কার্ড, সময় প্রায়
     অর্ধেক। 1080/4K না থাকলে (HM-এ বিরল) তবেই 720→480 ফলব্যাক, যাতে কার্ড শূন্য না হয়
     (`HMQUAL` দিয়ে বদলানো যায়; `HMFALLBACK=0` দিলে ফলব্যাক বন্ধ)। */
  const WANT = String(process.env.HMQUAL || '1080,2160').split(',').map(s => s.trim()).filter(Boolean);
  const nmOf = f => (f && (f.name || f.id)) || String(f || '');
  const wanted = files.filter(f => WANT.includes(qualityOf(nmOf(f))));
  const useList = wanted.length ? wanted
    : (process.env.HMFALLBACK === '0' ? [] : files.slice().sort((a, b) => (Number(qualityOf(nmOf(b))) || 0) - (Number(qualityOf(nmOf(a))) || 0)).slice(0, 2));
  const perQ = Number(process.env.HMQCAP || 3);
  const qSeen = {};
  const queue = useList.filter(f => {
    const q = qualityOf(nmOf(f));
    qSeen[q] = (qSeen[q] || 0) + 1;
    return qSeen[q] <= perQ;
  });
  LAST.want = WANT.join('+'); LAST.picked = queue.length; LAST.pickNames = queue.slice(0, 4).map(nmOf);
  // ভালো কোয়ালিটি আগে, তারপর বাকি — কিন্তু সবগুলোই যাবে
  queue.sort((a, b) => (Number(qualityOf(nmOf(b))) || 0) - (Number(qualityOf(nmOf(a))) || 0));

  let idx = 0, announced = false;
  const workers = [];
  const run = async () => {
    while (idx < queue.length) {
      if (left() < 700) break;
      const f = queue[idx++];
      let us = [];
      try { us = await finalUrls(f, Math.min(9000, Math.max(5000, left())), 'movie'); } catch (e) { us = []; }
      if (!us.length) continue;
      LAST.urls += us.length;
      for (const u of us) {
        if (!/^https?:\/\//.test(u)) continue;
        const kindTag = /workers\.dev\/d\//.test(u) ? 'Fast' : (/workers\.dev\/0:\//.test(u) ? 'Hub' : 'Mirror');
        const nm = nmOf(f);
        const q = qualityOf(nm);
        const card = mk ? mk(u, nm, q, kindTag, { name: nm, kind: 'movie' }) : { url: u, filename: nm, quality: q, tag: kindTag };
        if (!card) continue;
        if (!sink.some(x => x && x.url === u)) sink.push(card);
      }
      if (sink.length && !announced) { announced = true; if (onFirst) onFirst(); }
      if (TRACE) console.error('[hm.file] ' + nmOf(f).slice(-34) + ' → ' + us.length + ' @' + (Date.now() - T0));
    }
  };
  for (let k = 0; k < Number(process.env.HMWRK || 3); k++) workers.push(run());
  await Promise.all(workers);

  LAST.cards = sink.length; LAST.ms = Date.now() - T0;
  LAST.stage = sink.length ? 'ok' : 'urls-but-no-cards';
  if (!sink.length) expire();
  return sink;
}

/* বাইরের API: প্রথম কার্ড এলেই ফেরত, বাকিগুলো পেছনে ভরে (মেমোতে) */
function cards(title, type, s, e, mk, budget) {
  const k = keyOf(title, type, s, e);
  const c = CARDS.get(k);
  if (c && Date.now() - c.ts < Number(process.env.HMCARDTTL || 600000)) return Promise.resolve(c.v);
  const sink = [];
  return new Promise(resolve => {
    let done = false;
    const fin = () => {
      if (done) return; done = true;
      const v = sink.slice();
      if (v.length) { if (CARDS.size > 200) CARDS.clear(); CARDS.set(k, { ts: Date.now(), v }); }
      resolve(v);
    };
    cardsInner(title, type, s, e, mk, budget, sink, fin).then(() => { setTimeout(() => { if (sink.length) { if (CARDS.size > 200) CARDS.clear(); CARDS.set(k, { ts: Date.now(), v: sink.slice() }); } }, 0); fin(); }).catch(() => fin());
    setTimeout(fin, Math.max(2000, Number(budget || process.env.HMCARDS || 11000)) + 1600);
  });
}

module.exports = {
  poolLoad, poolSave, poolStats, dirStats, capOf, poolPick,
  discover, search, post, finalUrls, cardsInner, cards,
  cardsCached: cards,
  warm: (t, ty, s, e, mk, b) => cardsInner(t, ty, s, e, mk, b || 20000, []).catch(() => []),
  qualityOf, audioOf, last: () => LAST, get
};
