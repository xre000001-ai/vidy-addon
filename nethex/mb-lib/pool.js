// NETHEX proxy pool v2.11.0 — // NETHEX proxy pool v2.11 — hub-fed (user: "no proxy pool of its own — store from the PoolHub sub-space and use them")
//   - //   - no scanning/harvest/checker waves at all: POOL fills only from PoolHub's moviebox sub-space (/pick, every 60s)
//   - //   - use: apiFetch = own proven slots first, hub relay as backup; live wins report back to hub /report (feeds the hub bench)
//   - TRAINED pick: //   - TRAINED pick: hub-ms seed + live EWMA; 403/406 -> bench, dead -> cooldown — all in memory, no files
let undiciFetch = (...a) => fetch(...a), ProxyAgent = null; // v1.15.60: undici-// v1.15.60: boots even without undici (dependency-free fallback)
try { ({ fetch: undiciFetch, ProxyAgent } = await import('undici')); } catch { } // // real undici when present (normal on beamup)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { API, SITE, UA } from './upstream.js';

const BENCH_MAX = 128;             // v2.10.4 (// v2.10.4 (user): cap doubled 64->128 — half the storm can die and 64 still stand
const SAMPLE = 400;               // candidates probed per pass (// candidates probed per pass (200->400)
const BOOT_TARGET = 96;           // v2.10.4 (// v2.10.4 (user): boot target doubled 48->96
const POOL = [];                  // the ready bench, fastest first
const BAD = new Map();            // url -> benched-until (ms epoch)
const STATS = new Map();          // url -> {ok, fail, lat}
const AGENTS = new Map();         // url -> ProxyAgent (cached)
const INFLIGHT = new Map();       // url -> concurrent requests
let TS = 0;
let FETCHING = false;

function agentFor(u) {
  if (!ProxyAgent) throw new Error('pool-cold'); // v1.15.60: undici-// v1.15.60: no undici = proxy dispatch impossible — honest failure (never a direct server-IP platform call)
  let a = AGENTS.get(u);
  if (!a) { a = new ProxyAgent(u); AGENTS.set(u, a); }
  return a;
}

function inflight(u) { return INFLIGHT.get(u) || 0; }

const LASTOK = new Map();
const ADDED = new Map();          // v2.11.3: url → // v2.11.3: url -> time added (grace window; no fake proof) // r-20261016k (resolver standard): url -> last any proof
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
  BAD.set(u, Date.now() + (kind === 'block' ? 300000 : 180000)); // r-20261016a: 403→// r-20261016a: 403 -> 5min (was 20), dead -> 3min — a hard bench used to starve MovieBox
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
const HUBP = (process.env.POOLHUB || 'https://293c2a7d7dd6-poolhub.baby-beamup.club').replace(/\/$/, ''); // v2.10.7: // v2.10.7: default = deployed hub
const MB_REP = new Map(); // u→// u -> last /report (600s throttle)
function hubReport(u, ms) { // v2.10.6 (// v2.10.6 (user: "MovieBox plays in my app, why 0 in the hub?"): a px proven to pass the real MB API gets reported into the hub moviebox sub-space — stricter and truer than robots
  if (!HUBP) return; const nw = Date.now(); if (nw - (MB_REP.get(u) || 0) < 600000) return; MB_REP.set(u, nw);
  fetch(HUBP + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ px: String(u).replace(/^https?:\/\//, ''), ok: true, ms: Math.round(ms), src: 'moviebox' }) }).catch(() => { });
} // §4-// §4 wiring: with a hub present, feed the mb space with benched px first (the vidy spawn carries this too)
let MBKEY = ''; try { // v1.15.62: // v1.15.62: sub-space API key (moviebox) — POOLHUB_KEYS = raw JSON or a file path (both work)
  let kb = String(process.env.POOLHUB_KEYS || '');
  try { MBKEY = String((JSON.parse(kb) || {}).moviebox || ''); } catch (e1) { try { MBKEY = String((JSON.parse(fs.readFileSync(kb, 'utf8')) || {}).moviebox || ''); } catch (e2) { } }
} catch { }
let HUB_FAILS = 0, HUB_SKIP_UNTIL = 0; // v2.11.4 // v2.11.4 circuit breaker: bypass the hub relay for 60s when the hub space is stale
export async function apiFetch(url, options = {}) {
  // v2.11.4 (// v2.11.4 (user: "first try, always a proxy in the slot"): own slots first — the roster comes from the hub /pick anyway
  // (r136-// (r136 architecture); the hub relay only when own slots are exhausted (a 4.5s cost is an acceptable backup when the hub space is stale)
  if (poolHealthy() === 0) await coldGate(); // // never send a slot to an unproven proxy — the gate = the active bench
  let px = pick();
  if (!px && POOL.length === 0) poolOnce(true).catch(() => {}); // // instant hub-feed kick on an empty store
  if (!px) {
    for (let i = 0; i < 6 && !px; i++) { await new Promise(r => setTimeout(r, 250)); px = pick(); }
  }
  if (px) {
    const t0 = Date.now();
    INFLIGHT.set(px, inflight(px) + 1);
    const p = undiciFetch(url, { ...options, dispatcher: agentFor(px) });
    p.then(r => {
      if (r.status === 403 || r.status === 406) noteFail(px, 'block');
      else if (r.ok) { noteGood(px, Date.now() - t0); hubReport(px, Date.now() - t0); } // // live win -> hub proof
    }, () => { if (!options.signal?.aborted) noteFail(px, 'dead'); }).catch(() => {})
      .finally(() => INFLIGHT.set(px, Math.max(0, inflight(px) - 1)));
    return p;
  }
  if (HUBP && Date.now() >= HUB_SKIP_UNTIL) { // // own slots exhausted -> hub relay (4.5s budget, n=8, 2 failures = 60s bypass)
    try {
      const hr = await fetch(HUBP + '/fetch?src=moviebox' + (MBKEY ? '&key=' + encodeURIComponent(MBKEY) : '') + '&ms=4500&n=8&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(6000) });
      const hj = await hr.json();
      if (hj && hj.ok) { HUB_FAILS = 0; return new Response(String(hj.body || ''), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }); }
      throw new Error('hub-empty');
    } catch {
      if (++HUB_FAILS >= 2) { HUB_SKIP_UNTIL = Date.now() + 60000; HUB_FAILS = 0; console.log('[hub-bypass] 60s — own slots are primary'); }
    }
  }
  throw new Error('pool-cold'); // // honest failure: never a direct server-IP platform call
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
        } else if (opts.emptyCheck && opts.emptyCheck(data)) {
          // v2.11.1c (// v2.11.1c (r135 diagnosis): on defense endpoints (play/download) 200-but-empty is not a real answer
          // (// (rate/geo window) — the race must not stop, nothing sticks: rotate to the next exit and try more
          last = { ok: true, status: resp.status, data };
        } else if (!settled2) {
          if (STICKY.size > 400) {
            const now = Date.now();
            for (const [k, v] of STICKY) if (now - v.at > 45000) STICKY.delete(k);
          }
          STICKY.set(key, { exit: px, at: Date.now() });   // train the route
          hubReport(px, Date.now() - t0); // v2.11.1: // v2.11.1: live win -> proof in the hub moviebox space (keeps the own-cycle alive — with no waves this is the only food)
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
    // v2.11.1 (// v2.11.1 (r134 diagnosis): hub first — the hub /fetch races its moviebox space (/report-proven);
    // // on success there is no need to rotate own exits.
    // v2.11.1b // v2.11.1b fix: hub /fetch is GET-only — it cannot carry Authorization; play/download/caption
    // (MovieBox-// (MovieBox now wants a token — tokenless = ok-but-empty!) through the hub returns a poisoned empty -> those go only via own exits (with the token)
    if (HUBP && !/\/subject\/(play|download|caption)/.test(url)) {
      try {
        const hr = await fetch(HUBP + '/fetch?src=moviebox' + (MBKEY ? '&key=' + encodeURIComponent(MBKEY) : '') + '&ms=9000&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(11500) });
        const hj = await hr.json();
        if (hj && hj.ok) {
          let hd = null; try { hd = JSON.parse(hj.body); } catch { }
          if (hd !== null) { const w = { ok: true, status: 200, data: hd, via: 'hub' }; settle(w); return w; }
        }
      } catch { }
    }
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



let FEEDS = 0;
export async function poolOnce(force = false) {
  // v2.11.0 (// v2.11.0 (user): public scrapes / NX_POOL_FILE seeds / probe-verification all dropped — the only source is the PoolHub moviebox sub-space
  if (!HUBP) return;
  if (!force && Date.now() - TS < 60000) return;
  if (FETCHING) return;
  FETCHING = true; TS = Date.now();
  try {
    const r = await fetch(HUBP + '/pick?src=moviebox&n=40&cb=' + Date.now() + (MBKEY ? '&key=' + encodeURIComponent(MBKEY) : ''), { signal: AbortSignal.timeout(8000) }); // cb=nginx-// cb busts the nginx cache
    const j = await r.json();
    if (!j || !Array.isArray(j.pick)) return;
    // v2.11.1 (// v2.11.1 (r134 diagnosis): own=true = /report-proven members of the hub moviebox space — they go first;
    // // the rest of the hub pick = backup (slow EWMA seed -> behind in pick()); old members with live proof within 600s are kept
    const own = j.pick.filter(p => p.own), rest = j.pick.filter(p => !p.own);
    const now2 = Date.now();
    // keep = // keep = not bench-expelled + live proof within 600s (do not lose known-good members)
    const keep = POOL.filter(u => { // v2.11.3: // v2.11.3: real proof (600s) or a newcomer's 900s proof window
      const b = BAD.get(u);
      if (b && b > now2) return false;
      return now2 - (LASTOK.get(u) || 0) < 600000 || now2 - (ADDED.get(u) || now2) < 900000;
    });
    const next = [];
    const add = (p, lat) => {
      const u = 'http://' + p.px;
      if (next.includes(u) || next.length >= BENCH_MAX) return;
      next.push(u);
      if (!STATS.get(u)) STATS.set(u, { ok: 1, fail: 0, lat: Number(p.ms) || lat });
      // v2.11.3 // v2.11.3 honesty: no fake LASTOK seed for newcomers (unproven = unproven) — grace time lives in ADDED
      if (!ADDED.has(u)) ADDED.set(u, Date.now());
    };
    own.forEach(p => add(p, 800));     // // proven — fast seed
    keep.forEach(u => { if (!next.includes(u) && next.length < BENCH_MAX) next.push(u); });
    rest.forEach(p => add(p, 2600));   // // backup — slow seed (climbs when it proves itself live)
    POOL.length = 0; POOL.push(...next);
    FEEDS++;
    console.log(`['[hub-feed] moviebox bench=${POOL.length} (own=${own.length} kept=${keep.length} backup=${rest.length})`);
  } catch (e) { } finally { FETCHING = false; }
}

// ---- r-20261016k // ---- r-20261016k resolver architecture (user: "resolver-grade, awake 24h") ----
// // instead of a 90s full pass: an always-running wave — every 12s re-prove the 12 oldest; proof = probe + MB search verify (the bench criterion itself);
// // 600s unanswered -> bench cut (DEAD_AFTER parity); when thin, a 90s-guarded poolOnce refill (streaming intake)
export function checkerStats() { return { waves: FEEDS }; } // v2.11.0: waves=// v2.11.0: waves = hub-feed cycle counter (no old scan waves)

// ---- v2.11.3 (// ---- v2.11.3 (user: "first try, always a proxy in the slot") ----
// // the first tap must never be the proof-discoverer: in a cold window the platform call first
// // proves the roster through the active bench (parallel, ~2-4s), then every slot gets a
// // proven proxy. The hub path sits outside the gate (if the hub is alive, the first tap wins there).
export function poolHealthy() { // // count of truly proven + alive members
  const now = Date.now();
  return POOL.filter(u => !(BAD.get(u) > now) && now - (LASTOK.get(u) || 0) < 600000).length;
}

let BENCHING = false;
export async function benchWave(n = 14, ms = 2800) { // // parallel proof: search-suggest 200 + JSON = proof (apiFetch bypass — no recursion)
  if (BENCHING || !ProxyAgent || !POOL.length) return 0;
  BENCHING = true;
  try {
  const now = Date.now();
  const cands = POOL.filter(u => !(BAD.get(u) > now) && (now - (LASTOK.get(u) || 0) > 300000)).slice(0, n);
  let good = 0;
  if (cands.length) {
    const tok = (() => { const t = String(Math.floor(Date.now() / 1000)); return t + ',' + crypto.createHash('md5').update(t.split('').reverse().join('')).digest('hex'); })();
    await Promise.all(cands.map(u => new Promise(res => { // v2.11.4: // v2.11.4: true criterion = mintToken's real POST; the x-user token = full proof (play eligibility)
      const t0 = Date.now();
      undiciFetch(`${API}/wefeed-h5api-bff/subject/search-suggest`, {
        method: 'POST',
        headers: { 'user-agent': UA, 'x-client-token': tok, 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: 'a', perPage: 10 }),
        dispatcher: agentFor(u), signal: AbortSignal.timeout(ms),
      }).then(r => {
        if (r.status === 403 || r.status === 406) { noteFail(u, 'block'); return; }
        if (r.ok && r.headers.get('x-user')) { noteGood(u, Date.now() - t0); hubReport(u, Date.now() - t0); good++; }
        else noteFail(u, r.ok ? 'dead' : 'fail');
      }, () => noteFail(u, 'dead')).finally(res);
    })));
    if (good) console.log(`['[bench] proven +${good}/${cands.length} (healthy=${poolHealthy()})`);
  }
  return good;
  } finally { BENCHING = false; }
}

let GATE = null;
async function coldGate(waitMs = 5000, need = 3) { // // single-flight: the first cold call waits for proof; later calls share it
  if (!ProxyAgent || !POOL.length) return; // undici-// no undici/empty store: waiting at the gate is pointless — fail honestly
  if (poolHealthy() >= need) return;
  if (!GATE) {
    GATE = (async () => {
      const t0 = Date.now();
      let kicked = false;
      while (Date.now() - t0 < waitMs && poolHealthy() < need) {
        if (!kicked) { kicked = true; benchWave().catch(() => { }); }
        await new Promise(r => setTimeout(r, 300));
      }
      if (poolHealthy() < need) await benchWave(6, 2500).catch(() => { }); // // last attempt
    })().finally(() => { setTimeout(() => { GATE = null; }, 1500); });
  }
  await GATE;
}

export function poolStart() {
  poolOnce(true) // v2.11.0: // v2.11.0: hub-feed at boot -> the active bench right after the feed lands (polling kick — no fixed delay)
    .then(() => { const kick = () => { if (POOL.length) return benchWave(16).catch(() => { }); setTimeout(kick, 200); }; kick(); }).catch(() => { });
  setInterval(() => { // // 60s refill; a thin roster never goes un-benched
    poolOnce(true).then(() => { if (poolHealthy() < 8) return benchWave(16).catch(() => { }); }).catch(() => { });
  }, 60000).unref();
  // v2.11.5 (// v2.11.5 (user: "5 seconds total"): keep-hot — the old fast-era magic (8s waves, median 2.44s,
  // // fastest 152ms) in hub-roster form: re-prove the 8 oldest slots every 120s -> no slot ever
  // // crosses the 300s staleness -> the gate never blocks, every step rides a warm slot (~0.3-1.2s).
  setInterval(() => { benchWave(8, 2500).catch(() => { }); }, 120000).unref();
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
