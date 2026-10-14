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
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SITE, UA } from './upstream.js';

const SRC = 'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text';
const BENCH_MAX = 32;
const SAMPLE = 200;               // candidates probed per pass
const BOOT_TARGET = 28;           // boot stops once this many exits are in
const POOL = [];                  // the ready bench, fastest first
const BAD = new Map();            // url -> benched-until (ms epoch)
const STATS = new Map();          // url -> {ok, fail, lat}
const AGENTS = new Map();         // url -> ProxyAgent (cached)
const INFLIGHT = new Map();       // url -> concurrent requests
let TS = 0;
let FETCHING = false;

function agentFor(u) {
  let a = AGENTS.get(u);
  if (!a) { a = new ProxyAgent(u); AGENTS.set(u, a); }
  return a;
}

function inflight(u) { return INFLIGHT.get(u) || 0; }

function noteGood(u, ms) {
  const s = STATS.get(u) || { ok: 0, fail: 0, lat: null };
  s.ok += 1;
  s.lat = s.lat == null ? ms : Math.round(0.6 * s.lat + 0.4 * ms);
  STATS.set(u, s);
  BAD.delete(u);
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
export async function apiFetch(url, options = {}) {
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
        dispatcher: agentFor(u), signal: AbortSignal.timeout(6000) });
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
  if (force) POOL.__passes = 1;                     // boot/fresh-wave
  if (!force && Date.now() - TS < 90000) return;   // r-20261016a: ১.৫-মিনিট-পুনঃযাচাই (ইউজার-নির্দেশ — fastest-alive bench সতেজ)
  if (FETCHING) return;
  FETCHING = true;
  TS = Date.now();
  let seeded = null;   // NX_POOL_FILE: start from a pre-trained pool file [{px:"host:port",ms}] instead of a public scrape
  try {
    if (process.env.NX_POOL_FILE) {
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
      const r = await undiciFetch(SRC, { signal: AbortSignal.timeout(20000) });
      cand = (await r.text()).split('\n').map(s => s.trim())
        .filter(u => u.startsWith('http://'));
      cand.sort(() => Math.random() - 0.5);
    }
    if (seeded) { const byU = new Map(seeded.map(x => [x.u, x.ms])); cand.sort((a, b) => (byU.get(a) || 9999) - (byU.get(b) || 9999)); }
    const sample = cand.slice(0, SAMPLE);
    // v2.7 STREAMING BOOT: every candidate runs probe->verify on its
    // own and joins the bench THE SECOND it verifies (the cold window
    // shrinks from ~35s to ~5s); waves of 60 stop early at 28 exits.
    const tested = [];
    for (let w = 0; w < sample.length && POOL.length < BOOT_TARGET; w += 60) {
      const wave = sample.slice(w, w + 60);
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
    // thin bench right after boot -> more passes immediately (up to 3)
    if (POOL.length < 24 && POOL.__passes < 3) {
      POOL.__passes = (POOL.__passes || 0) + 1;
      FETCHING = false;
      TS = 0;
      return poolOnce(true);
    }
  } catch (e) {
    console.error('[pool] refresh failed:', String(e).slice(0, 80));
  } finally {
    FETCHING = false;
  }
}

export function poolStart() {
  poolOnce(true);
  setInterval(() => poolOnce(), 90000); // r-20261016a: প্রতি-১.৫-মিনিট
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
