'use strict';
/* ═══════════════════════════════════════════════════════════════════════════════
   vidly.pro — স্বতন্ত্র স্ট্রিম-সোর্স  ·  v1.34.304 (দ্বিতীয় সংস্কার)
   ───────────────────────────────────────────────────────────────────────────────
   কেন আবার লিখলাম (ইউজার: "Hoi nai build balo Kore, multi audio ko etoh single
   audio … actual website dekho, oi jaigai pray sob content e pawa jai"):
     (.303)-এ আমি sealed-পেলোডের regex-টা ভুল লিখেছিলাম — পেজে পেলোড আসে
       "sealed":"$17"  রেফারেন্সে, আর আসল ডেটা আলাদা RSC-লাইনে `17:Tfd3d,v1.…`
     ⇒ Queen of Tears-এর মতো টাইটেল "সোর্স নেই" দেখাত, অথচ সাইটে পুরো স্ট্রিম আছে।
   এখন RSC-ফ্ল্যাটেন + $N-রেফারেন্স + lenient-JSON — সাইটে যা আছে, সবই আসে।

   আসল সাইটের গঠন (এই মুহূর্তে মাপা, Queen of Tears S1E1):
     provider: Prism (MULTI)      failed: Edge — "Edge has no stream for this title."
     streams : 1080p-English · 1080p-Original · 1080p-Hindi · 480p-Indonesian-sub
               প্রতিটির সাথে ১৬টি সাবটাইটেল (বাংলা/हिन्दी/اُردُو …)
     CDN     : sacdn.hakunaymatata.com (dash) → 920 সেগমেন্ট, 206 Range, হিন্দি অডিও ৯২০ সেগমেন্ট
   অর্থাৎ সাইটের "single audio" স্ট্রিমগুলো আসলে **ভাষা-পিন করা সম্পূর্ণ স্ট্রিম**;
   অডিও-ট্র্যাক-পিন (a=…) কিছুই ছিল না — তাই (.303)-এ "Multi Audio" লেখা ভুয়া ছিল।
   এখন: যেসব স্ট্রিম সত্যিই একাধিক সাউন্ড-ট্র্যাক দেয় সেটাই "Multi Audio" পায়,
   বাকিরা নিজের ভাষার নাম পায় (Hindi/English/Original …), আর প্রতিটি স্ট্রিম-এন্ট্রি
   = একটি কার্ড (একই ফাইল দুইবার নয়)।

   রিলে (/vlh/): শুধু প্লেলিস্ট (KB) আমাদের দিয়ে; মিডিয়া সেগমেন্ট/init সরাসরি CDN।
   ═══════════════════════════════════════════════════════════════════════════════ */

const VL_BASE = process.env.VL_BASE || 'https://vidly.pro';
const VL_TR = 'vY7#qL2!mZ9@wK4$';      // বান্ডলের ti() পাসফ্রেজ
const VL_UA = process.env.VL_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const VL_PAGE_TTL = 20 * 60 * 1000;    // sealed → streams
const VL_MAST_TTL = 5 * 60 * 1000;     // master-প্রোব (ভ্যারিয়েন্ট/ট্র্যাক), ব্যর্থ হলে ২০সে
const VL_MEMO = new Map(), VL_MAST = new Map(), VL_FAIL = new Map(), VL_INFLIGHT = new Map();
const VLG = { pages: 0, pageFail: 0, noSeal: 0, zero: 0, cards: 0, serve: 0, serveFail: 0 };
const VL_BREAK = { fails: 0, until: 0 };
const VL_SRV = { evion: 'Edge', singularity: 'Edge', prism: 'Prism', flux: 'Flux', nimbus: 'Nimbus', comet: 'Comet', citadel: 'Citadel' };

function vlOn(cfg) { return process.env.VLOFF !== '1' && !(cfg && cfg.vl === 0); }
function _shrink(m, frac) { for (const k of [...m.keys()].slice(0, Math.ceil(m.size * frac))) m.delete(k); }
function vlTripped() { return VL_BREAK.until > Date.now(); }
function vlMark(fail) {
  if (fail) { VL_BREAK.fails++; if (VL_BREAK.fails >= 5) { VL_BREAK.until = Date.now() + 3 * 60 * 1000; VL_BREAK.fails = 0; } }
  else VL_BREAK.fails = 0;
}

/* ── ti()-পোর্ট: sealed → JSON (JSON-এর পরে আবর্জনা থাকলে প্রথম অবজেক্টটাই নিই) ── */
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
  const txt = data.toString('utf8');
  try { return JSON.parse(txt); } catch (e) {
    const i = txt.indexOf('{');
    if (i < 0) throw e;
    let d = 0, inStr = false, esc = false;
    for (let j = i; j < txt.length; j++) {
      const ch = txt[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') d++;
      else if (ch === '}') { d--; if (!d) return JSON.parse(txt.slice(i, j + 1)); }
    }
    throw new Error('json-truncated');
  }
}

/* ── পেজ → sealed পেলোড ($N-রেফারেন্স সহ) ─────────────────────────────────── */
function vlSealedFrom(html) {
  const h = String(html || '');
  const pushes = [...h.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")/g)]
    .map(m => { try { return JSON.parse(m[1]); } catch (e) { return ''; } }).join('');
  const flat = (pushes || h).replace(/\\"/g, '"');
  const ref = /"sealed":\s*"\$(\d+)"/.exec(flat);
  if (ref) {
    const row = new RegExp('(?:^|[\\n,"])\\s*' + ref[1] + ':T[0-9a-f]+,(v1\\.[A-Za-z0-9_\\-]+)').exec(flat);
    if (row) return row[1];
  }
  const dir = /"sealed":\s*"(v1\.[A-Za-z0-9_\-]+)"/.exec(flat);
  if (dir) return dir[1];
  const any = /(?:^|[^A-Za-z0-9_\-/])(v1\.[A-Za-z0-9_\-]{60,})/.exec(flat);
  return any ? any[1] : '';
}

/* ── পেজ-ফেচ (TLS-রিসেটে শান্ত পুনঃচেষ্টা + এক-বার রিট্রাই) ───────────────── */
async function vlPageFetch(path, ms) {
  const u = VL_BASE + path;
  const hdr = { 'User-Agent': VL_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' };
  // v1.34.304: parallel-চাপে vidly.pro মাঝে মাঝে TLS-লেভেলে রিসেট করে ⇒ ৩ চেষ্টা, ছোট ব্যাকঅফ।
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: hdr, redirect: 'follow', signal: AbortSignal.timeout(Math.max(5000, ms || 9000)) });
      const t = await r.text();
      VLG.pages++;
      if (r.ok && t.indexOf('v1.') >= 0) { vlMark(false); return t; }
      if (r.status === 429 || r.status === 403 || r.status >= 500) { await new Promise(z => setTimeout(z, 350 + i * 700)); continue; }
      return t;
    } catch (e) { await new Promise(z => setTimeout(z, 350 + i * 700)); }
  }
  VLG.pageFail++; vlMark(true);
  return '';
}
async function vlPageSealed(path, ms) {
  const html = await vlPageFetch(path, ms);
  if (!html) return null;
  const s = vlSealedFrom(html);
  if (!s) { VLG.noSeal++; return null; }
  try { return vlSealOpen(s); } catch (e) { VLG.noSeal++; return null; }
}

/* ── মাস্টার-প্রোব: ভ্যারিয়েন্ট-রেজো, অডিও-ট্র্যাক, সাবটাইটেল ──────────────── */
function vlAbs(u, base) { try { return new URL(u, base).toString(); } catch (e) { return u; } }
async function vlMaster(u, ms) {
  const hit = VL_MAST.get(u);
  if (hit && Date.now() - hit.ts < (hit.ok ? VL_MAST_TTL : 20000)) return hit;
  let body = '';
  for (let a = 0; a < 2 && !body; a++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': VL_UA, 'Accept': '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(Math.max(3500, ms || 7000)) });
      if (r.ok) body = await r.text();
    } catch (e) { }
    if (!body && !a) await new Promise(z => setTimeout(z, 350));
  }
  const out = { ts: Date.now(), res: [], tracks: [], subs: 0, ok: false };
  if (body.indexOf('#EXTM3U') < 0) { VL_MAST.set(u, out); return out; }
  out.ok = true;
  const L = body.split('\n');
  for (let i = 0; i < L.length; i++) {
    const ln = L[i].trim();
    if (!ln) continue;
    if (/^#EXT-X-STREAM-INF/i.test(ln)) {
      const rm = /RESOLUTION=\d+x(\d{3,4})/i.exec(ln);
      const bw = Number((/BANDWIDTH=(\d+)/i.exec(ln) || [])[1] || 0);
      const nxt = (L[i + 1] || '').trim();
      if (nxt && nxt[0] !== '#') out.tracks.length >= 0 && out.res.push({ h: rm ? Number(rm[1]) : 0, bw: bw, uri: vlAbs(nxt, u) });
      continue;
    }
    if (/^#EXT-X-MEDIA:TYPE=AUDIO/i.test(ln)) {
      const uri = ((/URI="([^"]*)"/i.exec(ln)) || [])[1] || '';
      const name = ((/NAME="([^"]*)"/i.exec(ln)) || [])[1] || '';
      const lang = ((/LANGUAGE="([^"]*)"/i.exec(ln)) || [])[1] || '';
      if (uri) out.tracks.push({ name: name, lang: lang, uri: vlAbs(uri, u), def: /DEFAULT=YES/i.test(ln) });
      continue;
    }
    if (/^#EXT-X-MEDIA:TYPE=SUBTITLES/i.test(ln)) out.subs++;
  }
  out.res = out.res.filter(x => x && x.uri).sort((a, b) => (b.h - a.h) || (b.bw - a.bw));
  if (VL_MAST.size > 400) _shrink(VL_MAST, 0.4);
  VL_MAST.set(u, out);
  return out;
}

/* ── ভাষার নাম ─────────────────────────────────────────────────────────────── */
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
  if (VL_LANGS[c]) return VL_LANGS[c];
  let n = String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  // v1.34.304: জেনেরিক নাম ("Audio", "Main", "Default") ভাষা নয় ⇒ স্ট্রিমের নিজের ভাষায় ফিরি
  if (/^(audio|main|default|track|und|unknown|original audio)$/i.test(n)) n = '';
  if (!n) return '';
  const k = n.toLowerCase().replace(/[^a-z]/g, '');
  if (VL_LANGS[k.slice(0, 3)]) return VL_LANGS[k.slice(0, 3)];
  return n.length <= 24 ? n : '';
}
const vlKey = x => String(x || '').toLowerCase().replace(/[^a-z]/g, '');

/* ── মূল এন্ট্রি: কার্ড ─────────────────────────────────────────────────────── */
async function vlStreams(tmdbId, type, s, e, origin, opt) {
  const o = opt || {};
  const id = Number(tmdbId) || 0;
  if (!id) return [];
  const tv = (type === 'series' || type === 'tv' || type === 'tvshow');
  const S = tv ? (Number(s) || 1) : 0, E = tv ? (Number(e) || 1) : 0;
  const key = (tv ? 'tv' : 'movie') + ':' + id + (tv ? ':' + S + ':' + E : '');
  const now = Date.now();
  if (vlTripped()) return [];
  const fp = VL_FAIL.get(key);
  if (fp && now - fp < 90 * 1000) return [];   // v1.34.304: ব্যর্থ-মেমো ৪মিন → ৯০সে (একবারের রিসেটে টাইটেল হারাক না)
  const memo = VL_MEMO.get(key);
  let j = (memo && now - memo.ts < VL_PAGE_TTL) ? memo.j : null;
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

  const raw = (Array.isArray(j.streams) ? j.streams : []).filter(x => x && /^https?:\/\//.test(String(x.url || ''))
    && (!x.type || /hls|m3u8|dash/i.test(String(x.type))));
  if (!raw.length) { VLG.zero++; return []; }

  const prov = (j.provider && (j.provider.label || j.provider.id)) || '';
  const provTag = (j.provider && j.provider.tag) || '';
  const failed = (Array.isArray(j.failed) ? j.failed : []).map(f => (f && (f.label || f.id)) || '').filter(Boolean);
  const wantQ = Array.isArray(o.q) ? o.q.map(Number).filter(Boolean) : [];
  const wantL = Array.isArray(o.l) ? o.l.map(vlKey).filter(Boolean) : [];
  const audioMode = String(o.audio || '');   // '' | 'orig' | 'multi'

  const out = [];
  for (const st of raw.slice(0, 8)) {
    const master = String(st.url);
    const mi = await vlMaster(master, o.ms ? Math.min(o.ms, 7000) : 7000);
    const sq = /(\d{3,4})/.exec(String(st.quality || ''));
    const sealedQ = sq ? Number(sq[1]) : 0;
    let res = mi.res.map(x => x.h).filter(Boolean);
    if (!res.length && sealedQ) res = [sealedQ];
    let q = res.length ? Math.max.apply(null, res) : (sealedQ || 0);
    if (wantQ.length) {
      const okq = res.filter(h => wantQ.indexOf(h) >= 0);
      if (res.length && !okq.length) continue;
      if (okq.length) q = Math.max.apply(null, okq);
    }
    if (q && q < 720) continue;                                  // ৭২০p-এর নিচে নয়

    const tracks = mi.tracks || [];
    // অডিও-লেবেল: সত্যিই একাধিক ট্র্যাক থাকলে Multi Audio, নইলে স্ট্রিমের নিজের ভাষা
    let audio = '';
    if (tracks.length >= 3) audio = 'Multi Audio';
    else if (tracks.length === 2) audio = 'Dual Audio';
    else if (tracks.length === 1) audio = vlLangName(tracks[0].lang, tracks[0].name) || String(st.language || '').trim();
    else audio = String(st.language || '').trim();
    // ভাষা-ছাঁকনি (Vidly-র নিজের): স্ট্রিম-ভাষা বা ট্র্যাকের ভাষা মিলতে হবে
    if (wantL.length) {
      const hay = (String(st.language || '') + ' ' + vlLangName('', st.language) + ' ' + tracks.map(t => vlLangName(t.lang, t.name)).join(' ')).toLowerCase();
      if (!wantL.some(w => hay.indexOf(w) >= 0)) continue;
    }
    if (audioMode === 'multi' && tracks.length < 2) { /* multi চাইলে একক-ট্র্যাক বাদ */ continue; }
    if (audioMode === 'orig') audio = audio || 'Original';

    const pickTrack = (/(^|\s)(original|native)\b/i.test(String(st.language || '')) ? 0 : 0);
    const qs = [];
    if (pickTrack > 0) qs.push('a=' + (pickTrack + 1) + '.th');
    const url = origin + '/vlh/' + Buffer.from(master).toString('base64url') + '/p.m3u8' + (qs.length ? '?' + qs.join('&') : '');
    const subs = (Array.isArray(st.subtitles) ? st.subtitles : [])
      .map(x => {
        let lb = String((x && (x.label || x.lang)) || '').trim();
        const mm2 = /^eps?isode\s*\d+[.\-_ ]+(.+)$/i.exec(lb);        // "episode 1.english" ⇒ English
        if (mm2) lb = mm2[1];
        lb = lb.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
        lb = lb.charAt(0).toUpperCase() + lb.slice(1);
        return { url: String((x && (x.url || x.file || x.src)) || ''), label: lb };
      })
      .filter(x => /^https?:\/\//.test(x.url) && x.label);
    const seenSub = new Set();
    const subList = [];
    for (const x of subs) { const k = x.label.toLowerCase(); if (seenSub.has(k)) continue; seenSub.add(k); subList.push(x); }
    out.push({ master, q, audio, subs: subList.length || mi.subs, tracks: tracks.length, url, prov, provTag, subList, srv: VL_SRV[String((j.provider && j.provider.id) || '')] || prov });
  }

  // ডুপ্লিকেট (একই master) — একবারই
  const seen = new Set(), cards = [];
  for (const c of out) {
    const k = c.master + '#' + c.q;
    if (seen.has(k)) continue;
    seen.add(k); cards.push(c);
  }
  if (!cards.length) { VLG.zero++; return []; }
  VLG.cards += cards.length;

  const title = String(o.title || '').trim();
  const year = String(o.year || '').trim();
  const epLine = tv ? ('\u29e0 S' + S + 'E' + E) : '\u29e0 Movie';
  const head = '\u29c9 ' + (title || (tv ? 'Series' : 'Movie')) + (year ? ' | ' + year + ' |' : '');
  return cards.map((c, i) => {
    const txt = head + '\n' + epLine + '\n\u229e Vidly' + (c.audio ? ' \u2317 ' + c.audio : '') + (c.srv ? ' \u2022 Vidly \u00b7 ' + c.srv : '');
    return {
      name: '\u25a5 ' + (c.q || 'Auto') + ' \u25a5',
      quality: c.q ? String(c.q) : '',
      url: c.url,
      title: txt,
      description: txt + (i === 0 ? ('\n\u24d8 vidly.pro \u00b7 ' + (c.prov || 'Edge') + (c.tracks ? ' \u00b7 ' + c.tracks + ' audio track' + (c.tracks > 1 ? 's' : '') : '') + (c.subs ? ' \u00b7 ' + c.subs + ' subtitles' : '') + (failed.length ? ' \u00b7 ' + failed.join('/') + ' unavailable' : '')) : ''),
      subtitles: (c.subList || []).slice(0, 24).map((x, k) => ({ id: 'vl-' + i + '-' + k, url: origin + '/vls/' + Buffer.from(x.url).toString('base64url') + '/s.vtt', lang: x.label })),
      behaviorHints: { filename: 'vidly.m3u8', notWebReady: true, proxyHeaders: { request: { 'User-Agent': VL_UA } } },
      bingeGroup: 'vl|' + String(title || 'vidly').toLowerCase() + '::' + (c.audio || 'auto')
    };
  });
}

/* ── /vlh/ রিলে: প্লেলিস্ট আমাদের দিয়ে, মিডিয়া সরাসরি CDN ──────────────────── */
const VL_C = new Map();   // master(+পিন) → {ts, body}
async function vlGet(u, ms) {
  const r = await fetch(u, { headers: { 'User-Agent': VL_UA, 'Accept': '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(Math.max(3000, ms || 8000)) });
  return (r.status >= 200 && r.status < 300) ? r.text() : '';
}
async function vlServe(req, res, b64, origin, query) {
  let master = '';
  try { master = Buffer.from(b64, 'base64url').toString('utf8'); } catch (e) { }
  if (!/^https?:\/\//.test(master)) { res.writeHead(400); return res.end('bad'); }
  const q = query || '';
  const wantA = Number((/(?:^|[?&])a=(\d+)\.th/.exec(q) || [])[1] || 0);
  const wantR = Number((/(?:^|[?&])r(\d{3,4})(?:&|$)/.exec(q) || [])[1] || 0);
  const ck = master + '|' + wantA + '|' + wantR;
  const hit = VL_C.get(ck);
  if (hit && Date.now() - hit.ts < 4 * 60 * 1000) { VLG.serve++; res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); return res.end(hit.body); }
  try {
    let body = await vlGet(master, 8000);
    if (body.indexOf('#EXTM3U') < 0) { await new Promise(z => setTimeout(z, 400)); body = await vlGet(master, 8000); }
    if (body.indexOf('#EXTM3U') < 0) { VLG.serveFail++; res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); return res.end('upstream'); }

    // মিডিয়া-প্লেলিস্ট হলে নন-কমেন্ট লাইন = সেগমেন্ট ⇒ সরাসরি CDN (রিলে নয়)
    const media = /^#EXTINF:|^#EXT-X-TARGETDURATION/m.test(body);
    const REL = origin + '/vlh/';
    const lines = body.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i], L = raw.trim();
      if (!L) { out.push(raw); continue; }
      if (L[0] === '#') {
        out.push(raw.replace(/URI="([^"]+)"/g, (m0, u1) => {
          const abs = vlAbs(u1, master);
          if (media) return 'URI="' + abs + '"';                       // #EXT-X-MAP / #EXT-X-KEY ⇒ সরাসরি
          return 'URI="' + REL + Buffer.from(abs).toString('base64url') + '/p.m3u8"';
        }));
        continue;
      }
      const abs = vlAbs(L, master);
      out.push(media ? abs : (REL + Buffer.from(abs).toString('base64url') + '/p.m3u8'));
    }
    let body2 = out.join('\n');
    if (body2.split('\n')[0].trim() !== '#EXTM3U') body2 = '#EXTM3U\n' + body2;

    // ভ্যারিয়েন্ট-পিন (?r1080) — মাস্টার হলে শুধু ওই ভ্যারিয়েন্ট
    if (!media && wantR) {
      const vars = [];
      for (let i = 0; i < out.length; i++) {
        const L = out[i].trim();
        if (!/^#EXT-X-STREAM-INF/i.test(L)) continue;
        const rm = /RESOLUTION=\d+x(\d{3,4})/i.exec(L);
        vars.push({ inf: out[i], uri: (out[i + 1] || '').trim(), h: rm ? Number(rm[1]) : 0 });
      }
      const pick = vars.filter(v => v.h === wantR);
      if (pick.length) {
        const sGrp = ((pick[0].inf.match(/SUBTITLES="([^"]+)"/i) || [])[1] || '');
        const head = ['#EXTM3U'];
        out.forEach(l => {
          if (/^#EXT-X-MEDIA:TYPE=AUDIO/i.test(l)) head.push(l);
          else if (/^#EXT-X-MEDIA:TYPE=SUBTITLES/i.test(l) && sGrp && ((l.match(/GROUP-ID="([^"]+)"/i) || [])[1] || '') === sGrp) head.push(l);
        });
        const keep = [];
        for (const v of pick) { keep.push(v.inf); if (v.uri) keep.push(v.uri); }
        body2 = head.concat(keep).join('\n');
      }
    }
    // অডিও-পিন (?a=N.th) — মাস্টার হলে ট্র্যাক-তালিকা থেকে একটি
    if (!media && wantA) {
      const L2 = body2.split('\n');
      const auds = L2.map((l, i) => ({ l, i })).filter(x => /^#EXT-X-MEDIA:TYPE=AUDIO/i.test(x.l));
      const keep = auds[wantA - 1];
      body2 = L2.filter((l, i) => !/^#EXT-X-MEDIA:TYPE=AUDIO/i.test(l) || (keep && i === keep.i)).join('\n');
    }
    if (body2[body2.length - 1] !== '\n') body2 += '\n';
    if (VL_C.size > 600) _shrink(VL_C, 0.4);
    VL_C.set(ck, { ts: Date.now(), body: body2 });
    VLG.serve++;
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' });
    return res.end(body2);
  } catch (e) {
    VLG.serveFail++;
    try { res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); return res.end('relay-err'); } catch (e2) { return; }
  }
}

/* ── /vls/ সাবটাইটেল রিলে: SRT/ASS → WebVTT ─────────────────────────────────── */
function vlSrtToVtt(txt) {
  let t = String(txt || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^\[Script Info\]|^\[V4\+ Styles\]/im.test(t)) {                     // ASS/SSA
    const out = [];
    const f = v => {
      const m = /(\d+):(\d+):(\d+)[.:](\d+)/.exec(String(v || '').trim());
      if (!m) return '';
      return m[1].padStart(2, '0') + ':' + m[2].padStart(2, '0') + ':' + m[3].padStart(2, '0') + '.' + m[4].padEnd(3, '0').slice(0, 3);
    };
    for (const l of t.split('\n')) {
      if (!/^Dialogue:/i.test(l)) continue;
      const p = l.replace(/^Dialogue:\s*/i, '').split(',');
      const t1 = f(p[1]), t2 = f(p[2]);
      if (!t1 || !t2) continue;
      const body = String(p.slice(9).join(',')).replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
      if (body) out.push(t1 + ' --> ' + t2 + '\n' + body + '\n');
    }
    t = out.join('\n');
  }
  t = t.replace(/\{\\an?\d\}/g, '');
  if (!/^WEBVTT/.test(t)) t = 'WEBVTT\n\n' + t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return t.replace(/\n{3,}/g, '\n\n');
}
async function vlSub(res, b64) {
  let u = '';
  try { u = Buffer.from(String(b64 || ''), 'base64url').toString('utf8'); } catch (e) { }
  if (!/^https?:\/\//.test(u)) { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('bad'); }
  try {
    let body = await vlGet(u, 9000);
    if (!body) { await new Promise(z => setTimeout(z, 500)); body = await vlGet(u, 9000); }
    const vtt = vlSrtToVtt(body);
    res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=1800' });
    return res.end(vtt);
  } catch (e) {
    try { res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); return res.end('sub-err'); } catch (e2) { return; }
  }
}

/* ── ডায়াগনস্টিকস + সেলফ-টেস্ট ─────────────────────────────────────────────── */
function vlDiag() {
  return {
    memo: VL_MEMO.size, master: VL_MAST.size, fail: VL_FAIL.size, serveCache: VL_C.size,
    pages: VLG.pages, pageFail: VLG.pageFail, noSeal: VLG.noSeal, zero: VLG.zero, cards: VLG.cards,
    serve: VLG.serve, serveFail: VLG.serveFail, base: VL_BASE,
    breaks: VL_BREAK.fails, breakFor: VL_BREAK.until > Date.now() ? Math.round((VL_BREAK.until - Date.now()) / 1000) : 0
  };
}
async function vlSelftest(tmdb, s, e) {
  const r = {};
  try {
    const id = Number(tmdb) || 215720;
    const path = s ? ('/tv/' + id + '/' + (s || 1) + '/' + (e || 1)) : ('/movie/' + id);
    const html = await vlPageFetch(path, 9000);
    r.pageLen = html.length;
    const sealStr = vlSealedFrom(html);
    r.sealFound = !!sealStr; r.sealLen = sealStr.length;
    if (!sealStr) return r;
    const j = vlSealOpen(sealStr);
    r.provider = j.provider && j.provider.label; r.tag = j.provider && j.provider.tag;
    r.servers = (j.servers || []).map(x => x.label);
    r.failed = (j.failed || []).map(x => (x && x.label) + ': ' + (x && x.reason));
    r.streams = (j.streams || []).map(x => ({ q: x.quality, lang: x.language, subs: (x.subtitles || []).length, host: (() => { try { return new URL(x.url).host; } catch (e) { return ''; } })() }));
    if (j.streams && j.streams[0]) {
      const mi = await vlMaster(j.streams[0].url, 7000);
      r.first = { res: mi.res.map(x => x.h), tracks: mi.tracks.length, subs: mi.subs, ok: mi.ok };
    }
  } catch (e) { r.err = String(e && e.message); }
  return r;
}

module.exports = { vlOn, vlStreams, vlServe, vlSub, vlSrtToVtt, vlSealOpen, vlSealedFrom, vlMaster, vlDiag, vlSelftest, VL_LANGS, VL_BASE, VL_UA };
