'use strict';
/* ★ v1.34.322: nexa.mov — নতুন সোর্স (ইউজার-নির্দেশ)।
   nexa.mov একটা SvelteKit SPA; প্লেব্যাক-পাইপলাইন সম্পূর্ণ সিল করা:
     providers.nexa.mov/v1/runtime.json → sources.mjs + sources.wasm (ABI 3, configVersion 34)
     sources.handshake(puzzle, viewer) ──► NXH3 এনভেলপ ──POST /v1/session──► সেশন-ব্লব (92B)
     api.accept(resp) ⇒ সেশন-লাইভ
     api.plan({platform:'tmdb', id, season, episode}) ⇒ সার্ভার-প্রতি {codename, envelope(NXS3), header(24B)}
     POST /v1/playlist {envelope} → 200 ⇒ api.open(header, resp) ⇒ আসল {url, kind, headers, audioOptions}
   সার্ভার-ক্যাটালগ (wasm থেকেই): মুভি/সিরিজ ৫টি — nova, onyx, orion, flux, sylver
                                অ্যানিমে ৪টি — kyoto, tokyo, hokkaido, fuji
   নীতি (অন্য সব সোর্সের মতোই): কার্ড তখনই যখন URL সত্যিই সাড়া দেয় (২০০/২০৬) — বলতে-না-পারলে
   রেজোলিউশন 'Auto' (কখনো বানানো সংখ্যা নয়), আর প্লেলিস্ট-বডিতে RESOLUTION= দেখলে তবেই সংখ্যা। */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROVIDERS = process.env.NEXA_PROVIDERS || 'https://providers.nexa.mov';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const MOD = path.join(__dirname, 'nexa-sources.mjs');
const WASM = path.join(__dirname, 'nexa-sources.wasm');

const MOVIE_SRV = ['nova', 'onyx', 'orion', 'flux', 'sylver'];       // মুভি/সিরিজ
const ANIME_SRV = ['kyoto', 'tokyo', 'hokkaido', 'fuji'];             // অ্যানিমে

let API = null, API_P = null, HS_P = null, SESS_AT = 0, BLOCK_UNTIL = 0;
const DIAG = { init: 0, initErr: '', sess: 0, sessErr: '', plan: 0, planErr: 0, pl200: 0, pl404: 0, pl400: 0, open: 0, cards: 0, probeOk: 0, probeFail: 0, last: [] };
const CARD_CACHE = new Map();   // key → {at, cards}
const PROBE_CACHE = new Map();  // url → {at, ok, quality, ct}
const CARD_TTL = Number(process.env.NEXA_CARD_TTL || 180000);
const PROBE_TTL = Number(process.env.NEXA_PROBE_TTL || 600000);
const MAXC = 400;

function note(s) { try { DIAG.last.push(String(s).slice(0, 160)); if (DIAG.last.length > 25) DIAG.last.shift(); } catch (e) { } }
function nexOn(cfg) { return !(cfg && cfg.nex === 0); }

/* ───────────── wasm মডিউল (একবারই) ───────────── */
async function getApi() {
  if (API) return API;
  if (API_P) return API_P;
  API_P = (async () => {
    const t0 = Date.now();
    const origFetch = globalThis.fetch;
    try {
      const mod = await import(require('url').pathToFileURL(MOD).href);
      const factory = mod.default;
      /* emscripten Node-এও `fetch` দেখে ⇒ web-পথ নেয়, আর রিলেটিভ wasm-URL পার্স হয় না।
         তাই ইনিশিয়ালাইজেশনের মুহূর্তে wasm-URL-গুলো লোকাল ফাইল থেকেই দিই (বাকি সব পাস-থ্রু)। */
      const wasmBytes = fs.readFileSync(WASM);
      globalThis.fetch = async (u, o) => {
        const url = typeof u === 'string' ? u : ((u && u.url) || String(u));
        if (/\.wasm(\?|$)/.test(url)) return new Response(wasmBytes, { status: 200, headers: { 'content-type': 'application/wasm' } });
        return origFetch(u, o);
      };
      API = await factory({});
      DIAG.init = Date.now() - t0;
      if (!API || typeof API.handshake !== 'function') throw new Error('abi-mismatch');
      return API;
    } catch (e) {
      DIAG.initErr = String((e && e.message) || e).slice(0, 120);
      note('init-fail: ' + DIAG.initErr);
      API = null;
      return null;
    } finally { try { globalThis.fetch = origFetch; } catch (e) { } API_P = null; }
  })();
  return API_P;
}

/* ───────────── HTTP ───────────── */
async function postRaw(p, body, ms) {
  const ctl = new AbortController();
  const tm = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, Math.max(3000, ms || 15000));
  try {
    const r = await fetch(PROVIDERS + p, {
      method: 'POST', body, signal: ctl.signal,
      headers: { 'content-type': 'application/octet-stream', 'user-agent': UA, 'origin': 'https://nexa.mov', 'referer': 'https://nexa.mov/' },
    });
    const ab = await r.arrayBuffer();
    return { status: r.status, body: Buffer.from(ab), retryAfter: Number(r.headers.get('retry-after') || 0) || 0 };
  } catch (e) {
    return { status: 0, body: Buffer.alloc(0), err: String((e && e.message) || e).slice(0, 80) };
  } finally { clearTimeout(tm); }
}

/* ───────────── সেশন ───────────── */
async function ensureSession(ms) {
  const api = await getApi();
  if (!api) return null;
  if (api.hasSession()) return api;
  if (Date.now() < BLOCK_UNTIL) { note('session-blocked ' + Math.ceil((BLOCK_UNTIL - Date.now()) / 1000) + 's'); return null; }
  if (HS_P) return HS_P;
  HS_P = (async () => {
    try {
      const hs = await api.handshake({}, 'g:' + crypto.randomUUID());
      const r = await postRaw('/v1/session', Buffer.from(hs), ms);
      if (r.status === 200 && api.accept(new Uint8Array(r.body))) { SESS_AT = Date.now(); DIAG.sess++; return api; }
      if (r.status === 409) { note('session 409 (version skew)'); }
      /* 429 ⇒ সার্ভারই বলে কখন আবার: retry-after (ক্লায়েন্ট-কোডের মতোই) নাহলে ৬০সে ব্যাকঅফ */
      if (r.status === 429) {
        const ra = Number(r.retryAfter) > 0 ? Number(r.retryAfter) : 120;   // সার্ভারের retry-after, নাহলে ২ মিনিট
        BLOCK_UNTIL = Date.now() + Math.max(20, Math.min(900, ra)) * 1000;
        note('session-429 rate-limited ' + ra + 's');
      }
      DIAG.sessErr = 'session ' + r.status + (r.err ? ' ' + r.err : '');
      note('session-fail ' + r.status + ' ' + (r.err || ''));
      return api.hasSession() ? api : null;
    } catch (e) {
      DIAG.sessErr = String((e && e.message) || e).slice(0, 120);
      note('hs-fail: ' + DIAG.sessErr);
      return null;
    } finally { HS_P = null; }
  })();
  return HS_P;
}

/* ───────────── প্লেলিস্ট (সার্ভার-প্রতি) ───────────── */
async function playlistFor(api, plan, ms) {
  if (Date.now() < BLOCK_UNTIL) return null;
  let r = await postRaw('/v1/playlist', Buffer.from(plan.envelope), ms);
  DIAG.plan++;
  if (r.status === 401) {            // সেশন-মেয়াদোত্তীর্ণ ⇒ রিসেট করে একবার আবার (ক্লায়েন্ট-কোডের মতোই)
    try { api.reset(); } catch (e) { }
    const a2 = await ensureSession(ms);
    if (!a2) { DIAG.planErr++; return null; }
    r = await postRaw('/v1/playlist', Buffer.from(plan.envelope), ms);
  }
  if (r.status === 200) {
    DIAG.pl200++;
    try {
      const info = api.open(plan.header, new Uint8Array(r.body));
      if (!info) { DIAG.planErr++; return null; }
      DIAG.open++;
      return info;
    } catch (e) { DIAG.planErr++; note('open-fail: ' + String((e && e.message) || e)); return null; }
  }
  if (r.status === 429) { BLOCK_UNTIL = Date.now() + 60000; note('playlist-429 → 60s backoff'); }
  if (r.status === 404) DIAG.pl404++; else DIAG.pl400++;
  note(plan.codename + ' -> ' + r.status + ' ' + r.body.slice(0, 12).toString('latin1').trim());
  return null;
}

/* ───────────── প্রোব: URL সত্যিই চলে? রেজোলিউশন কত? ───────────── */
async function probe(u, hdrs, ms) {
  const hit = PROBE_CACHE.get(u);
  if (hit && Date.now() - hit.at < PROBE_TTL) return hit;
  const ctl = new AbortController();
  const tm = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, Math.max(4000, ms || 9000));
  let out = { at: Date.now(), ok: 0, quality: '', ct: '', why: '' };
  try {
    const r = await fetch(u, {
      signal: ctl.signal, redirect: 'follow',
      headers: Object.assign({ 'user-agent': UA, 'referer': 'https://nexa.mov/', 'origin': 'https://nexa.mov', 'range': 'bytes=0-32767' }, hdrs || {}),
    });
    out.ct = String(r.headers.get('content-type') || '');
    if (r.status === 200 || r.status === 206) {
      const txt = (await r.text()).slice(0, 40000);
      if (txt) {
        out.ok = 1;
        const res = [...txt.matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map(m => parseInt(m[2], 10));
        if (res.length) {
          const best = Math.max.apply(null, res);
          out.quality = String(best >= 2160 ? 2160 : best >= 1080 ? 1080 : best >= 720 ? 720 : best >= 480 ? 480 : best);
        } else if (/^#EXTM3U/.test(txt)) {
          out.quality = '';         // মিডিয়া-প্লেলিস্ট: RESOLUTION লেখাই নেই ⇒ 'Auto' (বানানো নয়)
        } else if (/ftyp|moov|mdat/.test(txt.slice(0, 400))) {
          out.quality = '';         // সরাসরি MP4 ⇒ রেজো অজানা
        } else { out.ok = 0; out.why = 'not-media'; }
      } else { out.ok = 0; out.why = 'empty'; }
    } else { out.ok = 0; out.why = 'http-' + r.status; }
  } catch (e) { out.ok = 0; out.why = String((e && e.name) || e).slice(0, 40); }
  finally { clearTimeout(tm); }
  if (out.ok) DIAG.probeOk++; else DIAG.probeFail++;
  if (PROBE_CACHE.size > 600) PROBE_CACHE.clear();
  PROBE_CACHE.set(u, out);
  return out;
}

/* ───────────── মূল এন্ট্রি ───────────── */
function mkCards(list, meta) {
  const out = [];
  const size = String(meta.title || '').trim();
  for (const it of list) {
    const q = it.quality || '';
    const srvLabel = it.label || it.codename;
    const txt = '⧉ ' + (size || 'nexa.mov') + (meta.year ? ' | ' + meta.year + ' |' : ' |')
      + '\n' + (meta.type === 'series' && meta.s > 0 ? '⧠ S' + meta.s + 'E' + meta.e : '⧠ Movie')
      + '\n' + '⊞ nexa ◧ ' + srvLabel + (it.audio ? ' ⌗ ' + it.audio : '');
    const bh = { notWebReady: false, isBingeable: true, filename: 'nexa-' + it.codename + '-' + (q || 'auto') + (it.kind === 'file' ? '.mp4' : '.m3u8') };
    if (it.headers && Object.keys(it.headers).length) bh.proxyHeaders = { request: it.headers };
    out.push({
      name: '\u25a5 ' + (q || 'Auto') + ' \u25a5',
      title: txt, description: txt,
      quality: String(q || ''),
      url: it.url,
      behaviorHints: bh,
      bingeGroup: 'nex|' + mlsNorm(size) + '::' + (meta.type === 'series' && meta.s > 0 ? 'S' + meta.s + 'E' + meta.e : 'm'),
    });
  }
  return out;
}
function mlsNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

async function nexStreams(tmdbId, type, s, e, origin, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const ms = Math.max(4000, Number(opts.ms || 12000));
  const id = Number(tmdbId) || 0;
  if (!id) return [];
  const isSeries = type === 'series';
  const S = isSeries ? Math.max(1, Number(s) || 1) : 0;
  const E = isSeries ? Math.max(1, Number(e) || 1) : 0;
  const key = 'tmdb:' + id + ':' + (isSeries ? 'S' + S + 'E' + E : 'm');
  const hit = CARD_CACHE.get(key);
  if (hit && Date.now() - hit.at < CARD_TTL) return hit.cards;

  const api = await ensureSession(ms);
  if (!api) return [];
  let plans = [];
  try {
    const q = isSeries ? { platform: 'tmdb', id: id, season: S, episode: E } : { platform: 'tmdb', id: id };
    plans = api.plan(q) || [];
  } catch (err) { note('plan-fail: ' + String((err && err.message) || err)); return []; }
  if (!plans.length) { note('plan-empty tmdb' + id); return []; }

  const cat = (() => { try { return api.catalogue() || []; } catch (e) { return []; } })();
  const nameOf = new Map(cat.map(c => [c.codename, c.name]));

  const deadline = t0 + ms;
  const jobs = plans.map(p => (async () => {
    if (Date.now() > deadline) return null;
    const info = await playlistFor(api, p, Math.max(2500, deadline - Date.now()));
    if (!info || !info.url) return null;
    const pr = await probe(info.url, info.headers, Math.max(3000, deadline - Date.now()));
    if (!pr.ok) return null;
    const aud = info.audioOptions && info.audioOptions.length ? String(info.audioOptions[0].label || info.audioOptions[0].lang || '') : '';
    return { codename: p.codename, label: nameOf.get(p.codename) || p.codename, url: info.url, kind: info.kind || '', headers: info.headers || null, quality: pr.quality, audio: aud };
  })().catch(() => null));

  const settled = await Promise.all(jobs);
  const good = settled.filter(Boolean);

  // কোয়ালিটি-ফিল্টার (cfg.nexq) — জানা-রেজো থাকলে তবেই ছাঁকা; অজানা (Auto) বাদ যায় না
  const want = (opts.q || []).map(Number).filter(Boolean);
  const kept = want.length ? good.filter(g => !g.quality || want.indexOf(Number(g.quality)) >= 0) : good;

  const meta = { title: opts.title || '', year: opts.year || '', type: isSeries ? 'series' : 'movie', s: S, e: E };
  const cards = mkCards(kept, meta);
  if (kept.length) DIAG.cards += cards.length;
  note(((isSeries ? 'S' + S + 'E' + E : 'movie') + ' tmdb' + id + ': ' + plans.length + ' srv → ' + good.length + ' ok (' + (Date.now() - t0) + 'ms) ' + kept.map(k => k.codename + (k.quality ? '@' + k.quality : '')).join(',')).slice(0, 150));
  if (CARD_CACHE.size > MAXC) CARD_CACHE.clear();
  CARD_CACHE.set(key, { at: Date.now(), cards });
  return cards;
}

/* ───────────── ডায়াগনস্টিক ───────────── */
function nexDiag() {
  const d = Object.assign({}, DIAG);
  d.servers = { movie: MOVIE_SRV, anime: ANIME_SRV };
  d.hasSession = null; d.cat = null;
  try { if (API) { d.hasSession = API.hasSession(); d.cat = (API.catalogue() || []).map(c => c.codename); } } catch (e) { }
  d.cardCache = CARD_CACHE.size; d.probeCache = PROBE_CACHE.size;
  d.last = DIAG.last.slice(-8);
  return d;
}
async function nexSelftest(tmdbId, type, s, e) {
  const t0 = Date.now();
  const api = await ensureSession(15000);
  const out = { session: !!(api && api.hasSession()), ms: 0, plans: [], cards: 0 };
  if (api) {
    try {
      const q = type === 'series' ? { platform: 'tmdb', id: Number(tmdbId), season: Number(s || 1), episode: Number(e || 1) } : { platform: 'tmdb', id: Number(tmdbId) };
      const plans = api.plan(q) || [];
      out.plans = plans.map(p => p.codename);
      out.detail = [];
      for (const p of plans) {
        const r = await postRaw('/v1/playlist', Buffer.from(p.envelope), 12000);
        let info = null;
        if (r.status === 200) { try { info = api.open(p.header, new Uint8Array(r.body)); } catch (er) { } }
        out.detail.push({ codename: p.codename, status: r.status, bytes: r.body.length, url: info ? String(info.url).slice(0, 120) : null });
      }
    } catch (er) { out.err = String((er && er.message) || er).slice(0, 120); }
    const cards = await nexStreams(tmdbId, type, s, e, '', { title: 'selftest', ms: 15000 });
    out.cards = cards.length;
    out.cardSample = cards.slice(0, 3).map(c => ({ name: c.name, url: String(c.url).slice(0, 100) }));
  }
  out.ms = Date.now() - t0;
  return out;
}

module.exports = { nexOn, nexStreams, nexDiag, nexSelftest, MOVIE_SRV, ANIME_SRV };
