// NETHEX proxy pool v2.11.0 — হাব-ফিড (ইউজার: "nijer proxy pool thakbe na — store from poolhub sub space and use them")
//   - স্ক্যান/ফসল/বেঞ্চ-ঢেউ-কিছুই-নেই: POOL শুধু PoolHub-এর moviebox-সাব-স্পেস (/pick) থেকে জমা হয় (প্রতি-৬০সে)
//   - ব্যবহার: apiFetch=আগে-হাব-/fetch, তারপর-হাব-ফিডেড- exits; লাইভ-ট্রাফিকের-ফল-হাবে /report-এ ফেরত (হাব-বেঞ্চের-খাবার)
//   - TRAINED pick: হাব-ms-বীজ + লাইভ EWMA; 403/406→বেঞ্চ, মৃত→শীতল — সব-মেমোরিতে, কোনো-ফাইল-নেই
let undiciFetch = (...a) => fetch(...a), ProxyAgent = null; // v1.15.60: undici-অনুপস্থিতিতেও-বুট-হয় (নির্ভরতা-মুক্ত-ফলব্যাক)
try { ({ fetch: undiciFetch, ProxyAgent } = await import('undici')); } catch { } // থাকলে-আসল-undici (beamup-এ-স্বাভাবিক)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SITE, UA } from './upstream.js';

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
  if (!px && POOL.length === 0) poolOnce(true).catch(() => {}); // v2.11.0: শূন্য-দোকানে-তাৎক্ষণিক-হাব-ফিড-কিক
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
    else if (r.ok) { noteGood(px, Date.now() - t0); hubReport(px, Date.now() - t0); } // v2.11.1: লাইভ-জয় → হাব-প্রমাণ
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
        } else if (opts.emptyCheck && opts.emptyCheck(data)) {
          // v2.11.1c (রোগ-নির্ণয় r135): প্রতিরক্ষা-এন্ডপয়েন্টে (play/download) 200-কিন্তু-খালি = আসল-উত্তর-নয়
          // (রেট/জিও-জানালা) — রেস-থামবে-না, স্টিকি-হবে-না: পরের-exit-এ-ঘুরে-আরও-চেষ্টা
          last = { ok: true, status: resp.status, data };
        } else if (!settled2) {
          if (STICKY.size > 400) {
            const now = Date.now();
            for (const [k, v] of STICKY) if (now - v.at > 45000) STICKY.delete(k);
          }
          STICKY.set(key, { exit: px, at: Date.now() });   // train the route
          hubReport(px, Date.now() - t0); // v2.11.1: লাইভ-জয় → হাবের-moviebox-স্পেসে-প্রমাণ (own-চক্র-বাঁচায় — ঢেউ-নেই-বলে-এটাই-এখন-একমাত্র-খাবার)
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
    // v2.11.1 (রোগ-নির্ণয় r134): হাব-প্রথম — হাবের /fetch তার moviebox-স্পেস (/report-প্রমাণিত)-দিয়ে-রেস-করে;
    // সফল-হলে-নিজের-exit-ঘোরানোই-লাগে-না।
    // v2.11.1b সংশোধন: হাব-/fetch GET-only — Authorization-বহন-করতে-পারে-না; play/download/caption
    // (MovieBox-এখন-টোকেন-চায় — টোকেনহীন=ok-কিন্তু-খালি!) হাব-দিয়ে-গেলে-বিষ-খালি-উত্তর-ফেরে → ওগুলো-শুধু-নিজের-exit-এ (টোকেন-সহ)
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
  // v2.11.0 (ইউজার): পাবলিক-স্ক্র্যাপ/NX_POOL_FILE-বীজ/প্রোব-যাচাই-সব-বাদ — একমাত্র-উৎস PoolHub moviebox-সাব-স্পেস
  if (!HUBP) return;
  if (!force && Date.now() - TS < 60000) return;
  if (FETCHING) return;
  FETCHING = true; TS = Date.now();
  try {
    const r = await fetch(HUBP + '/pick?src=moviebox&n=40&cb=' + Date.now() + (MBKEY ? '&key=' + encodeURIComponent(MBKEY) : ''), { signal: AbortSignal.timeout(8000) }); // cb=nginx-ক্যাশ-ভেদ
    const j = await r.json();
    if (!j || !Array.isArray(j.pick)) return;
    // v2.11.1 (রোগ-নির্ণয় r134): own=true = হাবের-moviebox-স্পেসের /report-প্রমাণিত-সদস্য — এরাই-প্রথম;
    // বাকি-হাব-পিক = ব্যাকআপ (EWMA-বীজ-ধীর → pick()-এ-পিছনে); পুরনো-সদস্য-যাদের-সাম্প্রতিক-লাইভ-প্রমাণ (৬০০সে) — রেখে-দেওয়া
    const own = j.pick.filter(p => p.own), rest = j.pick.filter(p => !p.own);
    const now2 = Date.now();
    // keep = বেঞ্চ-বহিষ্কৃত-নয় + ৬০০সে-র-মধ্যে-লাইভ-প্রমাণ-আছে (জানা-ভালো-সদস্য-হারানো-নয়)
    const keep = POOL.filter(u => {
      const b = BAD.get(u);
      if (b && b > now2) return false;
      return now2 - (LASTOK.get(u) || 0) < 600000;
    });
    const next = [];
    const add = (p, lat) => {
      const u = 'http://' + p.px;
      if (next.includes(u) || next.length >= BENCH_MAX) return;
      next.push(u);
      if (!STATS.get(u)) STATS.set(u, { ok: 1, fail: 0, lat: Number(p.ms) || lat });
      if (!LASTOK.has(u)) LASTOK.set(u, Date.now());
    };
    own.forEach(p => add(p, 800));     // প্রমাণিত — দ্রুত-বীজ
    keep.forEach(u => { if (!next.includes(u) && next.length < BENCH_MAX) next.push(u); });
    rest.forEach(p => add(p, 2600));   // ব্যাকআপ — ধীর-বীজ (লাইভে-প্রমাণ-করলে-ওঠবে)
    POOL.length = 0; POOL.push(...next);
    FEEDS++;
    console.log(`[হাব-ফিড] moviebox bench=${POOL.length} (own=${own.length} রাখা=${keep.length} ব্যাকআপ=${rest.length})`);
  } catch (e) { } finally { FETCHING = false; }
}

// ---- r-20261016k রেজলভার-স্থাপত্য (ইউজার: 'resolver-এর-মতো কঠোর, ২৪-ঘণ্টা জাগ্রত') ----
// ৯০সে-পূর্ণ-পাসের-বদলে: সর্বদা-চলা-ঢেউ — প্রতি-১২সে-য় ১২টা সবচেয়ে-পুরনো-প্রমাণ-যার; প্রমাণ=প্রোব+MB-সার্চ-যাচাই (বেঞ্চ-মানদণ্ড-ই);
// ৬০০সে-অনুত্তপ → বেঞ্চ-কাটা (DEAD_AFTER-প্যারিটি); পাতলা-হলে ৯০সে-গার্ড-মান্য poolOnce-রিফিল (স্ট্রিমিং-ঢোকা)
export function checkerStats() { return { waves: FEEDS }; } // v2.11.0: waves=হাব-ফিড-চক্র-গণক (পুরনো-স্ক্যান-ঢেউ-নেই)

export function poolStart() {
  poolOnce(true); // v2.11.0: বুটেই-হাব-ফিড
  setInterval(() => { poolOnce(true).catch(() => {}); }, 60000).unref(); // প্রতি-৬০সে-হাব-পিক-রিফিল
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
