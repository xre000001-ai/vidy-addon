// NETHEX proxy pool v2 — enriched, fast, MASS-USER ready.
// ("only proxy calling, direct user playing" + "retry until the empty is
// REAL" + "pool aro enrich fast, mass user compatible")
//
//   - Source: ProxyScrape v4 public list, 200 http:// candidates per pass
//     (undici ProxyAgent tunnels CONNECT; socks is unsupported in Node)
//   - PLATFORM-REAL probe: the H5 search-suggest through each exit — a
//     gstatic 204 proves nothing about THIS addon's paths
//   - READY BENCH: STREAMING boot — candidates probe->verify one by one
//     and join the second they pass (waves of 60, stop at 28); a thin
//     result re-runs the pass (up to 3).  Re-verify every 4 min; a member
//     that misses the bench sits out until a pass re-admits it.
//   - TRAINED pick: exits ranked by live EWMA latency (<=1500ms eligible),
//     load spread across the 4 fastest by in-flight count; fetchJsonRotating
//     additionally pins the last winning exit per route (45s stickiness).
//   - 403/406 -> benched 20min, dead/mangled -> 10min; the trainer
//     re-verifies every cycle
//   - fetchJsonRotating(): the retry-until-REAL-empty transport — each
//     attempt goes through a DIFFERENT exit; the CALLER decides what an
//     honest empty is (content-driven), this layer only rotates exits
let undiciFetch = (...a) => fetch(...a), ProxyAgent = null; // v1.15.60: undici-অনুপস্থিতিতেও-বুট-হয় (নির্ভরতা-মুক্ত-ফলব্যাক)
try { ({ fetch: undiciFetch, ProxyAgent } = await import('undici')); } catch { } // থাকলে-আসল-undici (beamup-এ-স্বাভাবিক)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SITE, UA } from './upstream.js';

// r-20261016j: বহু-উৎস-ফসল (রেজলভার/vidy-এনরিচ-প্যারিটি) — এক-উৎস-নিঃশেষ/রেট-লিমিটে-পুল-অনাহারে-মরবে-না
// (প্রোড-ঘটনা: beamup-IP-প্রতি-proxyscrape-সীমা → শিশু-পুল-০-আটকে; লোকাল-IP-সুস্থ — উৎস-বৈচিত্র্যই-ওষুধ)
const SRCS = ['https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text',
              'https://raw.githubusercontent.com/TheSpeedX/PROXY-LIST/master/http.txt',
              'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
              'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt']; // proxifly: পৃথক-http-মডিউল, প্রতি-৫মিনিটে-যাচাইকৃত (ইউজার-প্রস্তাব)
const BENCH_MAX = 128;             // v2.10.4 (ইউজার): ক্যাপ-ডাবল ৬৪→১২৮             // r-20261016m (ইউজার: 'ম্যাক্স-পর্যন্ত'): বেঞ্চ-ক্যাপ ৩২→৬৪ — ঝড়ে-অর্ধেক-মরলেও-৩২-থাকে
const SAMPLE = 400;               // candidates probed per pass (২০০→৪০০)
const BOOT_TARGET = 96;           // v2.10.4 (ইউজার): বুট-টার্গেট-ডাবল ৪৮→৯৬           // boot stops once this many exits are in (২৮→৪৮)
const POOL = [];                  // the ready bench, fastest first
const BAD = new Map();            // url -> benched-until (ms epoch)
const STATS = new Map();          // url -> {ok, fail, lat}
const AGENTS = new Map();         // url -> ProxyAgent (cached)
const INFLIGHT = new Map();       // url -> concurrent requests
let TS = 0;
let FETCHING = false;

function agentFor(u) {
  if (!ProxyAgent) throw new Error('pool-cold'); // v1.15.60: undici-নেই=প্রক্সি-ডিসপ্যাচ-অসম্ভব — সৎ-ব্যর্থতা (সরাসরি-server-IP-প্ল্যাটফর্ম-কল-কখনো-নয়)
  let a = AGENTS.get(u);
  if (!a) { a = new ProxyAgent(u); AGENTS.set(u, a); }
  return a;
}

function inflight(u) { return INFLIGHT.get(u) || 0; }

const LASTOK = new Map();         // r-20261016k (রেজলভার-মানদণ্ড): url → শেষ-প্রমাণ-কখন (চেকার-ঢেউ বা লাইভ-ট্রাফিক)
function noteGood(u, ms) {
  const s = STATS.get(u) || { ok: 0, fail: 0, lat: null };
  s.ok += 1;
  s.lat = s.lat == null ? ms : Math.round(0.6 * s.lat + 0.4 * ms);
  STATS.set(u, s);
  BAD.delete(u);
  LASTOK.set(u, Date.now());
}

function noteFail(u, kind) {
  const s = STATS.get(u) || { ok: 0, fail: 0, lat: null };
  s.fail += 1;
  STATS.set(u, s);
  BAD.set(u, Date.now() + (kind === 'block' ? 300000 : 180000)); // r-20261016a: 403→৫মিন (২০মিন-ছিল), মৃত→৩মিন — কঠোর-বেঞ্চে-MovieBox-না-খেতেই-বসে-থাকত
}

export function pick(exclude) {
  const now = Date.now();
  const el = [];
  for (const u of POOL) {
    if (exclude && exclude.has(u)) continue;
    const b = BAD.get(u);
    if (b && b > now) continue;
    const st = STATS.get(u);
    const ew = st && st.lat != null ? st.lat : 1200;   // TRAINED EWMA (ms); unproven ~= hopeful
    if (ew <= 1500) el.push({ u, ew, inf: inflight(u) });
  }
  if (!el.length) {
    for (const u of POOL) {
      if (exclude && exclude.has(u)) continue;
      const b = BAD.get(u);
      if (!b || b <= now) return u;               // least-evil fallback
    }
    return null;
  }
  el.sort((a, b) => a.ew - b.ew);                 // TRAINED: fastest first
  const top = el.slice(0, 4);
  top.sort((a, b) => a.inf - b.inf);              // spread load over the 4 fastest
  return top[0].u;
}


/** THE API TRANSPORT.  Pool-only: a cold bench waits <=2s once, then
 *  fails the call honestly — the server IP never fires a platform call.
 *  Outcome feedback keeps the bench self-training on live traffic. */
const HUBP = (process.env.POOLHUB || 'https://293c2a7d7dd6-poolhub.baby-beamup.club').replace(/\/$/, ''); // v2.10.7: ডিফল্ট=ডিপ্লয়েড-হাব
let NX_SEED_DEAD = false; // v2.10.6: বীজ-ফাইল-একবারই-সুযোগ — মৃত-প্রমাণিত-হলে-পাবলিক-স্ক্র্যাপ-স্থায়ী-পথ
const MB_REP = new Map(); // u→শেষ-/report (৬০০সে-থ্রটল)
function hubReport(u, ms) { // v2.10.6 (ইউজার: 'MovieBox আমার অ্যাপে চলে, হাবে ০ কেন?'): আসল-MB-API-পার-করা-px (probe+searchVerify-পূর্ণ-প্রমাণিত) হাবের-moviebox-সাব-স্পেসে-জমা — robots-শর্তের-চেয়ে-কঠোর-সত্য-মানদণ্ড
  if (!HUBP) return; const nw = Date.now(); if (nw - (MB_REP.get(u) || 0) < 600000) return; MB_REP.set(u, nw);
  fetch(HUBP + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ px: String(u).replace(/^https?:\/\//, ''), ok: true, ms: Math.round(ms), src: 'moviebox' }) }).catch(() => { });
} // §4-ওয়্যারিং: হাব-থাকলে-mb-স্পেসে-bench-হওয়া-px-দিয়ে-আগে (vidy-spawn-ও-এটা-বহন-করে)
let MBKEY = ''; try { // v1.15.62: সাব-স্পেস-API-কী (moviebox) — POOLHUB_KEYS=সরাসরি-JSON অথবা ফাইল-পথ (দুই-রকম-ই)
  let kb = String(process.env.POOLHUB_KEYS || '');
  try { MBKEY = String((JSON.parse(kb) || {}).moviebox || ''); } catch (e1) { try { MBKEY = String((JSON.parse(fs.readFileSync(kb, 'utf8')) || {}).moviebox || ''); } catch (e2) { } }
} catch { }
export async function apiFetch(url, options = {}) {
  if (HUBP) { // v2.10.5: MovieBox-প্ল্যাটফর্ম-কল-নিজের-moviebox-স্পেস-প্রক্সি-দিয়ে-আগে (নিজ-কী-সহ); ফাঁকা-স্পেস/ব্যর্থতা→নিজের-প্রশিক্ষিত-পুল (সৎ-ফলব্যাক)
    try {
      const hr = await fetch(HUBP + '/fetch?src=moviebox' + (MBKEY ? '&key=' + encodeURIComponent(MBKEY) : '') + '&ms=9000&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(11500) });
      const hj = await hr.json();
      if (hj && hj.ok) return new Response(String(hj.body || ''), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    } catch { }
  }
  let px = pick();
  if (!px) {
    for (let i = 0; i < 8 && !px; i++) {
      await new Promise(r => setTimeout(r, 250));
      px = pick();
    }
  }
  if (!px) throw new Error('pool-cold');
  const t0 = Date.now();
  INFLIGHT.set(px, inflight(px) + 1);
  const p = undiciFetch(url, { ...options, dispatcher: agentFor(px) });
  p.then(r => {
    if (r.status === 403 || r.status === 406) noteFail(px, 'block');
    else if (r.ok) noteGood(px, Date.now() - t0);
  }, () => {
    if (!options.signal?.aborted) noteFail(px, 'dead');  // caller abort != dead exit
  }).catch(() => {})
    .finally(() => INFLIGHT.set(px, Math.max(0, inflight(px) - 1)));
  return p;
}

/** Retry transport across DIFFERENT exits.  Returns the first
 *  transport-OK + JSON-parse-OK answer; transport errors / flags /
 *  mangled bodies rotate to the next exit.  CONTENT emptiness is the
 *  caller's verdict (a real empty needs the caller's own loop). */
const STICKY = new Map();   // TRAINED routing: url -> winning exit
const JOIN = new Map();     // mass-user single-flight: key -> shared promise

export async function fetchJsonRotating(url, headers, opts = {}) {
  const attempts = opts.poolAttempts || opts.attempts || 3;
  const ms = opts.ms || 3000;
  const hedgeMs = opts.hedgeMs == null ? 650 : opts.hedgeMs;
  const auth = (headers && (headers.Authorization || headers.authorization)) || '';
  const key = `${url}|${auth.slice(-20)}`;
  const j = JOIN.get(key);
  if (j && Date.now() - j.at < 3000) return j.pr;   // same call in flight -> share it

  let started = 0, done = 0;
  let last = { ok: false, status: 0, data: null };
  const tried = new Set();
  const aborts = new Set();

  const attempt = async () => {
    started++;
    let px = null;
    if (tried.size === 0) {                        // TRAINED affinity: the exit
      const st = STICKY.get(key);                  // that won this call before
      if (st && Date.now() - st.at < 45000 && POOL.includes(st.exit)) {
        const b = BAD.get(st.exit);
        if ((!b || b <= Date.now()) && inflight(st.exit) < 8) px = st.exit;
      }
    }
    if (!px) {
      for (let w = 0; w < 4; w++) {
        const c = pick(tried);
        if (c) { px = c; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!px) { done++; maybeAllDone(); started--; return undefined; }
    tried.add(px);
    const ac = new AbortController();
    aborts.add(ac);
    const tmr = setTimeout(() => ac.abort(), ms);
    const t0 = Date.now();
    INFLIGHT.set(px, inflight(px) + 1);
    try {
      const resp = await undiciFetch(url, {
        headers, dispatcher: agentFor(px), signal: ac.signal,
      });
      const text = await resp.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = null; }
      if (resp.status === 403 || resp.status === 406) {
        noteFail(px, 'block');
        last = { ok: false, status: resp.status, data: null };
      } else if (!resp.ok) {
        noteFail(px, 'fail');
        last = { ok: false, status: resp.status, data: null };
      } else {
        noteGood(px, Date.now() - t0);
        if (data === null) {
          noteFail(px, 'dead');                    // mangled body
          last = { ok: true, status: resp.status, data: null };
        } else if (!settled2) {
          if (STICKY.size > 400) {
            const now = Date.now();
            for (const [k, v] of STICKY) if (now - v.at > 45000) STICKY.delete(k);
          }
          STICKY.set(key, { exit: px, at: Date.now() });   // train the route
          for (const o of aborts) { try { o.abort(); } catch {} }
          const win = { ok: true, status: resp.status, data, via: px };
          settle(win);
          return win;
        } else return undefined;
      }
    } catch {
      noteFail(px, 'dead');
      last = { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(tmr);
      aborts.delete(ac);
      INFLIGHT.set(px, Math.max(0, inflight(px) - 1));
    }
    done++; maybeAllDone();
    if (!settled2) kickNext();
    return undefined;
  };
  const maybeAllDone = () => { if (!settled2 && done >= attempts) settle(last); };
  let resolveOut;
  let settled2 = false;
  const settle = (v) => { if (!settled2) { settled2 = true; resolveOut(v); } };
  const kickNext = () => { if (!settled2 && started < attempts) attempt().catch(() => {}); };
  const out = new Promise((res) => { resolveOut = res; });
  const pr = (async () => {
    attempt().catch(() => {});
    const hedge = setInterval(() => {
      if (settled2 || started >= attempts) { clearInterval(hedge); return; }
      attempt().catch(() => {});
    }, hedgeMs);
    const stop = setTimeout(() => clearInterval(hedge), ms * attempts + 500);
    try { return await out; } finally { clearInterval(hedge); clearTimeout(stop); }
  })();
  JOIN.set(key, { at: Date.now(), pr });
  pr.then(() => { if (JOIN.get(key)?.pr === pr) JOIN.delete(key); },
          () => { if (JOIN.get(key)?.pr === pr) JOIN.delete(key); });
  return pr;
}



async function probe(u) {
  const t0 = Date.now();
  try {
    const r = await undiciFetch(
      SITE + '/wefeed-h5api-bff/subject/search-suggest',
      { method: 'POST', body: JSON.stringify({ keyword: 'a', perPage: 1 }),
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        dispatcher: agentFor(u), signal: AbortSignal.timeout(5000) }); // r-20261016m2: ৬→৫সে (মৃত-দ্রুত-ছেঁটা — ঢেউ-চক্র-ছোট)
    return r.status < 400 ? [Date.now() - t0, u] : null;
  } catch { return null; }
}

/** STAGE-2 SEARCH-VERIFY: suggest can pass while the exit's search
 *  answers a lying EMPTY geo catalog.  A finalist must return >=1 row
 *  for a permanently-popular term before it earns bench membership. */
async function searchVerify(u) {
  try {
    const ts = String(Math.floor(Date.now() / 1000));
    const ct = `${ts},${crypto.createHash('md5')
      .update(ts.split('').reverse().join('')).digest('hex')}`;
    const r0 = await undiciFetch(
      SITE + '/wefeed-h5api-bff/subject/search-suggest',
      { method: 'POST', body: JSON.stringify({ keyword: 'a', perPage: 1 }),
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA,
                   'X-Client-Token': ct },
        dispatcher: agentFor(u), signal: AbortSignal.timeout(6000) });
    const xu = r0.headers.get('x-user') || '';
    const tok = (JSON.parse(xu || '{}').token) || '';
    if (!tok) return false;
    const r1 = await undiciFetch(
      SITE + '/wefeed-h5api-bff/subject/search',
      { method: 'POST',
        body: JSON.stringify({ keyword: 'conan', page: 1, perPage: 0,
                               subjectType: 0 }),
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA,
                   Authorization: `Bearer ${tok}`, Origin: SITE,
                   Referer: SITE + '/', Accept: 'application/json',
                   'X-Client-Info': '{"timezone":"Africa/Lagos"}',
                   'X-Request-Lang': 'en', 'X-Source': 'h5' },
        dispatcher: agentFor(u), signal: AbortSignal.timeout(7000) });
    const j = await r1.json().catch(() => null);
    return ((j?.data?.items || []).length) >= 1;
  } catch { return false; }
}

export async function poolOnce(force = false) {
  // v2.10.5-ফিক্স (স্টর্ম): আগে-force-ঢুকলেই __passes=1-রিসেট-হত → থিন-বেঞ্চ-চেইন (POOL<24) কখনো-শেষ-হত-না → ১০০% CPU-স্পিন (dead-seed-বুটে-প্রমাণিত)।
  // রিসেট-বাদ: __passes=undefined→1→2→3-চেইন-সীমিত; boot-এ-নতুন-POOL-অ্যারে=নতুন-গণক-স্বয়ংক্রিয়।
  if (!force && Date.now() - TS < 90000) return;   // r-20261016a: ১.৫-মিনিট-পুনঃযাচাই (ইউজার-নির্দেশ — fastest-alive bench সতেজ)
  if (FETCHING) return;
  FETCHING = true;
  TS = Date.now();
  let seeded = null;   // NX_POOL_FILE: start from a pre-trained pool file [{px:"host:port",ms}] instead of a public scrape
  try {
    if (process.env.NX_POOL_FILE && !NX_SEED_DEAD) {
      const arr = JSON.parse(fs.readFileSync(process.env.NX_POOL_FILE, 'utf8'));
      seeded = arr.map(x => ({ u: 'http://' + (x.px || String(x)), ms: Number(x.ms) || 1000 }));
      console.log(`[pool] NX_POOL_FILE: ${seeded.length} trained exits loaded`);
    }
  } catch (e) { console.error('[pool] pool-file read failed:', String(e).slice(0, 60)); seeded = null; }
  try {
    let cand;
    if (seeded) {
      cand = seeded.map(x => x.u);
    } else {
      const txts = await Promise.all(SRCS.map(u => undiciFetch(u, { signal: AbortSignal.timeout(20000) }).then(r => r.text()).catch(() => '')));
      cand = [...new Set(txts.join('\n').split('\n').map(s => s.trim())
        .filter(u => u.startsWith('http://')))];
      cand.sort(() => Math.random() - 0.5);
    }
    if (seeded) { const byU = new Map(seeded.map(x => [x.u, x.ms])); cand.sort((a, b) => (byU.get(a) || 9999) - (byU.get(b) || 9999)); }
    const sample = cand.slice(0, SAMPLE);
    // v2.7 STREAMING BOOT: every candidate runs probe->verify on its
    // own and joins the bench THE SECOND it verifies (the cold window
    // shrinks from ~35s to ~5s); waves of 60 stop early at 28 exits.
    const tested = [];
    for (let w = 0; w < sample.length && POOL.length < BOOT_TARGET; w += 60) {
      const wave = sample.slice(w, w + 180); // v2.10.4 (ইউজার): সমান্তরাল-ট্রিপল ৬০→১৮০
      const r = await Promise.all(wave.map(async (u) => {
        const p0 = await probe(u);
        if (!p0) return null;
        if (!(await searchVerify(u))) return null;
        noteGood(u, p0[0]);        // seed EWMA with the PROBE round-trip (NX_POOL_FILE exits keep their own live-trained stats)
        if (!POOL.includes(u) && POOL.length < BENCH_MAX) POOL.push(u);
        return [p0[0], u];
      }));
      tested.push(...r.filter(Boolean));
    }
    tested.sort((a, b) => a[0] - b[0]);
    const verified = tested;
    const bench = verified.map(x => x[1]);
    const prev = POOL.filter(u => !BAD.get(u) || BAD.get(u) <= Date.now());
    const merged = [...new Set([...bench, ...prev])].slice(0, BENCH_MAX);
    const rank = new Map(verified.map(([ms, u]) => [u, ms]));
    merged.sort((a, b) => (rank.get(a) ?? 99999) - (rank.get(b) ?? 99999));
    POOL.length = 0;
    POOL.push(...merged);
    for (const [ms, u] of verified) noteGood(u, ms);
    // bench-the-rest: a member that missed the bench sits out until a
    // later pass re-verifies it (re-verify = rejoin)
    for (const u of prev) {
      if (!POOL.includes(u)) BAD.set(u, Date.now() + 90000); // এক-পাস-বাদ (৯০সে) — পরের-পাসেই-পুনঃযাচাই
    }
    console.log(`[pool] bench=${POOL.length} healthy=${poolStats().healthy}`);
    if (!POOL.length && seeded) { // v2.10.6 (মূল-ফিক্স): বীজ-সম্পূর্ণ-মৃত → একবার-পাবলিক-স্ক্র্যাপ-ফলব্যাক (আগে-কখনো-হত-না → শূন্য-পুল-ডেডলক → MovieBox-০)
      NX_SEED_DEAD = true; // মডিউল-স্তরের-পতাকা — নইলে-পরের-কলে-আবার-একই-মৃত-বীজ-পড়ে=অসীম-রিকার্শন (প্রমাণিত-স্পিন)
      seeded = null;
      console.log('[pool] বীজ-মৃত → পাবলিক-স্ক্র্যাপ-ফলব্যাক');
      FETCHING = false; TS = Date.now();
      return poolOnce(true);
    }
    // thin bench right after boot -> more passes immediately (up to 3)
    if (POOL.length < 24 && POOL.__passes < 3) {
      POOL.__passes = (POOL.__passes || 0) + 1;
      FETCHING = false;
      TS = Date.now(); // v2.10.5-ফিক্স: TS=0-রাখলে-৯০সে-গার্ড-সবসময়-ভেদ-করত (stale-seed-এ-প্রতি-ঢেউয়ে-রিফিল-ঝড়=১০০% CPU-স্পিন) — এখন-গার্ড-মান্য
      return poolOnce(true);
    }
  } catch (e) {
    console.error('[pool] refresh failed:', String(e).slice(0, 80));
  } finally {
    FETCHING = false;
  }
}

// ---- r-20261016k রেজলভার-স্থাপত্য (ইউজার: 'resolver-এর-মতো কঠোর, ২৪-ঘণ্টা জাগ্রত') ----
// ৯০সে-পূর্ণ-পাসের-বদলে: সর্বদা-চলা-ঢেউ — প্রতি-১২সে-য় ১২টা সবচেয়ে-পুরনো-প্রমাণ-যার; প্রমাণ=প্রোব+MB-সার্চ-যাচাই (বেঞ্চ-মানদণ্ড-ই);
// ৬০০সে-অনুত্তপ → বেঞ্চ-কাটা (DEAD_AFTER-প্যারিটি); পাতলা-হলে ৯০সে-গার্ড-মান্য poolOnce-রিফিল (স্ট্রিমিং-ঢোকা)
let CHK = 0, chkBusy = false; // chkBusy: ঢেউ-সর্বোচ্চ ~১৩সে (probe ৬সে+verify ৭সে) > ১২সে-ব্যবধান — ওভারল্যাপে-একই-১২-পুনঃপ্রোব-নিষিদ্ধ (রেজলভারের-সিকোয়েন্সিয়াল-লুপ-প্যারিটি)
async function checkerWave() {
  if (chkBusy || FETCHING) return;
  if (!POOL.length) { // v2.10.6: শূন্য-পুল=রিফিল-ট্রিগার (আগে-খালি-ফেরত=ডেডলক — নিচের-রিফিল-লাইন-কখনো-পৌঁছাত-না)
    if (Date.now() - TS > 90000) poolOnce().catch(() => { });
    return;
  }
  chkBusy = true;
  try {
  const now = Date.now();
  // r-20261016m2 (সংশোধন — আগের-হিসাব-ভুল-ছিল): ঢেউ=সম্পূর্ণ-ব্যবহারযোগ্য-পুল (প্রতি-ঢেউয়ে-সবাই-স্ক্যান) +
  // gap ৮→৫সে + প্রোব-টাইমআউট ৬→৫সে → চক্র ~৮-১১সে → পুল-৫০-৬৪-এ ~৫০০-৮০০ স্ক্যান/১.৫মিন (ইউজার-লক্ষ্য ৭০০)
  const wave = POOL.filter(u => { const b = BAD.get(u); return !b || b <= now; })
    .sort((a, b) => (LASTOK.get(a) || 0) - (LASTOK.get(b) || 0));
  if (!wave.length) return;
  CHK++;
  let cok = 0, cblind = 0, cdead = 0;
  await Promise.all(wave.map(async (u) => {
    const p0 = await probe(u);
    if (!p0) { noteFail(u, 'dead'); cdead++; return; }        // প্রোব-ই-মরা → প্রমাণ-নেই
    if (!(await searchVerify(u))) { noteFail(u, 'block'); cblind++; return; } // জীবিত-কিন্তু-MB-অন্ধ → ৫মিন-বহিষ্কার (কঠোর-অক্ষত)
    noteGood(u, p0[0]); hubReport(u, p0[0]); cok++;                                // পূর্ণ-প্রমাণিত → LASTOK-তাজা + হাবের-moviebox-সাব-স্পেসে-সত্য-প্রমাণ
  }));
  const t2 = Date.now();
  let cut = 0;
  for (let i = POOL.length - 1; i >= 0 && POOL.length > 12; i--) { // r-20261016k: ফ্লোর ৮→১২ (বেঞ্চ-সর্বদা-মোটা)
    if (t2 - (LASTOK.get(POOL[i]) || t2) > 600000) { const du = POOL.splice(i, 1)[0]; LASTOK.delete(du); STATS.delete(du); cut++; } // ৬০০সে-কোনো-প্রমাণ-নেই
  }
  // কাটা-ইচ্ছাকৃতভাবে-ফাইলে-লেখা-হয়-না: NX_POOL_FILE=vidy-র-মূল-vidy_proxy_pool.json — লিখলে-দুই-পুল-মিশে-যেত;
  // কাটা-মেম্বার-পরের-রিফিল-পাসে-আবার-পূর্ণ-যাচাই-দিয়ে-ফিরতে-পারে (রেজলভার-গ্রোয়ার-সমতুল্য দ্বিতীয়-সুযোগ)
  const usable = POOL.filter(u => { const b = BAD.get(u); return !b || b <= Date.now(); }).length;
  if ((usable < BENCH_MAX && Date.now() - TS > 45000) || POOL.length < 20) poolOnce().catch(() => {}); // r-20261016m: ফসল-গেট ৯০→৪৫সে (ম্যাক্স-দিকে-দ্রুত), ফ্লোর ১২→২০
  if (cut || CHK % 15 === 1) console.log(`[mbchk] wave=${wave.length} ok=${cok} blind=${cblind} dead=${cdead} bench=${POOL.length} cut=${cut}`);
  } finally { chkBusy = false; }
}
export function checkerStats() { return { waves: CHK }; } // v2.10.2: CHK-তাল-বাইরে-দৃশ্যমান (server.js-/health-এর-জন্য)
function checkerStart() {
  const loop = () => { setTimeout(() => { Promise.resolve(checkerWave()).catch(() => {}).finally(loop); }, 5000); }; // r-20261016m2: gap ৮→৫সে (ঢেউ-চক্র ~৮-১১সে → সর্বোচ্চ-কম্পাঙ্ক)
  loop();
}

export function poolStart() {
  poolOnce(true);
  checkerStart(); // r-20261016k: ২৪ঘণ্টা-জাগ্রত ঢেউ (৯০সে-পূর্ণ-পাসের-বদলে — রেজলভারের-মতো; রিফিল-পাস-চেকার-থেকেই)
}

export function poolStats() {
  const now = Date.now();
  return {
    size: POOL.length,
    healthy: POOL.filter(u => !(BAD.get(u) > now)).length,
    inflight: [...INFLIGHT.entries()].filter(([, n]) => n > 0)
      .map(([u, n]) => `${u}=${n}`).slice(0, 10),
    stats: Object.fromEntries(POOL.slice(0, 12)
      .map(u => [u, STATS.get(u) || null])),
  };
}
