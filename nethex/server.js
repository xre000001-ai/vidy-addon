import http from 'node:http';
import fs from 'node:fs';
import { run as search } from './mb-lib/search.js';
import { run as runMatrix } from './mb-lib/episode-matrix.js';
let directFetch = (...a) => fetch(...a);            // v1.15.60: প্রথমে-Node-নিজস্ব-fetch (নির্ভরতা-মুক্ত-বুট)
try { ({ fetch: directFetch } = await import('undici')); } catch { } // undici-থাকলে-সেটাই (beamup-এ-ইনস্টল-হয়); না-থাকলে-ও-চলে (Cinemeta-মাত্র)
import { apiFetch } from './mb-lib/http.js';
import { poolStart, poolStats, checkerStats } from './mb-lib/pool.js';

const PORT = Number(process.env.PORT || 7000);
const VERSION = '2.11.0';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const PUBLIC_BASE = process.env.PUBLIC_BASE || 'https://5a16d5684c14-nethex.baby-beamup.club';
let LOGO_BUF = null;
try { LOGO_BUF = fs.readFileSync(new URL('./logo.png', import.meta.url)); } catch { LOGO_BUF = null; }
// v2.4.0 MASS-USER cache: TTL 30min + max 400 keys (oldest evicted) —
// a shared Map used to grow without bound under many users
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 400;
const cache = new Map();          // key -> { streams, at }
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > (e.ttl || CACHE_TTL)) {
    cache.delete(key); return null;
  }
  return e.streams;
}
function cacheSet(key, streams, ttl = CACHE_TTL) {
  if (!cache.has(key) && cache.size >= CACHE_MAX) {
    let n = 50;
    for (const k of cache.keys()) {   // insertion order = oldest first
      cache.delete(k);
      if (--n <= 0) break;
    }
  }
  cache.set(key, { streams, at: Date.now(), ttl });
}

const BG = new Set();   // v2.9.4: keys with a bg re-resolve in flight
const metaCache = new Map();   // v2.9.1: type:id -> { at, m } (30min)
const RING = [];               // v2.10.2: শেষ-৫০-রিজলভ-ধাপ (stdio:'ignore'-এর-ভেতরে-চোখ)
function ring(l) { RING.push((Date.now() % 1000000) + ' ' + l); if (RING.length > 50) RING.shift(); }
async function meta(type, id) {
  const __t0 = Date.now();
  const ck = `${type}:${id}`;
  const e = metaCache.get(ck);
  if (e && Date.now() - e.at < 30 * 60 * 1000) return e.m;
  // v2.3.1: Cinemeta is Stremio's own public meta CDN — NOT a platform
  // API that flags datacenter IPs; it stays DIRECT so every cold
  // resolve saves a proxy hop (the MovieBox BFF family is pool-only).
  try {
    const r = await directFetch(`${CINEMETA}/meta/${type}/${id}.json`, { signal: AbortSignal.timeout(10000) });
    const m = (await r.json())?.meta || null;
    if (m && m.name) { if (metaCache.size >= 300) metaCache.delete(metaCache.keys().next().value); metaCache.set(ck, { at: Date.now(), m }); }
    if (m && m.name) { ring(`meta cinemeta ok ${type}:${id} +${Date.now() - __t0}ms`); return m; }
  } catch (e) { ring(`meta cinemeta ERR ${type}:${id} +${Date.now() - __t0}ms ${e && e.cause ? e.cause.code || e.cause.message : e && e.message || e}`); }
  // v2.9.7: cinemeta sometimes answers {} or a name-less skeleton for
  // ids it has not synced - IMDb's suggestion CDN carries the display
  // title for every id, so resolve can still search MovieBox's index.
  try {
    const ir = await directFetch('https://v2.sg.media-imdb.com/suggestion/' + (String(id)[2] || 't') + '/' + id + '.json', { signal: AbortSignal.timeout(8000) });
    const x = ((await ir.json())?.d || []).find(x => x.id === id);
    if (x && x.l) {
      const m = { name: x.l, releaseInfo: x.yr ? String(x.yr) : '', type, imdb_id: id };
      if (metaCache.size >= 300) metaCache.delete(metaCache.keys().next().value);
      metaCache.set(ck, { at: Date.now(), m });
      ring(`meta imdb-fallback ok ${type}:${id} +${Date.now() - __t0}ms`);
      return m;
    }
  } catch (e) { ring(`meta imdb-fallback ERR ${type}:${id} +${Date.now() - __t0}ms`); }
  ring(`meta NONE ${type}:${id} +${Date.now() - __t0}ms`);
  return null;
}
function n(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
// v2.9.6: nz() strips ALL non-alphanumerics — so 'JUJUTSU KAISEN [عربي]' normalizes
// to exactly 'jujutsukaisen' and out-competes the true multi-dub subject
// ('Jujutsu Kaisen [English] S1-S3', the one that actually carries the Hindi dub).
// An ASCII wanted-name must never be satisfied by a foreign-script title.
const nonAscii = s => /[^\x00-\x7F]/.test(String(s || ''));
const JUNKY = /🎧|8d|sleep ambient|lofi|ringtone|\bbgm\b|instrumental|karaoke|full video|video song|fingerstyle|piano cover/i;
function choose(results, title, year, type) {
  const clean = results.filter(x => !JUNKY.test(x.title || ''));
  return choose0(clean.length ? clean : results, title, year, type) || choose0(results, title, year, type);
}
function chooseList(results, title, year, type, wantN = 3) {
  // Ranked same-title catalog subjects, best-first, deduped by detailPath —
  // lets the resolver walk down the list when one subject has no links.
  const t = n(title);
  const ok = x => !nonAscii(x.title) || nonAscii(title);
  const wantT = type === 'series' ? 2 : type === 'movie' ? 1 : 0;
  const pool = wantT ? results.filter(x => Number(x.subjectType) === wantT) : [];
  const use = pool.length ? pool : results;
  const out = [];
  const push = x => { if (x && x.detailPath && !out.some(y => y.detailPath === x.detailPath)) out.push(x); };
  use.forEach(x => { if (ok(x) && n(x.title) === t) push(x); });
  use.forEach(x => { if (ok(x) && (n(x.title).includes(t) || t.includes(n(x.title)))) push(x); });
  use.filter(x => !out.includes(x))
    .map(x => [simQ(title, x.title), x]).sort((a, b) => b[0] - a[0])
    .forEach(([q, x]) => { if (q >= 0.6 && ok(x)) push(x); });
  if (year) use.forEach(x => { if (ok(x) && String(x.releaseDate || '').startsWith(String(year))) push(x); });
  return out.slice(0, wantN);
}
function choose0(results, title, year, type) {
  const t = n(title);
  const ok = x => !nonAscii(x.title) || nonAscii(title); // foreign-script titles lose while wanted is ASCII
  // v2.9.7: prefer the requested kind (movie=1 / series=2) so a series tt
  // never resolves onto the identically-named MOVIE subject (and vice versa)
  const wantT = type === 'series' ? 2 : type === 'movie' ? 1 : 0;
  const pool = wantT ? results.filter(x => Number(x.subjectType) === wantT) : [];
  const use = pool.length ? pool : results;
  return use.find(x => ok(x) && n(x.title) === t)
    || use.find(x => ok(x) && (n(x.title).includes(t) || t.includes(n(x.title))))
    || use.find(x => ok(x) && year && String(x.releaseDate || '').startsWith(String(year)))
    || use[0];
}
// v2.9.7: token-similarity — branded names that neither include each other
// ("Demon Slayer: Kimetsu no Yaiba Infinity Castle" vs the catalog's
// "... - The Movie: Infinity Castle [English]") still deserve a match.
const _toks = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
const _STOPW = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'vs', 'no', 'part', 'movie', 'season', 'episode', 'special', 'ova', 'ona', 'tv']);
function simQ(aTitle, bName) {
  const A = [...new Set(_toks(aTitle))].filter(w => !_STOPW.has(w));
  const B = [...new Set(_toks(bName))].filter(w => !_STOPW.has(w));
  if (A.length < 2 || B.length < 2) return 0;
  const setB = new Set(B);
  let sh = 0; for (const w of A) if (setB.has(w)) sh++;
  if (sh < 3) return 0;
  return sh / Math.min(A.length, B.length);
}
// v2.9.1 ALTERNATIVE TITLES (like Nethub, but parallel): MovieBox's index
// does not always agree with Cinemeta's name — search the full name AND
// stripped variants at the SAME time; the first set that actually matches
// wins.  Results cached 6h per query (repeat taps skip the search hop).
const SRQ_TTL = 6 * 60 * 60 * 1000;
const srqCache = new Map();
async function resultsFor(q) {
  const k = q.toLowerCase();
  const e = srqCache.get(k);
  if (e && Date.now() - e.at < e.ttl) return e.r;
  const sr = await search({ q, limit: 30, page: 1 });
  const r = sr.body?.results || [];
  // v2.9.5: only a result-set that actually fuzzy-matches the query is
  // worth caching long — a junk/mismatched geo-catalog view heals fast
  const w = n(q);
  const good = r.some(x => { const t = n(x.title); return t && (t === w || t.startsWith(w) || w.startsWith(t) || t.includes(w) || w.includes(t)); });
  const ttl = good ? SRQ_TTL : 45e3;
  if (r.length && good) { if (srqCache.size >= 200) srqCache.delete(srqCache.keys().next().value); srqCache.set(k, { at: Date.now(), ttl, r }); }
  else if (r.length) srqCache.set(k, { at: Date.now(), ttl, r });
  return r;
}
async function resolve(type, imdb, season, episode) {
  const tR0 = Date.now();
  const m = await meta(type, imdb); if (process.env.NMDEBUG) console.error('[nx] meta +' + (Date.now() - tR0) + 'ms', m?.name || '(none)'); if (!m?.name) return [];
  const year = String(m.releaseInfo || '').slice(0, 4);
  const base = String(m.name).trim();
  const variants = [...new Set([base, base.replace(/\s*[:\u2013\u2014-]\s.*$/, '').trim(), year ? `${base} ${year}` : '', String(m.originalName || '').trim()].filter(Boolean))].slice(0, 4);
  let results = [];
  if (variants.length === 1) {
    results = await resultsFor(variants[0]).catch(() => []);
  } else {
    results = await new Promise((res) => {
      let done = 0, best = null, settled = false;
      const finish = (x) => { if (!settled) { settled = true; res(x); } };
      const score = (r) => {
        if (!r.length) return 0;
        const c = choose(r, m.name, year, type);
        const t = n(c?.title), q = n(m.name);
        return t === q ? 3 : (t.includes(q) || q.includes(t)) ? 2 : 1;
      };
      const tasks2 = variants.map(v => resultsFor(v).then(r => ({ v, r })).catch(() => ({ v, r: [] })));
      for (const t of tasks2) t.then(({ v, r }) => {
        done++;
        const sc = score(r);
        if (sc >= 3) return finish(r);
        if (r.length && (!best || sc > best.sc)) best = { r, sc };
        if (done === tasks2.length) finish(best ? best.r : []);
      });
    });
  }
  const wq = n(m.name);
  const rawWanted = String(m.name || '');
  const matchQ = it => { const t = n(it?.title); if (!t) return 0; if (JUNKY.test(it.title)) return 0;
    const pen = nonAscii(it.title) && !nonAscii(rawWanted) ? 1 : 0; // foreign-script: never exact/prefix
    if (pen) return 1;
    if (t === wq) return 3; if (t.startsWith(wq) || wq.startsWith(t)) return 2; if (t.includes(wq) || wq.includes(t)) return 1;
    if (simQ(it.title, rawWanted) >= 0.6) return 2;   // v2.9.7 token-sim
    return 0; };
  let item = choose(results, m.name, year, type);
  // v2.9.5: if the catalog view serves no fuzzy match (geo churn), re-search
  // fresh (cache bypass) before giving up — one honest retry, still pool-only
  if (matchQ(item) < 2) {
    const sr2 = await search({ q: base, limit: 30, page: 1 }).catch(() => null);
    const r2 = sr2?.body?.results || [];
    if (r2.length) {
      const it2 = choose(r2, m.name, year, type);
      if (matchQ(it2) > matchQ(item)) { results = r2; item = it2; }
    }
  }
  if (process.env.NMDEBUG) console.error('[nx] +' + (Date.now() - tR0) + 'ms search:', results.length, 'rows | chosen:', item?.title, '| matchQ:', matchQ(item), '| dp:', item?.detailPath);
  ring(`search ${results.length}rows chosen:${item?.title || '-'} q:${matchQ(item)} dp:${item?.detailPath ? 1 : 0} +${Date.now() - tR0}ms`);
  // v2.9.7: Cinemeta sometimes carries ONLY the romaji/original title
  // ("Super no ura de yani su futari" for tt37614297) while MovieBox's
  // index stores the English display name - every search then honestly
  // empties.  IMDb's suggestion CDN gives the display title for the id;
  // one extra search with it before giving up.
  let altOK = false;
  if (matchQ(item) < 2) {
    try {
      const ir = await directFetch('https://v2.sg.media-imdb.com/suggestion/' + (String(imdb)[2] || 't') + '/' + imdb + '.json', { signal: AbortSignal.timeout(8000) });
      const jd = await ir.json();
      const en = (jd?.d || []).find(x => x.id === imdb)?.l;
      if (en && n(en) !== n(base)) {
        const sr3 = await search({ q: en, limit: 30, page: 1 }).catch(() => null);
        const r3 = sr3?.body?.results || [];
        if (r3.length) {
          const it3 = choose(r3, en, year, type);
          const q3 = n(en);
          const t3 = n(it3?.title);
          const good3 = it3?.detailPath && (t3 === q3 || t3.startsWith(q3) || q3.startsWith(t3) || simQ(it3.title, en) >= 0.6);
          if (good3) { results = r3; item = it3; altOK = true; }
        }
      }
    } catch { }
  }
  if (!item?.detailPath || (matchQ(item) < 2 && !altOK)) { ring(`giveup q:${matchQ(item)} alt:${altOK ? 1 : 0} +${Date.now() - tR0}ms`); return []; }   // honest empty, never junk cards
  let r = await runMatrix({ id: item.detailPath, season, episode });
  if (process.env.NMDEBUG) console.error('[nx] +' + (Date.now() - tR0) + 'ms matrix status:', r.status, r.status === 200 ? `langs:${(r.body.languages || []).length} subs:${(r.body.subtitles || []).length}` : '');
  // v1.11-local: a chosen subject that answers langs:0 (exists but carries no links
  // for this episode) is not a real empty — walk the next-ranked catalog subjects
  if (r.status === 200 && !(r.body?.languages || []).length) {
    // v2.9.9 PARALLEL LADDER: geo-churn একবারে-এক-সাবজেক্ট-খেয়ে-ফেলে — পরপর-হাঁটায়-প্রতি-ধাপে-পূর্ণ-রাউন্ড-ট্রিপ
    // লাগত (E1 এখানেই ৩-৪সে হারাত)। প্রার্থীরা-এখন-একসাথে-ছোটে; লিংক-বহনকারী-প্রথম-ফল-জেতে।
    const cands = chooseList(results, m.name, year, type, 4).filter(x => x.detailPath !== item.detailPath).slice(0, 2);
    if (cands.length) {
      let rWin = null;
      await new Promise((res) => {
        let left = cands.length;
        cands.forEach((c2) => {
          if (process.env.NMDEBUG) console.error('[nx] matrix empty on', item.detailPath, '- racing candidate', c2.detailPath);
          runMatrix({ id: c2.detailPath, season, episode })
            .then(r2 => { if (!rWin && r2.status === 200 && (r2.body?.languages || []).length) rWin = r2; })
            .catch(() => {})
            .finally(() => { if (--left === 0) res(); });
        });
      });
      if (rWin) r = rWin;
    }
  }
  if (r.status !== 200) { ring(`matrix status:${r.status} +${Date.now() - tR0}ms`); return []; }
  const b = r.body;
  const streams = [];
  for (const lang of (b.languages || [])) {
    for (const x of (lang.qualities || [])) {
      if (!x.url || x.vipLocked) continue;
      streams.push(glassCard(b, lang, x, type, season, episode, year, b.subtitles));
    }
  }
  if (process.env.NMDEBUG) console.error('[nx] +' + (Date.now() - tR0) + 'ms langs:', (b.languages || []).length, '| qualities:', streams.length, '| title:', b.title);
  ring(`langs:${(b.languages || []).length} qualities:${streams.length} +${Date.now() - tR0}ms`);
  streams.sort((a, z) => (z._reso || 0) - (a._reso || 0));
  // old MovieBox glass: exact-title cards first, variant/spinoff rows sink,
  // readable cap 16 (audios always stay)
  const t = n(b.title);
  const nmOf = st => { const m2 = String(st.name || '').match(/✹ (.*)$/); return n(m2 ? m2[1] : st.title || ''); };
  const exact = streams.filter(st => { const nm = nmOf(st); return !nm || nm === t || t.startsWith(nm) || nm.startsWith(t); });
  const rest = streams.filter(st => !exact.includes(st));
  if (process.env.NMDEBUG) console.error('[nx] done +' + (Date.now() - tR0) + 'ms cards=' + (exact.length + rest.length));
  return [...exact, ...rest].slice(0, 16);
}
// ---- v2.9.3 card format: the OLD MovieBox glass spec --------------------
const CODEC_LABEL = { hevc: "HEVC", h265: "HEVC", h264: "H.264", avc: "H.264", av1: "AV1" };
function qlLabel(r) {
  r = Number(r) || 0;
  if (r >= 2160) return "UHD 2160p";
  if (r >= 1080) return "FHD 1080p";
  if (r >= 720) return `HD ${r}p`;
  return r ? `SD ${r}p` : "HLS";
}
function fmtSizeMb(mb) {
  const n = Number(mb) || 0;
  if (n < 10) return "";
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n.toFixed(1)} MB`;
}
function fmtDur(secs) {
  const x = Math.round(Number(secs) || 0);
  if (x < 60) return "";
  if (x >= 3600) return `${Math.floor(x / 3600)}h${String(Math.floor((x % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(x / 60)} min`;
}
function subLine(subs) {
  const codes = (subs || []).map(x => String(x.lanCode || x.id || "").trim()).filter(Boolean);
  if (!codes.length) return "";
  const more = codes.length > 3 ? ` +${codes.length - 3}` : "";
  return ` ⟡ ${codes.length} SUB · ${codes.slice(0, 3).join(", ")}${more}`;
}
function glassCard(b, lang, x, ctype, season, episode, year, subs) {
  const langName = lang.lanName || "Original";
  const dub = /^original/i.test(langName) ? "" : langName;
  const t1 = [ctype === "series" ? `◫ S${String(season).padStart(2, "0")} E${String(episode).padStart(2, "0")}` : "◫ MOVIE"];
  const size = fmtSizeMb(x.size_mb); if (size) t1.push(`◇ ${size}`);
  const codec = CODEC_LABEL[(x.codec || "").toLowerCase()] || ""; if (codec) t1.push(`▧ ${codec}`);
  const dur = fmtDur(x.duration_sec); if (dur) t1.push(`◷ ${dur}`);
  const lines = [t1.join(" ")];
  if (dub) lines.push(`◈ ${dub}`);
  lines.push("⌗ MovieBox", `◴ ${year}${subLine(subs)}`);
  return {
    name: `♧ ${qlLabel(x.resolution)}  ✹ ${b.title}`,
    description: lines.join("\n"),
    url: x.url,
    behaviorHints: {
      notWebReady: false,
      isBingeable: true,
      filename: "stream.mp4",
      proxyHeaders: { request: { Referer: "https://movieboxonline.net/", Origin: "https://movieboxonline.net", "User-Agent": "Mozilla/5.0" } },
    },
    bingeGroup: `mbxr|${b.title}::|${dub || "Original"}`,
    _lang: langName,
    _reso: Number(x.resolution) || null,
  };
}
function filterStreams(streams, searchParams) {
  const preferred = (searchParams.get('preferred') || searchParams.get('quality') || '').split(',').map(x => x.trim()).filter(Boolean);
  const nonPreferred = new Set((searchParams.get('nonpreferred') || '').split(',').map(x => x.trim()).filter(Boolean));
  const languages = new Set((searchParams.get('language') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  const qOf = stream => stream._reso ? `${stream._reso}p` : (String(stream.name).match(/(\d+)p/)?.[0] || '');
  const lOf = stream => String(stream._lang || 'original').toLowerCase();
  const audioMatches = stream => {
    const language = lOf(stream);
    return !languages.size || [...languages].some(item => language === item || language.startsWith(`${item} `) || (item === 'original' && language.startsWith('original')));
  };
  const usable = streams.filter(stream => !nonPreferred.has(qOf(stream)) && audioMatches(stream));
  if (!preferred.length) return usable;
  const top = usable.filter(stream => preferred.includes(qOf(stream)));
  return top.length ? top : usable;
}
const manifest = { id: 'community.nethex', version: VERSION, name: 'MovieBox', logo: `${PUBLIC_BASE}/logo.png`, description: 'Direct multi-language MP4 streams (movies, series, dubs, subtitles) with quality & audio filters. API rides the proxy pool; playback is direct CDN.', resources: ['stream', 'subtitles'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [], behaviorHints: { configurable: true, configurationRequired: false } };
function send(res, status, body) { const s = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Access-Control-Allow-Origin': '*' }); res.end(s); }
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/manifest.json') return send(res, 200, manifest);
    if (u.pathname === '/logo.png') {
      if (!LOGO_BUF) return send(res, 404, { error: 'no logo' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
      return res.end(LOGO_BUF);
    }
    if (u.pathname === '/health') return send(res, 200, { ok: true, version: VERSION, mode: 'direct-mp4', pool: poolStats().healthy, waves: checkerStats().waves, size: poolStats().size }); // waves=মোট-স্ক্যান-ঢেউ (সব-মান-এক্সপোর্টেড-হেল্পার-থেকে)
    if (u.pathname === '/debug/ring') return send(res, 200, RING.slice(-50)); // v2.10.2 রিজলভ-ধাপ-প্রমাণ
    if (u.pathname === '/debug/pool') {
      if (u.searchParams.get('k') !== 'nethex-dbg-7f3a') return send(res, 404, { error: 'not found' });
      return send(res, 200, poolStats());
    }
    const sm = u.pathname.match(/^\/subtitles\/(movie|series)\/([^/]+?)(?:\.json)?$/);
    if (sm) {
      const [imdb, season = '1', episode = '1'] = decodeURIComponent(sm[2]).split(':');
      const mta = await meta(sm[1], imdb);
      if (!mta?.name) return send(res, 200, { subtitles: [] });
      const sr = await search({ q: mta.name, limit: 30, page: 1 });
      const item = choose(sr.body?.results || [], mta.name, String(mta.releaseInfo || '').slice(0, 4), sm[1]);
      if (!item?.detailPath) return send(res, 200, { subtitles: [] });
      const r = await runMatrix({ id: item.detailPath, season, episode });
      const subtitles = (r.body?.subtitles || []).filter(x => x.url).map(x => ({ id: String(x.id || x.lanCode || x.lanName), url: x.url, lang: x.lanName || x.lanCode || 'Unknown' }));
      return send(res, 200, { subtitles });
    }
    const m = u.pathname.match(/^\/stream\/(movie|series)\/([^/]+?)(?:\.json)?$/);
    if (m) {
      const [imdb, season = '1', episode = '1'] = decodeURIComponent(m[2]).split(':');
      const qualityKey = u.searchParams.get('preferred') || u.searchParams.get('quality') || '';
      const nonPreferredKey = u.searchParams.get('nonpreferred') || '';
      const languageKey = u.searchParams.get('language') || '';
      const key = `${m[1]}:${imdb}:${season}:${episode}`;
      let streams = cacheGet(key);
      if (streams && streams.length === 0) {
        // v2.9.4: a cached empty must never glue the addon at zero — fire a
        // deduped background re-resolve and answer honestly-empty now
        if (!BG.has(key)) {
          BG.add(key);
          setTimeout(() => {
            resolve(m[1], imdb, season, episode)
              .then(y => { if (y.length) cacheSet(key, y, 90 * 60 * 1000); })
              .catch(() => {})
              .finally(() => BG.delete(key));
          }, 300).unref?.();
        }
        return send(res, 200, { streams: [] });
      }
      if (!streams) {
        // v2.9.4 WALL: answer within 11.5s (CF cuts ~12s).  A cold
        // resolve keeps running and fills the cache — tap-2 is instant.
        const box = {};
        const p = resolve(m[1], imdb, season, episode)
          .then(x => {
            box.s = x;
            // v2.4.1: empties live 60s and ONE background re-resolve
            // fires at 45s — a churn-window miss heals by itself; a
            // positive shelf lives 90min (sign urls ~2h).
            // v2.6.0: a THIN bench (boot/churn window) must never write
            // a negative cache — the next tap re-resolves on fresh exits
            if (x.length) cacheSet(key, x, 90 * 60 * 1000); // v2.10.3: শুধু-ধনাত্মক-ক্যাশ — খালি-ক্যাশ-লিখলে-MB-সাইট-ঢেউ-ভাঙা-৬০সে-মেমো-হয়ে-যেত (r57-নীতি)
            // v2.9.2 BINGE PREWARM: a successful series tap quietly resolves
            // the NEXT 3 episodes into the cache — the next tap is a cache hit
            // (1.2s-class) instead of a cold chain.  Pool untouched.
            if (x.length && m[1] === 'series') {
              setTimeout(() => {
                for (let e = episode + 1; e <= episode + 3; e++) {
                  resolve('series', imdb, season, e)
                    .then(y => { if (y.length) cacheSet(`${m[1]}:${imdb}:${season}:${e}`, y, 90 * 60 * 1000); })
                    .catch(() => {});
                }
              }, 1500).unref?.();
            }
            if (!x.length) {
              setTimeout(() => {
                resolve(m[1], imdb, season, episode)
                  .then(y => { if (y.length) cacheSet(key, y); })
                  .catch(() => {});
              }, 45000).unref?.();
            }
            return x;
          })
          .catch(() => []);
        streams = await Promise.race([
          p,
          new Promise(r => setTimeout(() => r(null), 30000)),
        ]);
        if (streams === null) {
          p.catch(() => {});
          return send(res, 200, { streams: [], message:
            'resolving — tap streams again in a moment' });
        }
      }
      const filtered = filterStreams(streams, new URLSearchParams({ preferred: qualityKey, nonpreferred: nonPreferredKey, language: languageKey }));
      return send(res, 200, { streams: filtered });
    }
    if (u.pathname === '/configure' || u.pathname === '/config' || u.pathname === '/configure-v2') {
      const host = u.host;
      const manifestUrl = `${PUBLIC_BASE}/manifest.json`;
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0d12"><title>MovieBox — Configure</title><style>*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0%,#183629 0,#0b0d12 35%);color:#eef1f6;font:14px Inter,system-ui,-apple-system,Segoe UI,sans-serif}.shell{max-width:760px;margin:auto;padding:22px 16px 46px}.top{display:flex;align-items:center;justify-content:space-between;gap:14px}.brand{font-size:29px;font-weight:850;letter-spacing:.4px}.brand b{color:#35d07f}.version{font-size:11px;color:#9ba5b5;background:#151b25;border:1px solid #283242;border-radius:999px;padding:6px 10px}.sub{color:#9ba5b5;margin:7px 0 20px}.tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;background:#11161f;border:1px solid #252f3e;border-radius:13px;padding:6px;position:sticky;top:10px;z-index:2}.tab{border:0;background:transparent;color:#9ba5b5;border-radius:9px;padding:10px 5px;font-weight:750;cursor:pointer}.tab.active{background:#1d6546;color:#f1fff7}.panel{display:none}.panel.active{display:block}.card{background:linear-gradient(145deg,#171f2a,#111720);border:1px solid #2d3949;border-radius:18px;padding:19px;margin-top:14px;box-shadow:0 12px 30px #0003}.eyebrow{font-size:11px;color:#35d07f;text-transform:uppercase;letter-spacing:1.1px;font-weight:800}.heading{font-size:19px;font-weight:800;letter-spacing:-.2px;margin:7px 0 5px}.muted{color:#9ba5b5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.stat{background:#10151d;border:1px solid #252f3e;border-radius:11px;padding:12px}.stat small{display:block;color:#8894a5;font-size:11px;margin-bottom:5px}.stat strong{font-size:13px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.chip{border:1px solid #344154;background:#202936;color:#dce4ee;border-radius:999px;padding:9px 13px;cursor:pointer;font-weight:650}.chip.active{background:#176c46;border-color:#35d07f;color:#fff}.chip:focus{outline:2px solid #35d07f;outline-offset:2px}.status{font-size:12px;margin-top:10px;color:#9ba5b5}.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}.btn{display:block;text-align:center;border:0;text-decoration:none;border-radius:10px;padding:13px 10px;font-weight:850;cursor:pointer}.primary{background:#35d07f;color:#07130d}.secondary{background:#222b38;color:#eef1f6;border:1px solid #344154}.manifest{width:100%;background:#0d1219;color:#b9c5d5;border:1px solid #344154;border-radius:9px;padding:12px;margin-top:10px;font-size:12px}.note{font-size:12px;line-height:1.55;color:#8793a5;margin:12px 0 0}.check{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-bottom:1px solid #252f3e}.check:last-child{border:0}.dot{width:8px;height:8px;border-radius:50%;background:#35d07f;margin-top:5px;flex:none}</style></head><body><main class="shell"><header class="top"><div class="brand"><b>MovieBox</b></div><div class="version">v${VERSION}</div></header><p class="sub">Direct streams, audio choices and subtitles for Stremio.</p><nav class="tabs" role="tablist"><button class="tab active" data-tab="setup">Setup</button><button class="tab" data-tab="quality">Quality</button><button class="tab" data-tab="audio">Audio</button><button class="tab" data-tab="about">About</button></nav><section class="panel active" data-panel="setup"><div class="card"><div class="eyebrow">Ready to install</div><div class="heading">Install MovieBox in Stremio</div><div class="muted">Your selected filters are included in the manifest link below.</div><div class="actions"><a class="btn primary" href="stremio://${manifestUrl.replace(/^https?:\/\//, '')}">▶ Install in Stremio</a><a class="btn secondary" href="${manifestUrl}" target="_blank" rel="noreferrer">↗ Open manifest</a></div><input class="manifest" readonly aria-label="MovieBox manifest URL" value="${manifestUrl}" onclick="this.select()"><button class="btn secondary" style="width:100%;margin-top:9px" data-copy>Copy manifest link</button><p class="note" data-copy-status>Tip: if the app opens without installing, use “Copy manifest link” and paste it into Stremio’s Add-ons search box.</p></div><div class="card"><div class="eyebrow">Connection</div><div class="grid"><div class="stat"><small>Playback</small><strong>Direct MP4 / CDN</strong></div><div class="stat"><small>Sources</small><strong>MovieBox</strong></div><div class="stat"><small>Content</small><strong>Movies · Series</strong></div><div class="stat"><small>Subtitles</small><strong>Direct CDN captions</strong></div></div></div></section><section class="panel" data-panel="quality"><div class="card"><div class="eyebrow">Resolution strategy</div><div class="heading">Preferred resolution</div><div class="muted">Preferred qualities are returned first. If none exist, MovieBox falls back to every allowed quality.</div><div class="chips" data-filter-group="preferred"><button type="button" class="chip active" data-filter="any">Any</button><button type="button" class="chip">1080p</button><button type="button" class="chip">720p</button><button type="button" class="chip">480p</button><button type="button" class="chip">360p</button></div><div class="status" data-preferred-status>Any resolution preferred</div></div><div class="card"><div class="eyebrow">Resolution rules</div><div class="heading">Non-preferred resolutions</div><div class="muted">Selected resolutions are blocked completely. Unselected resolutions remain valid fallbacks.</div><div class="chips" data-filter-group="nonpreferred"><button type="button" class="chip">1080p</button><button type="button" class="chip">720p</button><button type="button" class="chip">480p</button><button type="button" class="chip">360p</button></div><div class="status" data-nonpreferred-status>No blocked resolutions</div></div></section><section class="panel" data-panel="audio"><div class="card"><div class="eyebrow">Audio filter</div><div class="heading">Preferred audio languages</div><div class="muted">Select multiple languages. Only matching direct streams will be returned.</div><div class="chips" data-filter-group="language"><button type="button" class="chip active">Original</button><button type="button" class="chip active">English</button><button type="button" class="chip active">Hindi</button><button type="button" class="chip active">Bengali</button><button type="button" class="chip active">Tamil</button><button type="button" class="chip active">Telugu</button><button type="button" class="chip">Malayalam</button><button type="button" class="chip">Kannada</button><button type="button" class="chip">Marathi</button><button type="button" class="chip">Punjabi</button><button type="button" class="chip">Arabic</button><button type="button" class="chip">Russian</button><button type="button" class="chip">Spanish</button><button type="button" class="chip">ptbr</button><button type="button" class="chip">esla</button></div><div class="status" data-language-status>6 languages selected</div></div></section><section class="panel" data-panel="about"><div class="card"><div class="eyebrow">MovieBox</div><div class="heading">Simple, direct playback</div><div class="check"><span class="dot"></span><span>IMDb title matching through Cinemeta.</span></div><div class="check"><span class="dot"></span><span>Direct stream URLs are returned to Stremio.</span></div><div class="check"><span class="dot"></span><span>No media bytes pass through the addon server.</span></div><div class="check"><span class="dot"></span><span>Language, quality and subtitle support.</span></div></div></section></main><script>const tabs=[...document.querySelectorAll('[data-tab]')],panels=[...document.querySelectorAll('[data-panel]')];tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.classList.toggle('active',x===t));panels.forEach(x=>x.classList.toggle('active',x.dataset.panel===t.dataset.tab))});const base='${manifestUrl}';const values=g=>[...document.querySelectorAll('[data-filter-group='+g+'] .chip.active')].map(x=>x.textContent.trim()).filter(x=>x!=='Any');const updateFilters=()=>{const p=values('preferred'),n=values('nonpreferred'),l=values('language'),q=new URLSearchParams();if(p.length)q.set('preferred',p.join(','));if(n.length)q.set('nonpreferred',n.join(','));if(l.length)q.set('language',l.join(','));const url=base+(q.toString()?'?'+q.toString():'');document.querySelector('.manifest').value=url;document.querySelector('.primary').href='stremio://'+url.replace('https://','').replace('http://','');document.querySelector('.secondary[href]').href=url;document.querySelector('[data-preferred-status]').textContent=p.length?p.join(', ')+' preferred':'Any resolution preferred';document.querySelector('[data-nonpreferred-status]').textContent=n.length?n.join(', ')+' blocked':'No blocked resolutions';document.querySelector('[data-language-status]').textContent=l.length?l.length+' audio languages selected':'No audio language filter'};document.querySelectorAll('[data-filter-group=preferred] .chip').forEach(x=>x.onclick=()=>{if(x.dataset.filter==='any'){x.parentElement.querySelectorAll('.chip').forEach(y=>y.classList.remove('active'));x.classList.add('active')}else{x.parentElement.querySelector('[data-filter=any]').classList.remove('active');x.classList.toggle('active');if(!x.parentElement.querySelector('.chip.active'))x.parentElement.querySelector('[data-filter=any]').classList.add('active')}updateFilters()});document.querySelectorAll('[data-filter-group=nonpreferred] .chip,[data-filter-group=language] .chip').forEach(x=>x.onclick=()=>{x.classList.toggle('active');updateFilters()});document.querySelector('[data-copy]').onclick=async()=>{const b=document.querySelector('.manifest');try{await navigator.clipboard.writeText(b.value);document.querySelector('[data-copy-status]').textContent='Manifest link copied.'}catch{b.select();document.querySelector('[data-copy-status]').textContent='Select the link and copy it manually.'}};updateFilters();</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      return res.end(page);
    }
    if (u.pathname === '/') return send(res, 200, { name: manifest.name, configure: '/configure', install: '/manifest.json', version: VERSION });
    return send(res, 404, { error: 'Not found' });
  } catch (e) { console.error(e); return send(res, 200, { streams: [] }); }
});
poolStart();   // v2.6.0: pool ALWAYS on for API calls (user directive)
// v2.3.2: warm the anonymous JWT through a pool exit at boot so the
// first real tap never pays the mint (2 extra hops)
setImmediate(() => { search({ q: 'a', limit: 1, page: 1 }).catch(() => {}); });
server.listen(PORT, '0.0.0.0', () => console.log(`MovieBox (NETHEX) v${VERSION} on :${PORT}`));
