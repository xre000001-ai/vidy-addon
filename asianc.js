'use strict';
/* ═══════════════════════════════════════════════════════════════════════════════
   asianc.id — Dramacool-ধাঁচের এশিয়ান ড্রামা/মুভি সোর্স (vidly.pro-এর বদলে)
   ───────────────────────────────────────────────────────────────────────────────
   সাইট-গঠন (মাপা):
     খোঁজ     : /search?keyword=<q>          → ফল列表中 /drama-detail/<slug>
     ডিটেইল   : /drama-detail/<slug>          → শিরোনাম + সব এপিসোড (/<slug>-episode-N.html)
     এপিসোড   : /<slug>-episode-N.html        → <li class="Standard Server" data-video="https://vidbasic.top/embed/<id>">
     এমবেড    : https://vidbasic.top/embed/<id> → iframe → /3rdplayer.html?key=<K>&id=<id>
     প্লেয়ার  : /3rdplayer.html — obfuscated; পেলোড <script src="/assets/crypto-js.js" data-value="<b64>">
                CryptoJS.AES.decrypt(b64, '94588293375053432799222445521289', {iv:'5259228356829423'})
                ⇒ আসল HLS/MP4 URL
     স্ট্রিম   : https://hls.vidbasic.top/<uuid>/index.m3u8 → EXTM3U/BYTERANGE, সেগমেন্ট
                https://jungkookido.top/<uuid>/<n>.html (আসলে MPEG-TS, Range ২০৬) ⇒ সরাসরি চলে
   ═══════════════════════════════════════════════════════════════════════════════ */

const AC_BASE = process.env.AC_BASE || 'https://asianc.id';
const AC_UA = process.env.AC_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const AC_KEY = '94588293375053432799222445521289';     // প্লেয়ারের ti()-সমতুল্য
const AC_IV = '5259228356829423';

const ACG = { pages: 0, pageFail: 0, noSearch: 0, noDetail: 0, noServer: 0, noCrypto: 0, decFail: 0, cards: 0, badPlay: 0 };
const AC_SLUG = new Map();     // "title|year|s" → {ts, slug, detail}
const AC_EP = new Map();       // slug|N → {ts, list:[{label,url}]}
const AC_EMB = new Map();      // embedId → {ts, url}
const AC_SIB = new Map();      // embedId → [একই ড্রামার অন্য এপিসোডের এমবেড-URL]
const AC_INFLIGHT = new Map();
const AC_TTL = 6 * 60 * 60 * 1000, AC_EP_TTL = 90 * 60 * 1000, AC_EMB_TTL = 40 * 60 * 1000;

function acOn(cfg) { return process.env.ACOFF !== '1' && !(cfg && cfg.acs === 0); }
function _shrink(m, f) { for (const k of [...m.keys()].slice(0, Math.ceil(m.size * f))) m.delete(k); }
const acKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const acSlugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function acGet(url, ms, referer) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': AC_UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', ...(referer ? { 'Referer': referer } : {}) },
        redirect: 'follow', signal: AbortSignal.timeout(Math.max(4000, ms || 9000))
      });
      const t = await r.text();
      ACG.pages++;
      if (r.ok && t.length > 200) return t;
      if (r.status === 429 || r.status >= 500) { await new Promise(z => setTimeout(z, 500 + i * 800)); continue; }
      return t;
    } catch (e) { await new Promise(z => setTimeout(z, 400 + i * 700)); }
  }
  ACG.pageFail++;
  return '';
}

/* ── খোঁজ: শিরোনাম ⇒ /drama-detail/<slug> ──────────────────────────────────── */
function acPickResult(html, title, year, season) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href="(\/drama-detail\/[^"#?]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].replace('/drama-detail/', '');
    if (seen.has(slug)) continue;
    seen.add(slug);
    const attrs = m[2] || '';
    let txt = ((/title="([^"]+)"/i.exec(attrs) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim();
    if (!txt) {
      const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 300);
      txt = tail.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    if (!txt) continue;
    out.push({ slug: slug, text: txt });
  }
  if (!out.length) return null;

  const want = acKey(title);
  if (!want) return null;
  const yr = Number(year) || 0;
  const S = Math.max(1, Number(season) || 1);

  /* ★ v1.34.307 (মাপা: `Squid Game`-এ `Breaking Bad Fortune Teller` ফেরত আসছিল):
     শুধু-শব্দ-মিল নয় — শিরোনাম **হুবহু** হতে হবে; অতিরিক্ত অংশ শুধু "Season N" হতে পারবে। */
  const cands = [];
  for (const r of out) {
    const clean = r.text.replace(/^\d+\s*/, '').replace(/\(\d{4}\)\s*$/, '').trim();
    const y = Number((/\((\d{4})\)/.exec(r.text) || [])[1] || 0);
    let key = acKey(clean);
    let sn = 0;
    const sm = /season\s*(\d+)\s*$/i.exec(clean);
    if (sm) { sn = Number(sm[1]); key = acKey(clean.replace(/season\s*\d+\s*$/i, '')); }
    if (!key) continue;
    // হুবহু-মিল ছাড়া কিছু নয় (কোনো word-overlap স্কোর নেই)
    if (key !== want) continue;
    cands.push({ slug: r.slug, text: r.text, base: key, sn: sn, year: y });
  }
  if (!cands.length) return null;

  // সিজন-বাছাই: S>1 হলে ওই সিজনের এন্ট্রি; S=1 হলে "season-ছাড়া" এন্ট্রি।
  const exactSeason = cands.filter(c => (S > 1 ? c.sn === S : c.sn === 0));
  let pool = exactSeason.length ? exactSeason : [];
  if (!pool.length && S === 1) pool = cands.filter(c => c.sn === 0);
  if (!pool.length) return null;  // সিজন-মিল না-থাকলে ভুল-এপিসোড দেওয়ার চেয়ে না-দেওয়া ভালো
  // বছরের নিকটতা → ছোট slug
  pool.sort((a, b) => {
    const ay = yr && a.year ? Math.abs(a.year - yr) : 99;
    const by = yr && b.year ? Math.abs(b.year - yr) : 99;
    if (ay !== by) return ay - by;
    return a.slug.length - b.slug.length;
  });
  return { slug: pool[0].slug, text: pool[0].text };
}

async function acFindSlug(title, year, season) {
  const ck = acKey(title) + '|' + (Number(year) || 0) + '|' + (Number(season) || 1);
  const hit = AC_SLUG.get(ck);
  if (hit && Date.now() - hit.ts < AC_TTL) return hit;
  const q = String(title || '').trim();
  if (!q) { ACG.noSearch++; return null; }
  const html = await acGet(AC_BASE + '/search?keyword=' + encodeURIComponent(q), 11000);
  if (!html) { ACG.noSearch++; return null; }
  const pick = acPickResult(html, q, year, season);
  if (!pick) { ACG.noSearch++; return null; }
  const rec = { ts: Date.now(), slug: pick.slug, text: pick.text };
  AC_SLUG.set(ck, rec);
  if (AC_SLUG.size > 400) _shrink(AC_SLUG, 0.4);
  return rec;
}

/* ── ডিটেইল: শিরোনাম + এপিসোড-তালিকা ──────────────────────────────────────── */
async function acDetail(slug, ms) {
  const html = await acGet(AC_BASE + '/drama-detail/' + slug, ms || 11000);
  if (!html) { ACG.noDetail++; return null; }
  const title = ((/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/.exec(html) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const eps = [];
  const seen = new Set();
  const re = /href="(\/([a-z0-9\-]+?)-episode-(\d+)\.html)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const n = Number(m[3]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    eps.push({ n: n, path: m[1] });
  }
  eps.sort((a, b) => a.n - b.n);
  return { title: title, eps: eps };
}

/* ── এপিসোড: সার্ভার-তালিকা (data-video) ───────────────────────────────────── */
function acServersOf(html) {
  const out = [];
  const re = /<li[^>]*class="([^"]*Server[^"]*)"[^>]*data-video="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = m[1], url = m[2];
    const label = (cls.replace(/\bselected\b/gi, '').replace(/\s*Server\s*/i, '').trim()) || 'Standard';
    if (!/^https?:\/\//.test(url)) continue;
    out.push({ label: label, url: url });
  }
  return out;
}


/* ── hglink-ধাঁচের jwplayer প্লেয়ার (packer-eval) — রিজার্ভ-পথ ──────────────────
   queen-of-tears/vincenzo-র মতো এপিসোডে vidbasic-এর নিজের প্লেয়ার না-থেকে
   hglink.to → audinifer.com-এ জমা দেয়; সেখানে `links.hls4|hls3|hls2` (packer-এ লুকানো)।
   মাপা (৩১-৮-২০২৬): ওই CDN গুলো ডেটাসেন্টার-IP-তে ৫০৪/403 দেয় ⇒ কার্ড হয় না।
   তবু পথটা রাখা হলো — ভবিষ্যতে host খুললে নিজে থেকেই কাজ করবে। */
function acUnpackJs(src) {
  const vm = require('vm');
  let cur = String(src || ''), out = '';
  for (let i = 0; i < 4; i++) {
    const st = cur.indexOf('eval(');
    if (st < 0) break;
    const inner = cur.slice(st + 5, cur.lastIndexOf(')'));
    try {
      const r = vm.runInNewContext('(' + inner + ')', {}, { timeout: 5000 });
      if (typeof r !== 'string') break;
      cur = r; out = r;
    } catch (e) { break; }
  }
  return out;
}
function acLinksFromPlayer(playerHtml) {
  const inline = [...String(playerHtml || '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  for (const s of inline) {
    if (s.indexOf('eval(function(p,a,c,k,e,d)') < 0) continue;
    const d = acUnpackJs(s);
    if (!d) continue;
    const pick = (k) => ((new RegExp('"hls' + k + '"\\s*:\\s*"([^"]+)"')).exec(d) || [])[1] || '';
    const url = pick(4) || pick(3) || pick(2) || pick(1);
    if (url) return url.replace(/\\\//g, '/');
  }
  return '';
}
/* vidbasic-এর এমবেড-পেজে সার্ভার-তালিকা (Streamwish/Vidhide/Dood/Streamtape/Mixdrop…) */
function acEmbedServers(embedHtml) {
  const out = [];
  const re = /<li[^>]*class="linkserver[^"]*"[^>]*data-video="([^"]+)"/gi;
  let m;
  while ((m = re.exec(embedHtml))) out.push(m[1]);
  return out;
}

/* ── এমবেড → 3rdplayer → AES → আসল HLS/MP4 ─────────────────────────────────── */
function acDecrypt(b64) {
  const crypto = require('crypto');
  const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(AC_KEY, 'utf8'), Buffer.from(AC_IV, 'utf8'));
  const out = Buffer.concat([d.update(Buffer.from(String(b64), 'base64')), d.final()]);
  return out.toString('utf8').replace(/\0+$/, '').trim();
}

/* ── hglink-ধাঁচের "লোডিং" পেজ → আসল প্লেয়ার-হোস্ট ───────────────────────────
   hglink.to/e/<id> শুধু ৮১৯ বাইটের spinner + /main.js পাঠায়; main.js (obfuscated) ব্রাউজারে
   location.href বদলে `https://<mirror>/e/<id>`-তে নিয়ে যায় (মিরর ঘুরতে থাকে: audinifer.com,
   callistanise.com …)। আমরা main.js-টা sandbox-এ চালিয়ে মিরর-হোস্টটা **শিখে নিই** (৬ঘণ্টা ক্যাশ)। */
const AC_MIRROR = { host: process.env.AC_MIRROR || '', ts: 0, known: String(process.env.AC_MIRRORS || 'audinifer.com,callistanise.com,vibuxer.com').split(',').map(s => s.trim()).filter(Boolean) };
async function acLearnMirror(host, force) {
  if (!force && AC_MIRROR.host && Date.now() - AC_MIRROR.ts < 6 * 60 * 60 * 1000) return AC_MIRROR.host;
  // বাধ্যতামূলক পুনরায়-শেখা প্রতি ২ মিনিটে একবারের বেশি নয় (প্রতিটি এপিসোডে ১-২সে নষ্ট হতো)
  if (force && AC_MIRROR.forceTs && Date.now() - AC_MIRROR.forceTs < 120000) return AC_MIRROR.host || '';
  if (force) AC_MIRROR.forceTs = Date.now();
  try {
    const vm = require('vm');
    const base = host || 'hglink.to';
    const js = await acGet('https://' + base + '/main.js?v=1.1.9', 12000, 'https://' + base + '/');
    if (!js || js.length < 5000) return AC_MIRROR.host || '';
    const nav = [];
    const loc = { hostname: base, host: base, protocol: 'https:', pathname: '/e/x', search: '', hash: '', origin: 'https://' + base,
      href: 'https://' + base + '/e/x', assign(v) { nav.push(String(v)); }, replace(v) { nav.push(String(v)); } };
    const el = () => ({ style: {}, setAttribute() { }, appendChild() { }, addEventListener() { }, removeChild() { }, classList: { add() { }, remove() { } } });
    const sb = {
      location: loc,
      document: { referrer: 'https://' + base + '/', cookie: '', createElement: el, head: el(), body: el(), getElementById: () => el(),
        querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, documentElement: el(), write() { }, URL: loc.href, title: '' },
      navigator: { userAgent: AC_UA, languages: ['en-US'] },
      atob: s => Buffer.from(String(s), 'base64').toString('binary'), btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
      setTimeout: () => 0, setInterval: () => 0, clearTimeout() { }, clearInterval() { }, requestAnimationFrame: () => 0,
      console: { log() { }, warn() { }, error() { } }, fetch: () => Promise.reject(new Error('x')),
      XMLHttpRequest: function () { return { open() { }, send() { }, setRequestHeader() { }, addEventListener() { } }; },
      Math, Date, JSON, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, unescape, escape,
      URL, URLSearchParams, TextEncoder, TextDecoder, Promise, Uint8Array, ArrayBuffer, Object, Array, String, Number, RegExp, Error, TypeError, Boolean
    };
    sb.window = sb; sb.self = sb; sb.globalThis = sb; sb.top = sb; sb.parent = sb;
    try { vm.runInNewContext(js, sb, { timeout: 6000 }); } catch (e) { }
    const finalUrl = nav.map(u => { try { return new URL(u, loc.href).toString(); } catch (e) { return ''; } }).filter(Boolean).pop() || loc.href;
    const h = (() => { try { return new URL(finalUrl).hostname; } catch (e) { return ''; } })();
    if (h && h !== base) {
      AC_MIRROR.host = h; AC_MIRROR.ts = Date.now(); ACG.mirror = h;
      if (AC_MIRROR.known.indexOf(h) < 0) { AC_MIRROR.known.unshift(h); AC_MIRROR.known = AC_MIRROR.known.slice(0, 6); }
    }
    return AC_MIRROR.host || '';
  } catch (e) { return AC_MIRROR.host || ''; }
}
/* "Loading…" পেজ ⇒ আসল প্লেয়ার-হোস্টে গিয়ে আবার চেষ্টা */
async function acFollowSpinner(html, url) {
  if (!html || html.length > 3000) return '';
  if (!/Page is loading|loading-text|main\.js\?v=/.test(html)) return '';
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return ''; }
  const tried = new Set();
  const cands = [];
  const m1 = await acLearnMirror(host);
  if (m1) cands.push(m1);
  // লার্নড মিরর ঠান্ডা হলে একবার জোর করে আবার শিখি, তারপর জানা-তালিকা
  const m2 = await acLearnMirror(host, true);
  if (m2) cands.push(m2);
  for (const k of AC_MIRROR.known) cands.push(k);
  for (const mirror of cands) {
    if (!mirror || mirror === host || tried.has(mirror)) continue;
    tried.add(mirror);
    const target = url.replace('://' + host + '/', '://' + mirror + '/');
    if (target === url) continue;
    const real = await acGet(target, 12000, 'https://' + host + '/');
    if (real && real.length > 3000) { ACG.mirrorWin = (ACG.mirrorWin || 0) + 1; return real; }
  }
  return '';
}

/* একটি HTML-পেজ থেকে স্ট্রিম-URL বের করার সব উপায় একসাথে */
function acUrlFromHtml(html) {
  if (!html) return '';
  // পথ ১: vidbasic-এর নিজস্ব 3rdplayer — AES-256-CBC পেলোড
  const dv = (/data-name="cr[a-z]*"[^>]*data-value="([^"]+)"/i.exec(html) || [])[1]
    || (/data-value="([A-Za-z0-9+/=]{40,})"[^>]*data-name="cr[a-z]*"/i.exec(html) || [])[1]
    || (/data-value="([A-Za-z0-9+/=]{60,})"/i.exec(html) || [])[1];
  if (dv) {
    try {
      const url = acDecrypt(dv);
      if (/^https?:\/\//.test(url)) return url;
      ACG.decFail++;
    } catch (e) { ACG.decFail++; }
  } else ACG.noCrypto++;
  // পথ ২: hglink/streamwish-ধাঁচের jwplayer প্লেয়ার — packer-eval (`links.hls4|hls3|hls2`)
  const jw = acLinksFromPlayer(html);
  if (jw) return jw;
  return '';
}

async function acResolveEmbedTry(embedUrl) {
  const embed = await acGet(embedUrl, 11000, AC_BASE + '/');
  if (!embed) return '';
  // ★ v1.34.309 (মূল বাগ): hglink-ধাঁচের এপিসোডে **এমবেড-পেজ নিজেই প্লেয়ার**
  //   (কোনো iframe নেই) — আগে শুধু iframe খোঁজা হতো ⇒ ৪টি শিরোনামে কার্ডই আসত না।
  const direct = acUrlFromHtml(embed);
  if (direct) return direct;
  const embReal = await acFollowSpinner(embed, embedUrl);
  if (embReal) { const g2 = acUrlFromHtml(embReal); if (g2) return g2; }
  let purl = ((/<iframe[^>]+src="([^"]*3rdplayer[^"]*)"/i.exec(embed) || [])[1] || '');
  if (!purl) purl = ((/<iframe[^>]+src="([^"]+)"/i.exec(embed) || [])[1] || '');
  if (!purl) return '';
  if (purl.indexOf('//') === 0) purl = 'https:' + purl;
  else if (purl[0] === '/') { try { purl = new URL(purl, embedUrl).toString(); } catch (e) { } }
  let player = await acGet(purl, 11000, embedUrl);
  if (!player) return '';
  let got = acUrlFromHtml(player);
  if (got) { try { AC_REF.set(new URL(got).hostname, new URL(purl).origin + '/'); } catch (e) { } return got; }
  // spinner-পেজ হলে মিরর-হোস্টে গিয়ে আবার
  const followed = await acFollowSpinner(player, purl);
  if (followed) {
    got = acUrlFromHtml(followed);
    if (got) { try { AC_REF.set(new URL(got).hostname, 'https://' + (AC_MIRROR.host || new URL(purl).hostname) + '/'); } catch (e) { } return got; }
  }
  return '';
}

async function acResolveEmbed(embedUrl) {
  const idm = /\/embed\/([A-Za-z0-9_-]+)/.exec(embedUrl);
  const eid = idm ? idm[1] : embedUrl;
  const hit = AC_EMB.get(eid);
  if (hit && Date.now() - hit.ts < AC_EMB_TTL) return hit.url;
  if (AC_INFLIGHT.has(eid)) { try { return await AC_INFLIGHT.get(eid); } catch (e) { return ''; } }
  const pr = (async () => {
    try {
      const first = await acResolveEmbedTry(embedUrl);
      if (first) return first;
      // পথ ৩: এমবেড-পেজের অন্য সার্ভারগুলো (Streamwish/Vidhide/Dood/Streamtape/Mixdrop)
      const embed = await acGet(embedUrl, 9000, AC_BASE + '/');
      const alts = acEmbedServers(embed).filter(u => u !== embedUrl).slice(0, 3);
      for (const a of alts) {
        const u = await acResolveEmbedTry(a).catch(() => '');
        if (u) { ACG.altWin = (ACG.altWin || 0) + 1; return u; }
      }
      // পথ ৪: একই ড্রামার অন্য এপিসোড (মাপা: hglink-এপিসোডে vidbasic-নিজস্ব প্লেয়ার না-থাকলে
      //        পাশের এপিসোডের vidbasic-এমবেড কাজ করে — একই ফাইল/লিস্ট ধরে রাখে)
      const sib = (AC_SIB.get(eid) || []).slice(0, 4);
      for (const su of sib) {
        if (su === embedUrl) continue;
        const u = await acResolveEmbedTry(su).catch(() => '');
        if (u) { ACG.sibWin = (ACG.sibWin || 0) + 1; return u; }
      }
    } catch (e) { }
    return '';
  })();
  AC_INFLIGHT.set(eid, pr);
  let url = '';
  try { url = await pr; } finally { AC_INFLIGHT.delete(eid); }
  if (url) {
    AC_EMB.set(eid, { ts: Date.now(), url: url });
    if (AC_EMB.size > 600) _shrink(AC_EMB, 0.4);
  }
  return url;
}

/* ── প্লেলিস্ট-রিলে: সঠিক content-type + absolute সেগমেন্ট ─────────────────────
   ★ v1.34.314 (ইউজার: "my royal nemesis e video chole na"): vidbasic-এর প্লেলিস্ট
   `content-type: image/jpeg` পাঠায় ⇒ অনেক প্লেয়ার (ExoPlayer-এর বাইরে) ম্যানিফেস্ট
   হিসেবেই মানে না, আবার সেগমেন্ট-লাইনগুলো absolute নয়। তাই:
     কার্ড → /acs/p/<tok>/p.m3u8  (আমাদের রিলে, সঠিক MIME, CORS)
     মাস্টার হলে ভ্যারিয়েন্টও রিলে দিয়ে; মিডিয়া-প্লেলিস্টের সেগমেন্ট **সরাসরি CDN**
   ⇒ ব্যান্ডউইথ খরচ শুধু ছোট প্লেলিস্ট (KB), ভিডিও-বাইট CDN থেকে। */
const AC_REF = new Map();   // host → প্রয়োজনীয় Referer (মাপা: hglink-CDN রেফারার ছাড়া 404 দেয়)
function acRefFor(url) {
  try {
    const h = new URL(url).hostname;
    if (AC_REF.has(h)) return AC_REF.get(h);
    if (AC_MIRROR.host) return 'https://' + AC_MIRROR.host + '/';   // চলতি প্লেয়ার-হোস্টই সবচেয়ে বিশ্বাসযোগ্য
    return AC_BASE + '/';
  } catch (e) { return AC_BASE + '/'; }
}
function acRefCandidates(url) {
  const out = [];
  try {
    const h = new URL(url).hostname;
    if (AC_REF.has(h)) out.push(AC_REF.get(h));
    if (AC_MIRROR.host) out.push('https://' + AC_MIRROR.host + '/');
    for (const k of AC_MIRROR.known) out.push('https://' + k + '/');
    out.push(AC_BASE + '/');
    out.push('https://' + h + '/');
  } catch (e) { out.push(AC_BASE + '/'); }
  return [...new Set(out.filter(Boolean))];
}
const AC_TOK = new Map();
const AC_TOK_TTL = 45 * 60 * 1000;
const AC_ORI = { last: '' };
function acRelayUrl(origin, u) {
  try {
    const base = String(origin || AC_ORI.last || '').replace(/\/+$/, '');
    if (!base) return u;                 // origin অজানা ⇒ রিলে নয়, সরাসরি CDN URL (relative কখনো নয়)
    if (!AC_ORI.last && origin) AC_ORI.last = base;
    const tok = require('crypto').randomBytes(12).toString('base64url');
    AC_TOK.set(tok, { u: u, ts: Date.now() });
    if (AC_TOK.size > 900) for (const k of [...AC_TOK.keys()].slice(0, 400)) AC_TOK.delete(k);
    return base + '/acs/p/' + tok + '/p.m3u8';
  } catch (e) { return u; }
}
function acAbsolute(lines, base) {
  return lines.map(l => {
    const t = l.trim();
    if (!t || t[0] === '#') return l;
    try { return new URL(t, base).toString(); } catch (e) { return l; }
  });
}
async function acServePlaylist(req, res, tok, origin) {
  const ent = AC_TOK.get(tok);
  if (!ent) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('expired'); }
  ent.ts = Date.now();
  let up = null;
  for (const ref of acRefCandidates(ent.u)) {
    try {
      const r = await fetch(ent.u, { headers: { 'User-Agent': AC_UA, 'Referer': ref, 'Accept': '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(14000) });
      const ab = await r.arrayBuffer().catch(() => new ArrayBuffer(0));
      const cand = { st: r.status, ct: String(r.headers.get('content-type') || ''), buf: Buffer.from(ab), ref: ref };
      if (cand.buf.slice(0, 7).toString('latin1') === '#EXTM3U') { up = cand; try { AC_REF.set(new URL(ent.u).hostname, ref); } catch (e) { } break; }
      if (!up) up = cand;
    } catch (e) { }
  }
  if (!up || (up.st !== 200 && up.st !== 206) || up.buf.slice(0, 7).toString('latin1') !== '#EXTM3U') {
    res.writeHead(up && up.st ? up.st : 502, { 'content-type': 'text/plain' });
    return res.end('upstream-' + (up && up.st || 'err'));
  }
  ACG.relay = (ACG.relay || 0) + 1;
  let body = up.buf.toString('utf8');
  const isMaster = /#EXT-X-STREAM-INF/i.test(body);
  const lines = body.split('\n');
  const abs = acAbsolute(lines, ent.u);
  if (isMaster) {
    // ভ্যারিয়েন্ট-লাইন → আমাদের রিলে (সেগমেন্টের বদলে)। I-FRAME-URI-ও রিলে করি।
    body = abs.map(l => {
      const t = l.trim();
      if (!t || t[0] === '#') {
        return l.replace(/URI="([^"]+)"/g, (m0, u1) => {
          try { return 'URI="' + acRelayUrl(origin, new URL(u1, ent.u).toString()) + '"'; } catch (e) { return m0; }
        });
      }
      return acRelayUrl(origin, t);
    }).join('\n');
  } else {
    body = abs.join('\n');   // মিডিয়া-প্লেলিস্ট: সেগমেন্ট সরাসরি CDN
  }
  res.writeHead(200, {
    'content-type': 'application/vnd.apple.mpegurl',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'cdn-cache-control': 'no-store'
  });
  return res.end(/#EXTM3U/.test(body) ? body : ('#EXTM3U\n' + body));
}

/* ── প্লেবিলিটি: প্লেলিস্ট/ফাইল সত্যিই আসে কি না ────────────────────────────── */
/* ── প্রোব: URL সত্যিই মিডিয়া কি না ─────────────────────────────────────────
   ★ v1.34.309 (ইউজার-সংশোধন): "আমাদের ডেটাসেন্টার-IP-তে চলে না" মানে ইউজারের কাছেও
   চলবে না — এটা ধরে নেওয়া ভুল। তাই দুই স্তর:
     proven     = প্লেলিস্ট/ফাইল নামানো গেছে **এবং** ভেতরে আসল মিডিয়া-পেলোড
                  (ID3 / ftyp / TS-sync+PID) — সম্পূর্ণ প্রমাণ
     unverified = URL তৈরি হয়েছে (প্লেয়ার-চেইন সফল) কিন্তু আমাদের IP থেকে
                  403/429/5xx/টাইমআউট — **কার্ড তবু দেওয়া হবে** (ইউজারের ক্লায়েন্ট-IP-তে
                  সাধারণত চলে; এখান থেকে মিথ্যা "মৃত" ঘোষণা করা যাবে না)
   আগের বাগ: শুধু `#EXTM3U` দেখেই "প্লে-সত্য" ধরা হতো, অথচ ওই প্লেলিস্টে ৫১২KB-এ
   ১০০০+ TS-sync/H.264/AAC থাকতেও "Auto" দেখাত — সেটাই ছিল ভুল সিদ্ধান্তের কারণ। */
function acMediaShape(buf) {
  if (!buf || buf.length < 1024) return { media: false, why: 'short' };
  const id3 = buf.slice(0, 3).toString('latin1') === 'ID3';
  const ftyp = buf.slice(4, 8).toString('latin1') === 'ftyp';
  let ts = 0;
  for (let i = 0; i + 1 < buf.length; i++) if (buf[i] === 0x47 && (buf[i + 1] & 0x40)) { ts++; if (ts > 3) break; }
  const h264 = buf.includes(Buffer.from([0, 0, 0, 1, 0x67])) || buf.includes(Buffer.from([0, 0, 1, 0x67])) || buf.includes(Buffer.from([0, 0, 0, 1, 0x41]));
  const hevc = buf.includes(Buffer.from([0, 0, 0, 1, 0x40])) || buf.includes(Buffer.from([0, 0, 1, 0x40]));
  return { media: !!(id3 || ftyp || ts > 3 || h264 || hevc), id3: id3, ftyp: ftyp, tsSync: ts, h264: h264, hevc: hevc, bytes: buf.length };
}
async function acBuf(url, ms, range) {
  for (let i = 0; i < 2; i++) {
    try {
      const h = { 'User-Agent': AC_UA, 'Referer': AC_BASE + '/', 'Accept': '*/*' };
      if (range) h.Range = range;
      const r = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(ms || 12000) });
      const ab = await r.arrayBuffer().catch(() => new ArrayBuffer(0));
      return { st: r.status, ct: String(r.headers.get('content-type') || ''), buf: Buffer.from(ab) };
    } catch (e) {
      if (i === 1) return { st: 0, ct: '', buf: Buffer.alloc(0), err: (e.cause && e.cause.code) || e.message };
      await new Promise(z => setTimeout(z, 500));
    }
  }
  return { st: 0, ct: '', buf: Buffer.alloc(0) };
}
function acResOf(playlist) {
  const res = [...String(playlist || '').matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map(m => Number(m[2])).filter(Boolean);
  return res.length ? String(Math.max.apply(null, res)) : '';
}
async function acProbe(url, ms) {
  /* ★ v1.34.309: master → variant → segment — ৩ ধাপ পর্যন্ত ফলো করি (এক্সটেনশন দেখে নয়,
     ভেতরের `#EXTM3U` দেখে)। কারণ hglink-CDN master-কে `.txt`/`.woff2` নামে লুকায়। */
  let cur = url, q = '', chain = 0, last = null, sawPlaylist = false;
  while (chain < 3) {
    const isRange = chain > 0;   // সেগমেন্টে Range দিয়ে অর্ধ-MB
    const r = await acBuf(cur, ms || 16000, isRange ? 'bytes=0-524287' : null);
    last = r;
    const head = r.buf.slice(0, 7).toString('latin1');
    const isPlaylist = (r.st === 200 || r.st === 206) && head.indexOf('#EXTM3U') === 0;
    if (isPlaylist) {
      sawPlaylist = true;
      const wrote = r.buf.toString('utf8');
      const rq = acResOf(wrote);
      if (rq) q = rq;
      const lines = wrote.split('\n').map(l => l.trim()).filter(l => l && l[0] !== '#');
      if (!lines.length) return { state: 'unverified', kind: 'hls', quality: q, why: 'no-lines' };
      const nxt = lines[0].startsWith('http') ? lines[0] : new URL(lines[0], cur).toString();
      chain++;
      cur = nxt;
      continue;
    }
    // প্লেলিস্ট নয় — মিডিয়া-পেলোড কি না
    if (r.st === 200 || r.st === 206) {
      const shape = acMediaShape(r.buf);
      if (shape.media) return { state: 'proven', kind: sawPlaylist ? 'hls' : 'mp4', quality: q, shape: shape, why: 'media-payload' };
      return { state: 'unverified', kind: sawPlaylist ? 'hls' : 'mp4', quality: q, shape: shape, why: 'non-media-' + (r.st || 'x') };
    }
    // ব্লক/এরর
    if (r.st === 404 || r.st === 410) return { state: 'dead', dead: true, kind: sawPlaylist ? 'hls' : 'mp4', quality: q, why: 'http-' + r.st };
    return { state: 'unverified', kind: sawPlaylist ? 'hls' : 'mp4', quality: q, why: 'http-' + (r.st || r.err || 'x') };
  }
  // চেইন শেষ, কিন্তু এখনো শুধু প্লেলিস্ট — শেষ প্লেলিস্ট থাকলেও URL বৈধ
  return { state: 'unverified', kind: 'hls', quality: q, why: 'chain-end' };
}

// পুরোনো নামগুলো রাখা হলো (রিজার্ভ-পথে ব্যবহৃত)
async function acPlayable(url, ms) { const p = await acProbe(url, ms); return { ok: p.state === 'proven', kind: p.kind, state: p.state }; }
async function acQualityOf(url) { const p = await acProbe(url); return p.quality; }

/* ── মূল এন্ট্রি ────────────────────────────────────────────────────────────── */
async function acStreams(tmdbId, type, s, e, origin, opt) {
  const o = opt || {};
  const id = Number(tmdbId) || 0;
  if (!id) return [];
  const tv = (type === 'series' || type === 'tv' || type === 'tvshow');
  const S = tv ? (Number(s) || 1) : 0, E = tv ? (Number(e) || 1) : 0;
  const title = String(o.title || o.name || '').trim();
  const year = String(o.year || '').trim();
  if (!title) { ACG.noSearch++; return []; }

  const _t0 = Date.now();
  try {
    if (origin) AC_ORI.last = String(origin).replace(/\/+$/, '');
    // ১) slug: সরাসরি শিরোনাম-ভিত্তিক অনুমান আগে (দ্রুত), না মিললে সার্চ
    let detail = null, slug = '';
    const guessForSeason = tv && S > 1 ? (acSlugify(title) + '-season-' + S) : acSlugify(title);
    const key = (tv ? 'tv' : 'mv') + ':' + id + ':' + acKey(title) + (tv ? ':' + S + ':' + E : ''); // v1.34.307: শিরোনাম-সহ (একই-id-তে memo-ভাগ-নয়)
    const epKey = 'ep|' + key;
    const memo = AC_EP.get(epKey);
    if (memo && Date.now() - memo.ts < AC_EP_TTL) return memo.cards;

    const found = await acFindSlug(title, year, tv ? S : 1);
    if (Date.now() - _t0 > (Number(o.ms) || 11000) * 0.6) { ACG.lateBudget = (ACG.lateBudget || 0) + 1; return []; }
    slug = (found && found.slug) || guessForSeason;
    detail = await acDetail(slug);
    if (!detail || !detail.eps || !detail.eps.length) {
      // অনুমান ভুল হলে: slug সরাসরি চেষ্টা
      if (guessForSeason && guessForSeason !== slug) {
        const d2 = await acDetail(guessForSeason);
        if (d2 && d2.eps && d2.eps.length) { detail = d2; slug = guessForSeason; }
      }
    }
    if (!detail || !detail.eps.length) { ACG.noServer++; return []; }

    // ২) এপিসোড বাছাই (মুভি হলে N=1 / últime এপিসোড)
    let epRec = null;
    if (tv) epRec = detail.eps.find(x => x.n === E) || null;
    if (!epRec) epRec = detail.eps[0];
    if (!epRec) { ACG.noServer++; return []; }

    const epHtml = await acGet(AC_BASE + epRec.path, 11000, AC_BASE + '/drama-detail/' + slug);
    if (!epHtml) { ACG.noServer++; return []; }
    const servers = acServersOf(epHtml);
    if (!servers.length) { ACG.noServer++; return []; }
    // একই এপিসোড-সেটের এমবেড-আইডি পাশে রাখি (উপরের পথ-৪-এর জন্য)
    try {
      const ids = servers.map(s => (/\/embed\/([A-Za-z0-9_-]+)/.exec(s.url) || [])[1]).filter(Boolean);
      for (const i of ids) if (!AC_SIB.has(i)) AC_SIB.set(i, servers.map(s => s.url));
      if (AC_SIB.size > 500) _shrink(AC_SIB, 0.4);
    } catch (e) { }

    // ৩) প্রতিটি সার্ভার → এমবেড → AES → URL (সমান্তরাল)
    /* ★ v1.34.309: ইউজার-সংশোধন — "আমাদের IP-তে চলে না" ⇒ কার্ড বাদ, এটা আর করা হবে না।
       URL তৈরি হলেই কার্ড; শুধু সত্যিই-মৃত (HTTP 404/410, খালি বডি, মিডিয়া-নয় এমন বডি
       যা প্লেলিস্টও নয়) বাদ যায়। ডেটাসেন্টার-ব্লক (403/429/5xx/টাইমআউট) = unverified কার্ড। */
    const _budget = Math.max(4000, Number(o.ms) || 11000);
    const _left = () => _budget - (Date.now() - _t0);
    if (_left() < 1200) { ACG.lateBudget = (ACG.lateBudget || 0) + 1; return []; }
    const jobs = await Promise.all(servers.slice(0, 6).map(async sv => {
      const _r = await Promise.race([
        acResolveEmbed(sv.url).catch(() => ''),
        new Promise(z => setTimeout(() => z(''), Math.max(1500, _left() - 800)))
      ]);
      const u = _r || '';
      if (!u) return null;
      const p = await Promise.race([
        acProbe(u, Math.max(2500, _left())).catch(() => ({ state: 'unverified', kind: /m3u8/i.test(u) ? 'hls' : 'mp4', quality: '', why: 'probe-throw' })),
        new Promise(z => setTimeout(() => z({ state: 'unverified', kind: /m3u8/i.test(u) ? 'hls' : 'mp4', quality: '', why: 'probe-budget' }), Math.max(2000, _left())))
      ]);
      if (p.dead) { ACG.badPlay++; return null; }
      if (p.state === 'proven') ACG.proven = (ACG.proven || 0) + 1; else ACG.unverified = (ACG.unverified || 0) + 1;
      return { label: sv.label, url: u, kind: p.kind || (/m3u8/i.test(u) ? 'hls' : 'mp4'), quality: p.quality || '', state: p.state };
    }));
    const live = jobs.filter(Boolean);

    const cards = [];
    const head = '\u29c9 ' + (title || detail.title || (tv ? 'Series' : 'Movie')) + (year ? ' | ' + year + ' |' : '');
    const epLine = tv ? ('\u29e0 S' + S + 'E' + E) : '\u29e0 Movie';
    for (const l of live) {
      const q = l.quality || (/(\d{3,4})p/.exec(l.url) || [])[1] || '';   // মাপা কোয়ালিটি, নাহলে Auto
      const name = q ? ('\u25a5 ' + q + ' \u25a5') : '\u25a5 Auto \u25a5';
      const tag = (l.label && l.label !== 'Standard' ? ' \u2317 ' + l.label : '') + (l.state === 'proven' ? ' \u2713' : '');
      const txt = head + '\n' + epLine + '\n\u229e AsianC' + tag + ' \u00b7 AsianC';
      // `.txt`-নামেও মাস্টার-প্লেলিস্ট লুকানো থাকে ⇒ হোস্ট-নাম/ext দেখে রিলে করি
      const _looksPl = (l.kind === 'hls') || /\.(m3u8|txt)(\?|$)/i.test(l.url) || /\/hls\d?\//i.test(l.url);
      const cardUrl = _looksPl ? acRelayUrl(origin, l.url) : l.url;
      cards.push({
        name: name,
        quality: q || '',
        url: cardUrl,
        title: txt,
        description: txt,
        behaviorHints: { filename: (_looksPl ? 'asianc.m3u8' : 'asianc.mp4'), notWebReady: true, proxyHeaders: { request: { 'User-Agent': AC_UA, 'Referer': acRefFor(l.url) } } },
        bingeGroup: 'acs|' + acSlugify(title) + '::' + (l.label || 'Standard')
      });
    }
    if (!cards.length) return [];
    ACG.cards += cards.length;
    AC_EP.set(epKey, { ts: Date.now(), cards: cards });
    if (AC_EP.size > 300) _shrink(AC_EP, 0.4);
    return cards;
  } catch (err) {
    return [];
  }
}

/* ── প্রি-ওয়ার্ম: Stremio সাধারণত একই এপিসোড দুইবার চায়; প্রথমবার ধীর, দ্বিতীয়বার
   ক্যাশ থেকে। পরের এপিসোডও পেছনে-পেছনে গরম করে রাখি (মোট রিকোয়েস্ট-সংখ্যা প্রায় অপরিবর্তিত)। */
const AC_WARM = new Map();
function acPrewarm(tmdbId, type, s, e, opt) {
  try {
    const o = opt || {};
    if (o.origin) AC_ORI.last = String(o.origin).replace(/\/+$/, '');
    const k = 'w|' + String(type) + '|' + String(tmdbId) + '|' + String(o.title || '') + '|' + s + ':' + e;
    if (AC_WARM.has(k)) return;
    AC_WARM.set(k, Date.now());
    if (AC_WARM.size > 200) for (const kk of [...AC_WARM.keys()].slice(0, 80)) AC_WARM.delete(kk);
    setTimeout(() => {
      acStreams(tmdbId, type, s, e, o.origin || '', { title: o.title || '', year: o.year || '', ms: 16000 })
        .then(() => {
          // পরের এপিসোডও গরম করি (সিরিজে)
          if (type !== 'movie' && type !== 'film' && Number(s) > 0) {
            const k2 = 'w|' + type + '|' + tmdbId + '|' + (o.title || '') + '|' + s + ':' + (Number(e) + 1);
            if (!AC_WARM.has(k2)) { AC_WARM.set(k2, Date.now()); acStreams(tmdbId, type, s, Number(e) + 1, '', { title: o.title || '', year: o.year || '', ms: 16000 }).catch(() => []); }
          }
        })
        .catch(() => []);
    }, 120);
  } catch (err) { }
}

function acDiag() {
  return Object.assign({ base: AC_BASE, mirror: AC_MIRROR.host || '', slugMemo: AC_SLUG.size, epMemo: AC_EP.size, embMemo: AC_EMB.size }, ACG);
}

async function acSelftest() {
  const out = {};
  try {
    const r = await acFindSlug('Squid Game', '2025', 3);
    out.slug = r && r.slug;
    if (r) {
      const d = await acDetail(r.slug);
      out.detail = d && d.title; out.episodes = d && d.eps.length;
      if (d && d.eps.length) {
        const html = await acGet(AC_BASE + d.eps[0].path, 11000);
        const sv = acServersOf(html);
        out.servers = sv.map(x => x.label + ':' + x.url.slice(-18));
        if (sv[0]) {
          const u = await acResolveEmbed(sv[0].url);
          out.resolved = u;
          if (u) out.probe = await acProbe(u).catch(e => ({ state: 'err', why: String(e && e.message) }));
        }
      }
    }
  } catch (e) { out.err = String(e && e.message); }
  return out;
}

setTimeout(() => { }, 0);
module.exports = { acOn, acStreams, acPrewarm, acServePlaylist, acDiag, acSelftest, acDecrypt, acServersOf, acResolveEmbed, acPlayable, acProbe, acFindSlug, acDetail, AC_BASE, AC_UA };
