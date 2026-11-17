'use strict';
/* ═══════════════════════════════════════════════════════════════════════════════
   vidly.pro — স্বতন্ত্র স্ট্রিম-সোর্স (v1.34.303)
   ───────────────────────────────────────────────────────────────────────────────
   কেন আলাদা ফাইল: Vidy/MovieBox/Multimovies-এর মতোই vidly.pro একটি **সম্পূর্ণ
   স্বাধীন সোর্স** — নিজস্ব সুইচ (cfg.vl), নিজস্ব রেজো/ভাষা-ছাঁকনি (vlr/vll),
   নিজস্ব রিলে (/vlh/), নিজস্ব ক্যাশ। server.js-এর ভেতরে কিছু বদলানো হয়নি।

   কীভাবে স্ট্রিম পাওয়া যায় (মাপা, প্রমাণিত):
     GET https://vidly.pro/{movie/<tmdb>|tv/<tmdb>/<s>/<e>}
       → পেজের ভেতরে `"sealed":"v1.<base64url>"`
       → বান্ডলের ti() সাইফার ধাঁচে ডিক্রিপ্ট (নিচে vlSealOpen)
       → { provider:{id,label,tag}, servers[6], streams:[{url,type,quality,…}] }
   sealed-এর ভেতরের URL-ই আসল HLS (img.rousav.tech / gzip.rousav.tech) — সেটি
   **Cloudflare-ব্লকড নয়**, রেফারার ছাড়াই ২০০ (মাপা), সেগমেন্টও ২০৬।

   সার্ভার-তালিকা (সিল-পেলোড থেকেই, বান্ডলে লেখা নেই):
     Edge(HD)=singularity · Prism(MULTI) · Flux(HD) · Nimbus(HD) · Comet(HD) · Citadel(MULTI)
   ⚠ মাপা-সত্য: একটিমাত্র stream (সক্রিয় provider, সাধারণত Edge)ই SSR-পেলোডে আসে;
     `?provider=prism` ইত্যাদি URL-প্যারাম বদলায় না, আর /api/sources = 403 CF।
     তাই ৬টি সার্ভার-নাম কার্ডে দেখানো হয় না — যে স্ট্রিম সত্যিই চলে সেটিই কার্ড।

   রিলে: `/vlh/<b64url(master)>/p.m3u8[?a=<n>.th|-r<res>]` — শুধু প্লেলিস্ট
   (KB-আকার) আমাদের দিয়ে যায়, ভেতরের সব ভ্যারিয়েন্ট/অডিও/সাবটাইটেল অ্যাবসোলিউট
   করা হয়; **সেগমেন্ট সরাসরি CDN থেকে ইউজারের ডিভাইসে** (ব্যান্ডউইথ ~০)।
   ═══════════════════════════════════════════════════════════════════════════════ */

const VL_BASE = process.env.VL_BASE || 'https://vidly.pro';
const VL_TR = 'vY7#qL2!mZ9@wK4$';   // বান্ডলের ti() পাসফ্রেজ — বদলালে ভাঙবে (তখন সৎ-শূন্য)
const VL_UA = process.env.VL_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const VL_PAGE_TTL = 30 * 60 * 1000;   // sealed → streams (পেজ-স্তর, ৩০মিন)
const VL_MAST_TTL = 5 * 60 * 1000;    // master-প্লেলিস্ট প্রোব (ভ্যারিয়েন্ট+অডিও-ট্র্যাক)
const VL_MEMO = new Map();            // 'movie|tv:<tmdb>:<s>:<e>' → {ts,streams,servers,provider}
const VL_MAST = new Map();            // master-url → {ts,res[],tracks[],subs}
const VL_FAIL = new Map();            // কী → ts (কুলডাউন: ব্যর্থ টাইটেল বারবার না ঠুকি)
const VL_INFLIGHT = new Map();        // কী → Promise (ডিডুপ্লিকেট-ফ্লাইট)
const VLG = { pages: 0, pageFail: 0, noSeal: 0, zero: 0, cards: 0, serve: 0, serveFail: 0 };
/* ★ সার্কিট-ব্রেকার (মাপা: টানা হিটে vidly.pro TLS-লেভেলে রিসেট দিতে শুরু করে — ECONNRESET)।
   টানা ৫টি পেজ-ব্যর্থ ⇒ ৩ মিনিট সোর্স বন্ধ (সোর্স = সৎ-শূন্য, অন্য সোর্স অক্ষত; লেটেন্সিও বাঁচে)। */
const VL_BREAK = { fails: 0, until: 0 };
function vlTripped() { return VL_BREAK.until > Date.now(); }
function vlMark(fail) {
  if (fail) { VL_BREAK.fails++; if (VL_BREAK.fails >= 5) { VL_BREAK.until = Date.now() + 3 * 60 * 1000; VL_BREAK.fails = 0; } }
  else VL_BREAK.fails = 0;
}

function vlOn(cfg) { return process.env.VLOFF !== '1' && !(cfg && cfg.vl === 0); }
function _shrink(m, frac) { for (const k of [...m.keys()].slice(0, Math.ceil(m.size * frac))) m.delete(k); }

/* ── ti()-পোর্ট: sealed → JSON ────────────────────────────────────────────────
   ধাঁচ: "v1." + base64url( 12-byte seed + XOR-বডি )
   কী-শিড: ৪টি dword; K[s] = FNV-1a(passphrase) → FNV-1a(seed), init (0x811c9dc5 ^ 0x9e3779b9*s)
   স্ট্রিম: প্রতি ৪ বাইটে একবার রিফ্রেশ (3&t)==0; বাইট = r >>> ((t&3)*8)
   যাচাই: movie 1010581 → img.rousav.tech/media/80714381491f3ba138d7/index.m3u8 (মাপা) */
function vlSealOpen(payload) {
  const s0 = String(payload || '');
  if (s0.slice(0, 3) !== 'v1.') throw new Error('seal-version');
  const b = Buffer.from(s0.slice(3).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (b.length < 20) throw new Error('seal-short');
  const seed = Array.from(b.subarray(0, 12));
  const data = Buffer.from(b.subarray(12));
  const K = [];
  for (let k = 0; k < 4; k++) {
    let n = (0x811c9dc5 ^ (0x9e3779b9 * k)) >>> 0;
    for (let i = 0; i < VL_TR.length; i++) n = Math.imul(n ^ VL_TR.charCodeAt(i), 0x1000193) >>> 0;
    for (let i = 0; i < seed.length; i++) n = Math.imul(n ^ seed[i], 0x1000193) >>> 0;
    K.push(n);
  }
  let s = K[0], n2 = K[1], l = K[2], a = K[3], r = 0;
  for (let t = 0; t < data.length; t++) {
    if ((3 & t) === 0) {
      l >>>= 0; a >>>= 0;
      let e = ((s >>>= 0) + (n2 >>>= 0)) | 0;
      s = n2 ^ (n2 >>> 9);
      n2 = (l + (l << 3)) | 0;
      l = (l << 21) | (l >>> 11);
      a = (a + 1) | 0;
      e = (e + a) | 0;
      l = (l + e) | 0;
      r = e >>> 0;
    }
    data[t] ^= (r >>> ((3 & t) * 8)) & 255;
  }
  return JSON.parse(data.toString('utf8'));
}

/* ── পেজ-ফেচ (ডেস্কটপ UA + html) ─────────────────────────────────────────── */
async function vlPageFetch(path, ms) {
  const u = VL_BASE + path;
  const hdr = { 'User-Agent': VL_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { headers: hdr, redirect: 'follow', signal: AbortSignal.timeout(Math.max(4000, ms || 9000)) });
      const t = await r.text();
      VLG.pages++;
      if (r.ok && t.indexOf('v1.') >= 0) { vlMark(false); return t; }
      if (r.status === 429 || r.status === 403) { await new Promise(z => setTimeout(z, 900)); continue; }   // CF-ব্লিপ: একবার
      return t;
    } catch (e) { if (!i) await new Promise(z => setTimeout(z, 800)); }
  }
  VLG.pageFail++; vlMark(true);
  return '';
}
async function vlPageSealed(path, ms) {
  const html = await vlPageFetch(path, ms);
  if (!html) return null;
  const m = /\\?"sealed\\?":\\?"(v1\.[A-Za-z0-9_\-]+)\\?"/.exec(html);
  if (!m) { VLG.noSeal++; return null; }
  try { return vlSealOpen(m[1]); } catch (e) { VLG.noSeal++; return null; }
}

/* ── master-প্লেলিস্ট প্রোব: ভ্যারিয়েন্ট-রেজো + অডিও-ট্র্যাকের নাম ─────────── */
function vlAbs(u, base) { try { return new URL(u, base).toString(); } catch (e) { return u; } }
async function vlMaster(u, ms) {
  const hit = VL_MAST.get(u);
  // ★ ব্যর্থ-প্রোব মাত্র ২০সে ক্যাশ — নইলে CDN-এর এক-বারের ব্লিপে ৫ মিনিট ধরে
  //   ভ্যারিয়েন্ট/অডিও-তথ্য হারিয়ে কার্ড কমে যেত (মাপা: Squid Game ২→১ কার্ড)।
  if (hit && Date.now() - hit.ts < (hit.ok ? VL_MAST_TTL : 20000)) return hit;
  let body = '';
  for (let a = 0; a < 2 && !body; a++) {       // CDN-ব্লিপে একবার পুনঃচেষ্টা
    try {
      const r = await fetch(u, { headers: { 'User-Agent': VL_UA, 'Accept': '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(Math.max(3500, ms || 7000)) });
      if (r.ok) body = await r.text();
    } catch (e) { }
    if (!body && !a) await new Promise(z => setTimeout(z, 350));
  }
  const out = { ts: Date.now(), res: [], tracks: [], subs: 0, ok: false };
  if (body.indexOf('#EXTM3U') < 0) { VL_MAST.set(u, out); return out; }
  out.ok = true;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    if (!L) continue;
    if (/^#EXT-X-STREAM-INF/i.test(L)) {
      const rm = /RESOLUTION=\d+x(\d{3,4})/i.exec(L);
      const nxt = (lines[i + 1] || '').trim();
      if (nxt && nxt[0] !== '#') out.res.push({ h: rm ? Number(rm[1]) : 0, uri: vlAbs(nxt, u) });
      continue;
    }
    if (/^#EXT-X-MEDIA:TYPE=AUDIO/i.test(L)) {
      const lang = ((/LANGUAGE="([^"]*)"/i.exec(L) || [])[1] || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
      const name = ((/NAME="([^"]*)"/i.exec(L) || [])[1] || '').replace(/^\d+\.\s*/, '').trim();
      const uri = ((/URI="([^"]*)"/i.exec(L) || [])[1] || '');
      const def = /DEFAULT=YES/i.test(L);
      if (uri) out.tracks.push({ lang: lang, name: name, uri: vlAbs(uri, u), def: def });
      continue;
    }
    if (/^#EXT-X-MEDIA:TYPE=SUBTITLES/i.test(L)) out.subs++;
  }
  out.res = out.res.filter(x => x && x.uri).sort((a, b) => (b.h || 0) - (a.h || 0));
  if (VL_MAST.size > 400) _shrink(VL_MAST, 0.4);
  VL_MAST.set(u, out);
  return out;
}

/* ── ভাষা-নাম (কার্ডে আসল ভাষা দেখানো হয়, বানানো নয়) ──────────────────────── */
const VL_LANGS = {
  hin: 'Hindi', eng: 'English', ind: 'Indonesian', msa: 'Malay', tha: 'Thai', tam: 'Tamil', tel: 'Telugu',
  kor: 'Korean', jpn: 'Japanese', ara: 'Arabic', ces: 'Czech', deu: 'German', spa: 'Spanish', fil: 'Filipino',
  fra: 'French', hun: 'Hungarian', ita: 'Italian', pol: 'Polish', por: 'Portuguese', ron: 'Romanian',
  rus: 'Russian', tur: 'Turkish', ukr: 'Ukrainian', vie: 'Vietnamese', zho: 'Chinese', chi: 'Chinese',
  ben: 'Bengali', ban: 'Bengali', mal: 'Malayalam', kan: 'Kannada', mar: 'Marathi', urd: 'Urdu',
  nld: 'Dutch', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', ell: 'Greek', gre: 'Greek',
  heb: 'Hebrew', cat: 'Catalan', slk: 'Slovak', slv: 'Slovenian', hrv: 'Croatian', srp: 'Serbian', bul: 'Bulgarian'
};
function vlLangName(code, name) {
  const c = String(code || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
  return VL_LANGS[c] || String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim() || c.toUpperCase() || '';
}
function vlLangKey(x) { return String(x || '').toLowerCase().replace(/[^a-z]/g, ''); }

/* ── মূল এন্ট্রি: কার্ড ─────────────────────────────────────────────────────── */
async function vlStreams(tmdbId, type, s, e, origin, opt) {
  const o = opt || {};
  const id = Number(tmdbId) || 0;
  if (!id) return [];
  const tv = (type === 'series' || type === 'tv' || type === 'tvshow');
  const S = tv ? (Number(s) || 1) : 0, E = tv ? (Number(e) || 1) : 0;
  const key = (tv ? 'tv' : 'movie') + ':' + id + (tv ? ':' + S + ':' + E : '');
  const now = Date.now();
  if (vlTripped()) return [];                       // ★ ব্রেকার: টানা ব্যর্থ ⇒ নীরব-শূন্য (কোনো নেটওয়ার্ক-খরচ নেই)
  const fp = VL_FAIL.get(key);
  if (fp && now - fp < 4 * 60 * 1000) return [];   // সাম্প্রতিক-ব্যর্থ: ৪মিন কুলডাউন (সোর্স-চাপ কমানো)
  const memo = VL_MEMO.get(key);
  let j = (memo && now - memo.ts < VL_PAGE_TTL) ? memo.j : null;   // j = ডিক্রিপ্ট করা sealed-পেলোড
  if (!j) {
    if (VL_INFLIGHT.has(key)) { try { j = await VL_INFLIGHT.get(key); } catch (err) { j = null; } }
    else {
      const pr = (async () => {
        const got = await vlPageSealed('/' + (tv ? 'tv/' + id + '/' + S + '/' + E : 'movie/' + id), o.ms || 9000);
        if (got) { VL_MEMO.set(key, { ts: Date.now(), j: got }); if (VL_MEMO.size > 500) _shrink(VL_MEMO, 0.4); }
        return got;
      })();
      VL_INFLIGHT.set(key, pr);
      try { j = await pr; } catch (err) { j = null; } finally { VL_INFLIGHT.delete(key); }
    }
  }
  if (!j) { VL_FAIL.set(key, Date.now()); VLG.zero++; return []; }
  const streams = (Array.isArray(j.streams) ? j.streams : []).filter(x => x && /^https?:\/\//.test(String(x.url || ''))
    && (!x.type || /hls|m3u8/i.test(String(x.type))) && /\.m3u8(\?|$)/i.test(String(x.url)));
  if (!streams.length) { VLG.zero++; return []; }
  const prov = (j.provider && (j.provider.label || j.provider.id)) || 'Edge';
  const servers = (Array.isArray(j.servers) ? j.servers : []).map(x => x && (x.label || x.id)).filter(Boolean);

  const wantQ = Array.isArray(o.q) ? o.q.map(Number).filter(Boolean) : [];
  const wantL = Array.isArray(o.l) ? o.l.map(vlLangKey).filter(Boolean) : [];
  const audioMode = String(o.audio || '');   // '' | 'orig' | 'multi'
  const out = [];

  for (const st of streams.slice(0, 3)) {
    const master = String(st.url);
    const mi = await vlMaster(master, o.ms ? Math.min(o.ms, 7000) : 7000);
    const sq = /(\d{3,4})/.exec(String(st.quality || ''));
    const sealedQ = sq ? Number(sq[1]) : 0;
    let res = mi.res.map(x => x.h).filter(Boolean);
    if (!res.length && sealedQ) res = [sealedQ];
    let q = res.length ? Math.max.apply(null, res) : (sealedQ || 0);
    if (wantQ.length) {
      const okq = res.filter(h => wantQ.indexOf(h) >= 0);
      if (res.length && !okq.length) continue;                    // চাওয়া রেজো নেই ⇒ সৎ-শূন্য (কার্ড নয়)
      if (okq.length) q = Math.max.apply(null, okq);
    }
    if (q && q < 720) continue;                                   // ৭২০p-এর নিচে কখনো নয়
    const tracks = mi.tracks || [];
    const langOf = tr => vlLangName(tr.lang, tr.name);
    let picks = [];                                               // [{q, a, lang}]
    if (audioMode === 'orig') {
      const d = tracks.find(t => t.def) || tracks[0];
      if (d) picks.push({ q: q, a: tracks.indexOf(d) + 1, lang: langOf(d) });
    } else if (wantL.length && tracks.length) {
      tracks.forEach((t, i) => { if (wantL.indexOf(vlLangKey(t.lang)) >= 0 || wantL.indexOf(vlLangKey(vlLangName(t.lang, t.name))) >= 0) picks.push({ q: q, a: i + 1, lang: langOf(t) }); });
      if (!picks.length) continue;                                // চাওয়া ভাষা নেই ⇒ কার্ড নয়
    } else if (tracks.length >= 2) {
      if (audioMode === 'multi') picks.push({ q: q, a: 0, lang: 'Multi Audio' });
      else picks.push({ q: q, a: tracks.findIndex(t => /^en/.test(t.lang)) >= 0 ? tracks.findIndex(t => /^en/.test(t.lang)) + 1 : 0, lang: tracks.length > 1 ? 'Multi Audio' : langOf(tracks[0]) });
    } else {
      picks.push({ q: q, a: 0, lang: tracks.length ? langOf(tracks[0]) : '' });
    }
    if (!picks.length) picks.push({ q: q, a: 0, lang: '' });

    // ভিন্ন রেজোলিউশন (নিচের ল্যাডার) — আলাদা কার্ড, একই master, ভ্যারিয়েন্ট-পিন
    const alts = mi.res.filter(x => x.h && x.h !== q && (!wantQ.length || wantQ.indexOf(x.h) >= 0) && x.h >= 720).slice(0, 2);
    for (const p of picks) {
      const cards = [{ q: p.q, a: p.a, note: '' }].concat(alts.map(x => ({ q: x.h, a: p.a, note: '-r' + x.h })));
      for (const c of cards) {
        const qs = [];
        if (c.a > 0) qs.push('a=' + c.a + '.th');
        if (c.note) qs.push(c.note.slice(1));
        const url = origin + '/vlh/' + Buffer.from(master).toString('base64url') + '/p.m3u8' + (qs.length ? '?' + qs.join('&') : '');
        out.push({ q: c.q, a: p.lang, url: url, master: master, prov: prov, servers: servers, subs: mi.subs });
      }
    }
    if (out.length >= 10) break;
  }

  // ডুপ্লিকেট বাদ (একই master+res+audio একবারই)
  const seen = new Set(), finalCards = [];
  for (const c of out) {
    const k = c.master + '#' + c.q + '#' + c.a;
    if (seen.has(k)) continue;
    seen.add(k); finalCards.push(c);
  }
  if (!finalCards.length) { VLG.zero++; return []; }
  VLG.cards += finalCards.length;

  const title = String(o.title || '').trim();
  const year = String(o.year || '').trim();
  const epLine = tv ? ('\u29e0 S' + S + 'E' + E) : '\u29e0 Movie';
  const head = '\u29c9 ' + (title || (tv ? 'Series' : 'Movie')) + (year ? ' | ' + year + ' |' : '');
  return finalCards.map((c, i) => {
    const txt = head + '\n' + epLine + '\n\u229e Vidly' + (c.a ? ' \u2317 ' + c.a : '') + (c.prov ? ' \u2022 Vidly \u00b7 ' + c.prov : '');   // ⊞ Vidly ⌗ <audio> • Vidly · Edge
    return {
      name: '\u25a5 ' + (c.q || 'Auto') + ' \u25a5',
      quality: c.q ? String(c.q) : '',
      url: c.url,
      title: txt,
      description: txt + (i === 0 ? '\n\u24d8 vidly.pro \u00b7 sealed-HLS \u00b7 true multi-audio tracks' : ''),
      behaviorHints: { filename: 'vidly.m3u8', notWebReady: true, proxyHeaders: { request: { 'User-Agent': VL_UA } } },
      bingeGroup: 'vl|' + String(title || 'vidly').toLowerCase() + '::' + (c.a || 'auto')
    };
  });
}

/* ── /vlh/ রিলে: শুধু প্লেলিস্ট (সেগমেন্ট সরাসরি CDN) ────────────────────────── */
async function vlGet(u, ms) {
  const r = await fetch(u, { headers: { 'User-Agent': VL_UA, 'Accept': '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(Math.max(3000, ms || 8000)) });
  const t = (r.status >= 200 && r.status < 300) ? await r.text() : '';
  return t;
}
async function vlServe(req, res, b64, origin, query) {
  let master = '';
  try { master = Buffer.from(b64, 'base64url').toString('utf8'); } catch (e) { }
  if (!/^https?:\/\//.test(master)) { res.writeHead(400); return res.end('bad'); }
  const q = query || (req && req.url ? (req.url.split('?')[1] || '') : '');
  const wantA = Number((/(?:^|[?&])a=(\d+)\.th/.exec(q) || [])[1] || 0);      // মাপা-বাগ: '?'-টা server.js-ই কেটে দেয় ⇒ ^ দরকার
  const wantR = Number((/(?:^|[?&])r(\d{3,4})(?:&|$)/.exec(q) || [])[1] || 0);
  try {
    let body = await vlGet(master, 8000);
    if (body.indexOf('#EXTM3U') < 0) {   // একবার রিট্রাই (CDN-ব্লিপ)
      await new Promise(z => setTimeout(z, 400));
      body = await vlGet(master, 8000);
    }
    if (body.indexOf('#EXTM3U') < 0) { VLG.serveFail++; res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); return res.end('upstream'); }

    // ★ মিডিয়া-প্লেলিস্ট (অর্থাৎ #EXTINF আছে) হলে নন-কমেন্ট লাইনগুলো **সেগমেন্ট** —
    //   ওগুলো রিলে করি না, সরাসরি CDN-এ রাখি (ব্যান্ডউইথ আমাদের দিয়ে যায় না, Range/সিক অক্ষত)।
    //   ("tiles.m3u8"-এর ভেতরে `tiles/00000.jpg` আসলে MPEG-TS — rousav-এর চেনা ফাঁদ।)
    const mediaPlaylist = /^#EXTINF:/m.test(body);
    const REL = origin + '/vlh/';
    const keepAbs = u1 => { try { const a = vlAbs(u1, master); return /^https?:\/\//i.test(a) ? '"' + a + '"' : '"' + u1 + '"'; } catch (e) { return '"' + u1 + '"'; } };
    const relayOf = u1 => '"' + REL + Buffer.from(vlAbs(u1, master)).toString('base64url') + '/p.m3u8"';
    const outLines = [];
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const L = raw.trim();
      if (!L) { outLines.push(raw); continue; }
      if (L[0] === '#') {
        // মিডিয়া-প্লেলিস্টে #EXT-X-MAP/#EXT-X-KEY-এর URI = মিডিয়া-ফাইল ⇒ সরাসরি
        outLines.push(raw.replace(/URI="([^"]+)"/g, (m0, u1) => 'URI=' + (mediaPlaylist ? keepAbs(u1) : relayOf(u1))));
        continue;
      }
      const abs = vlAbs(L, master);
      if (mediaPlaylist) { outLines.push(abs); continue; }        // সেগমেন্ট: সরাসরি CDN
      outLines.push(REL + Buffer.from(abs).toString('base64url') + '/p.m3u8');   // ভ্যারিয়েন্ট/সাব: রিলে
    }
    let out = outLines.join('\n');
    if (!/\n#EXTM3U/.test('\n' + out.split('\n')[0])) out = '#EXTM3U\n' + out;

    // ভ্যারিয়েন্ট-পিন (?r1080) / একক-অডিও (?a=3.th) — মাস্টার-আকারের প্লেলিস্ট
    const isMaster = /^#EXT-X-STREAM-INF/mi.test(out);
    if (isMaster && (wantA || wantR)) {
      const keep = [];
      const vars = [];   // [{inf,uri,h,bw}]
      for (let i = 0; i < outLines.length; i++) {
        const L = outLines[i].trim();
        if (/^#EXT-X-STREAM-INF/i.test(L)) {
          const rm = /RESOLUTION=\d+x(\d{3,4})/i.exec(L);
          const bw = Number((/BANDWIDTH=(\d+)/i.exec(L) || [])[1] || 0);
          vars.push({ inf: outLines[i], uri: (outLines[i + 1] || '').trim(), h: rm ? Number(rm[1]) : 0, bw: bw });
          continue;
        }
      }
      // ★ শুধু-অডিও-পিন (r ছাড়া) হলে সবচেয়ে উঁচু ভ্যারিয়েন্টটাই রাখি — নইলে কোনো ভ্যারিয়েন্টই থাকত না।
      let pick = vars;
      if (wantR) pick = vars.filter(v => v.h === wantR);
      else if (vars.length > 1) pick = [vars.slice().sort((a, b) => (b.h - a.h) || (b.bw - a.bw))[0]];
      for (const v of pick) { keep.push(v.inf); if (v.uri) keep.push(v.uri); }
      if (keep.length) {
        const audioAll = outLines.filter(l => /^#EXT-X-MEDIA:TYPE=AUDIO/i.test(l));
        const audioTag = wantA ? (audioAll[wantA - 1] || '') : '';
        const aGrp = ((/GROUP-ID="([^"]+)"/i.exec(audioTag) || [])[1] || '');
        // বাছা-করা ভ্যারিয়েন্টের SUBTITLES গ্রুপ — সাবটাইটেল-ট্যাগ ওই গ্রুপেরই রাখি
        const sGrp = ((keep.join('\n').match(/SUBTITLES="([^"]+)"/i) || [])[1] || '');
        const head = ['#EXTM3U'];
        if (wantA) { if (audioTag) head.push(audioTag); }
        else outLines.forEach(l => { if (/^#EXT-X-MEDIA:TYPE=AUDIO/i.test(l)) head.push(l); });   // পিন-না-হলে সব অডিও-ট্র্যাকই থাকুক
        if (sGrp) outLines.forEach(l => {
          if (!/^#EXT-X-MEDIA:TYPE=SUBTITLES/i.test(l)) return;
          if (((/GROUP-ID="([^"]+)"/i.exec(l) || [])[1] || '') === sGrp) head.push(l);              // সাবটাইটেল অটুট (URI আগেই রিলে-করা)
        });
        if (wantA && !aGrp) for (let i = 0; i < keep.length; i++) if (/^#EXT-X-STREAM-INF/i.test(keep[i])) keep[i] = keep[i].replace(/,?AUDIO="[^"]*"/i, '');
        out = head.concat(keep).join('\n');
      }
    }
    if (out[out.length - 1] !== '\n') out += '\n';
    VLG.serve++;
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' });
    return res.end(out);
  } catch (e) {
    VLG.serveFail++;
    try { res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); return res.end('relay-err'); } catch (e2) { return; }
  }
}

/* ── ডায়াগনস্টিকস + সেলফ-টেস্ট ─────────────────────────────────────────────── */
function vlDiag() {
  return {
    memo: VL_MEMO.size, master: VL_MAST.size, fail: VL_FAIL.size,
    pages: VLG.pages, pageFail: VLG.pageFail, noSeal: VLG.noSeal, zero: VLG.zero, cards: VLG.cards,
    serve: VLG.serve, serveFail: VLG.serveFail, base: VL_BASE,
    breaks: VL_BREAK.fails, breakFor: VL_BREAK.until > Date.now() ? Math.round((VL_BREAK.until - Date.now()) / 1000) : 0
  };
}
async function vlSelftest() {
  const r = {};
  try {
    const j = await vlPageSealed('/movie/1010581', 9000);
    r.seal = !!(j && j.streams && j.streams.length);
    r.provider = j && j.provider && j.provider.label;
    r.servers = j && Array.isArray(j.servers) ? j.servers.map(x => x.label) : [];
    r.url = j && j.streams && j.streams[0] && j.streams[0].url;
    if (r.url) { const mi = await vlMaster(r.url, 7000); r.res = mi.res.map(x => x.h); r.tracks = mi.tracks.length; r.subs = mi.subs; r.masterOk = mi.ok; }
  } catch (e) { r.err = String(e && e.message); }
  return r;
}

module.exports = { vlOn, vlStreams, vlServe, vlSealOpen, vlMaster, vlDiag, vlSelftest, VL_LANGS, VL_BASE, VL_UA };
