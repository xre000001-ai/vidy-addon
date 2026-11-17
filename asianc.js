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

async function acResolveEmbedTry(embedUrl) {
  const embed = await acGet(embedUrl, 11000, AC_BASE + '/');
  if (!embed) return '';
  let purl = ((/<iframe[^>]+src="([^"]*3rdplayer[^"]*)"/i.exec(embed) || [])[1] || '');
  if (!purl) purl = ((/<iframe[^>]+src="([^"]+)"/i.exec(embed) || [])[1] || '');
  if (!purl) return '';
  if (purl.indexOf('//') === 0) purl = 'https:' + purl;
  else if (purl[0] === '/') { try { purl = new URL(purl, embedUrl).toString(); } catch (e) { } }
  const player = await acGet(purl, 11000, embedUrl);
  if (!player) return '';
  // পথ ১: vidbasic-এর নিজস্ব 3rdplayer — AES-256-CBC পেলোড
  const dv = (/data-name="cr[a-z]*"[^>]*data-value="([^"]+)"/i.exec(player) || [])[1]
    || (/data-value="([A-Za-z0-9+/=]{40,})"[^>]*data-name="cr[a-z]*"/i.exec(player) || [])[1]
    || (/data-value="([A-Za-z0-9+/=]{60,})"/i.exec(player) || [])[1];
  if (dv) {
    try {
      const url = acDecrypt(dv);
      if (/^https?:\/\//.test(url)) return url;
      ACG.decFail++;
    } catch (e) { ACG.decFail++; }
  } else ACG.noCrypto++;
  // পথ ২: hglink → jwplayer (packer-eval)
  const jw = acLinksFromPlayer(player);
  if (jw) return jw;
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

/* ── প্লেবিলিটি: প্লেলিস্ট/ফাইল সত্যিই আসে কি না ────────────────────────────── */
async function acQualityOf(url) {
  // মাপা: vidbasic-এর প্লেলিস্টে RESOLUTION লেখা থাকে না (শুধু BYTERANGE) ⇒ ধরে নিই না, দেখি
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AC_UA, 'Referer': AC_BASE + '/' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    const head = (await r.text()).slice(0, 6000);
    const res = [...head.matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map(m => Number(m[2])).filter(Boolean);
    if (res.length) return String(Math.max.apply(null, res));
  } catch (e) { }
  return '';
}
async function acPlayable(url, ms) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': AC_UA, 'Referer': AC_BASE + '/', 'Accept': '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(Math.max(4000, ms || 9000)) });
      const ct = String(r.headers.get('content-type') || '');
      if (r.ok) {
        if (/mpegurl|m3u8/i.test(ct) || /\.m3u8(\?|$)/i.test(url)) {
          const t = await r.text();
          if (t.indexOf('#EXTM3U') >= 0) return { ok: true, kind: 'hls' };
        } else if (/video\/|octet-stream/i.test(ct)) return { ok: true, kind: 'mp4' };
        return { ok: true, kind: 'file' };
      }
    } catch (e) { }
    await new Promise(z => setTimeout(z, 350 + i * 600));
  }
  return { ok: false, kind: '' };
}

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

  try {
    // ১) slug: সরাসরি শিরোনাম-ভিত্তিক অনুমান আগে (দ্রুত), না মিললে সার্চ
    let detail = null, slug = '';
    const guessForSeason = tv && S > 1 ? (acSlugify(title) + '-season-' + S) : acSlugify(title);
    const key = (tv ? 'tv' : 'mv') + ':' + id + ':' + acKey(title) + (tv ? ':' + S + ':' + E : ''); // v1.34.307: শিরোনাম-সহ (একই-id-তে memo-ভাগ-নয়)
    const epKey = 'ep|' + key;
    const memo = AC_EP.get(epKey);
    if (memo && Date.now() - memo.ts < AC_EP_TTL) return memo.cards;

    const found = await acFindSlug(title, year, tv ? S : 1);
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
    const jobs = await Promise.all(servers.slice(0, 6).map(async sv => {
      const u = await acResolveEmbed(sv.url).catch(() => '');
      if (!u) return null;
      const p = await acPlayable(u).catch(() => ({ ok: false }));
      if (!p.ok) { ACG.badPlay++; return null; }
      const qq = p.kind === 'hls' ? await acQualityOf(u).catch(() => '') : '';
      return { label: sv.label, url: u, kind: p.kind, quality: qq };
    }));
    const live = jobs.filter(Boolean);

    const cards = [];
    const head = '\u29c9 ' + (title || detail.title || (tv ? 'Series' : 'Movie')) + (year ? ' | ' + year + ' |' : '');
    const epLine = tv ? ('\u29e0 S' + S + 'E' + E) : '\u29e0 Movie';
    for (const l of live) {
      const q = l.quality || (/(\d{3,4})p/.exec(l.url) || [])[1] || '';   // মাপা কোয়ালিটি, নাহলে Auto
      const name = q ? ('\u25a5 ' + q + ' \u25a5') : '\u25a5 Auto \u25a5';
      const txt = head + '\n' + epLine + '\n\u229e AsianC' + (l.label && l.label !== 'Standard' ? ' \u2317 ' + l.label : '') + ' \u00b7 AsianC';
      cards.push({
        name: name,
        quality: q || '',
        url: l.url,
        title: txt,
        description: txt,
        behaviorHints: { filename: l.kind === 'hls' ? 'asianc.m3u8' : 'asianc.mp4', notWebReady: true, proxyHeaders: { request: { 'User-Agent': AC_UA, 'Referer': AC_BASE + '/' } } },
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

function acDiag() {
  return Object.assign({ base: AC_BASE, slugMemo: AC_SLUG.size, epMemo: AC_EP.size, embMemo: AC_EMB.size }, ACG);
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
          if (u) out.playable = await acPlayable(u);
        }
      }
    }
  } catch (e) { out.err = String(e && e.message); }
  return out;
}

setTimeout(() => { }, 0);
module.exports = { acOn, acStreams, acDiag, acSelftest, acDecrypt, acServersOf, acResolveEmbed, acPlayable, acFindSlug, acDetail, AC_BASE, AC_UA };
