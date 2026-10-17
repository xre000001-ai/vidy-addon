// Vidy addon — stream-only Stremio/Nuvio addon (vidy.st sources)
// স্থাপত্য: token/seed ফেচে 429-হলে trained-proxy hedge-race; স্ট্রিম-বাইট ইউজার সরাসরি CDN থেকে
// Nuvio/Node-নিরাপদ: AbortSignal নেই — সব টাইমআউট Promise.race/setTimeout-ভিত্তিক
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const VERSION = '1.15.66';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const VIDY_REFERER = 'https://www.vidy.st/';
const API = 'https://api.wecollege.net';
const TMDBP = 'https://db.wecollege.net/3';
function tmdbGet(path, timeoutMs) { // v1.13.7 IMDb/ফ্রি-পাবলিক-প্রথম: অফিসিয়াল api.themoviedb.org (এমবেডেড-পাবলিক-কী) আগে — আয়না (db.wecollege.net) ধীর/ডাউন-হলে-ফলব্যাক
  return pooledGet('https://api.themoviedb.org/3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + TMDBK, timeoutMs)
    .catch(() => pooledGet(TMDBP + path, timeoutMs));
}
const CINEMETA = 'https://v3-cinemeta.strem.io';
const SERVERS = ['miami', 'atlanta', 'seattle', 'boise', 'phoenix', 'dallas', 'austin', 'delhi', 'munich', 'cancun', 'vegas', 'oakland', 'orlando', 'paris', 'reno', 'tampa']; // full server family — 7 veterans + 9 discovered from the official player bundle (live-probed)
const GIANT = ['miami', 'boise', 'atlanta']; // giant primaries — carry ~32 sources across a 12-title sample (new servers top out at ~13, measured 10-11 Oct 2026)
let POOL = [];
try { POOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_proxy_pool.json'), 'utf8')); } catch (e) {}
// v1.15.0 রানটাইম-প্রক্সি-স্বাস্থ্য: বুট-সময়ের-ms-আর-বাস্তব-নয় — জয়/ব্যর্থতা/EMA-লেটেন্সি-মনে-থাকে, রেস-স্কোর-অনুযায়ী-হয়
const PX_RUN = new Map(); // px → { ok, fail, ms, last }
const PX_LASTOK = new Map(); // v1.15.16 (রেজলভার-মানদণ্ড): px → শেষ-যেকোনো-প্রমাণ (চেকার/প্রোব)
// v1.15.55 A3 blackout-গভর্নর: শেষ-৬০-ফলে ≥৯০%-ব্যর্থ (≥৩০-নমুনা) = সিস্টেমিক-বিপর্যয় (আজকের-১৬/১৬-মৃত-উইন্ডোর-মতো) → ব্যর্থতা-লেখা-স্থগিত (গণনা-চলে; নির্দোষ-ভালো-px-ভুল-শাস্তি-পায়-না); <৫০%-হলে-স্বাভাবিক
const PX_GLOB = { ring: [] };
function pxBlackout() { const r = PX_GLOB.ring; if (r.length < 30) return false; let f = 0; for (const g of r) if (!g) f++; const fr = f / r.length; return fr >= 0.9 ? 1 : (fr < 0.5 ? 0 : -1); }
function pxRec(px, good, ms, srcKey) { // v1.15.56: srcKey-দিলে-ওই-সোর্সের-স্পেসও-আপডেট (জয়=তোলা, ব্যর্থ=নামা)
  PX_GLOB.ring.push(good ? 1 : 0); if (PX_GLOB.ring.length > 60) PX_GLOB.ring.shift();
  if (good) PX_LASTOK.set(px, Date.now());
  const h = PX_RUN.get(px) || { ok: 0, fail: 0, ms: 0, last: 0 };
  if (good) { h.ok++; h.ms = h.ms ? Math.round(h.ms * 0.7 + ms * 0.3) : ms; }
  else if (pxBlackout() === 1) { /* blackout-স্থগিত — দোষ-লেখা-নয় */ }
  else h.fail++;
  h.last = Date.now();
  PX_RUN.set(px, h);
  if (srcKey && PX_SPACES[srcKey]) { const SP = PX_SPACES[srcKey]; if (good) { SP.set.add(px); SP.ts.set(px, Date.now()); pxSpaceSave(); } else { SP.set.delete(px); pxSpaceSave(); } }
}
function pxScore(px, bootMs) { // কম-ভালো; ব্যর্থতা-ভারী-প্রক্সি-পিছিয়ে, নিখরচয়ী-এগিয়ে
  const h = PX_RUN.get(px);
  if (!h) return bootMs || 9999;
  let sc = h.ms || bootMs || 9999;
  if (h.fail && !h.ok) sc += 8000; // কখনো-জেতেনি, বারবার-মরে
  sc += h.fail * 400 - Math.min(h.ok, 8) * 120;
  return sc;
}
// v1.15.0 পুল-প্রোব: বুটে+প্রতি-৫মিনিটে-সব-px-সমান্তরালে-হালকা-২০৪-প্রোব — তাজা-লেটেন্সি-পুলে-লেখা,
// প্রমাণিত-মৃত-বাদ (ফাইল-অক্ষত — রিবুটে-আবার-সুযোগ); পুল-কখনো-খালি-হয়-না (সব-মরলে-পুরনো-তালিকাই-থাকে)
const PX_PROBE_URL = 'https://www.google.com/generate_204';
// v1.15.0 উষ্ণ-সংযোগ: রেজলভার(TW/RT)+MovieBox-চাইল্ড-সকেট-জীবন্ত-রাখা — প্রতি-ট্যাপে-DNS+TLS (~০.৩-০.৬সে) বাদ;
// 'রেজলভারে-পৌঁছাতে-দেরি'-র-ভিডি-পার্শ্ব-অংশ-এটাই-ছিল। keepAlive-এজেন্ট-পুনঃব্যবহার-করে।
function warmBases() {
  for (const b of [TWBASE, RTBASE, NEXBASE]) {
    if (!b) continue;
    directGet(b + '/_health', 8000).catch(() => {});
  }
}
function probePool() {
  if (!POOL.length) return;
  const snap = POOL.slice();
  let doneN = 0;
  for (const c of snap) {
    const t0 = Date.now();
    proxiedGet(c.px, PX_PROBE_URL, 4000).then(() => {
      pxRec(c.px, true, Date.now() - t0);
      c.ms = Date.now() - t0;
      if (++doneN === snap.length) prunePool(snap);
    }).catch(() => {
      pxRec(c.px, false, 0);
      if (++doneN === snap.length) prunePool(snap);
    });
  }
}
function prunePool(snap) {
  const good = snap.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; });
  const alive = good.length >= 3 ? good : snap; // সব-মরলে-তালিকা-ধরে-রাখো (রিবুটে-আবার-চেষ্টা)
  POOL.length = 0;
  for (const c of alive) POOL.push(c);
  if (DBG) console.error('[pool] probe: ' + alive.length + '/' + snap.length + ' জীবিত');
}
// v1.15.16 রেজলভার-স্থাপত্য (ইউজার: 'vidy-ও resolver-এর-মতো কঠোর, ২৪ঘণ্টা জাগ্রত'):
// প্রতি-১২সে-য় ১২টা সবচেয়ে-পুরনো-প্রমাণ; প্রমাণ-সিঁড়ি: vidy.st-নিজেই খোলা=পূর্ণ (রেজলভার _TARGETS-প্যারিটি);
// জীবিত-কিন্তু-সাইট-অন্ধ=স্পেয়ার (থাকে, স্কোর-জরিমানায়-পিছিয়ে); Google-204-ও-মরা=প্রমাণহীন → ৬০০সে-কাটা → এনরিচ
const PX_SITE_URL = VIDY_REFERER; // টার্গেট-সাইট-নিজেই
const PX_SITE = new Set(); // v1.15.17 বেঞ্চ-মানদণ্ড (ইউজার): বেঞ্চ = সাইটে-যেতে-পারে + জীবিত — চেকার-ই-একমাত্র-কর্তৃত্ব (রেস-জয়/Google-204 সাইট-প্রমাণ-নয়)
const PX_MISS = new Map(); // v1.15.21 কম্পন-সহনশীলতা: সাইট-উত্তর-পাতলা/CF-পাতা = ২-টানা-ব্যর্থতায়-নামা (১-বারে-বেঞ্চ-দোলে-নয়; হার্ড-ব্যর্থ=তাৎক্ষণিক)
const PX_COOL = new Map(); // v1.15.16b: পূর্ণ-মৃত → ১২০সে-শীতল (রেজলভার-প্যারিটি — একই-১২-মৃত-ঢেউয়ে-ঢেউয়ে-পিটানো-বন্ধ; ৬০০সে-কাটার-আগে-৫-সুযোগ)
// v1.15.56 ইউনিভার্সাল-পুল (ইউজার-নকশা): একটাই-ভাণ্ডার (POOL) + প্রতি-সোর্সের-আলাদা-'স্পেস' — যে-px-যে-সোর্সে-সত্যিই-কাজ-করে সেই-স্পেসে-তোলা-হয়; রেসে-আগে-নিজের-স্পেস। স্থায়ী-ফাইল-একটাই, ভেতরে-সোর্সভেদ-আলাদা-ভাগ (ইউজার: 'alada alada space')
const PX_API = new Set(); // স্পেস 'api' — আসল-কাজ (seed-API; R2: TTL-ক্যাশে-প্রোব-খরচ≈শূন্য)
const PX_VB = new Set(); // স্পেস 'vb' — vidbolt.xyz-রেজলভ
const PX_WO = new Set(); // স্পেস 'wo' — vidout-পাইপলাইন
const PX_API_URL = API + '/seed?mediaId=95350';
const PX_SPACES = {
  site: { url: 'https://www.vidy.st/robots.txt', min: 80, set: PX_SITE, ts: new Map() }, // v1.15.55 A1 (R1: ১০৬B; প্রতি-৩২-ঢেউয়ে-পূর্ণ-হোমপেজ-থরোফে)
  api: { url: PX_API_URL, min: 30, set: PX_API, ts: new Map() },
  vb: { url: 'https://vidbolt.xyz/', min: 200, set: PX_VB, ts: new Map() },
  wo: { url: 'https://vidout.pages.dev/', min: 200, set: PX_WO, ts: new Map() }
};
const PX_SITE_TS = PX_SPACES.site.ts;
const PXSRC_FILE = path.join(__dirname, 'vidy_px_sources.json');
try {
  let oS = null; try { oS = JSON.parse(fs.readFileSync(PXSRC_FILE, 'utf8')); } catch (e2) { }
  if (!oS) { try { oS = { site: JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_px_site.json'), 'utf8')) }; } catch (e3) { oS = {}; } } // .55-ফাইল-মাইগ্রেশন
  const nowPX = Date.now();
  for (const sk of Object.keys(PX_SPACES)) for (const px of Object.keys(oS[sk] || {})) if (nowPX - oS[sk][px] < 600000) { PX_SPACES[sk].set.add(px); PX_SPACES[sk].ts.set(px, oS[sk][px]); }
} catch (e) { }
let PXSRC_T = null;
function pxSpaceSave() { if (PXSRC_T) return; PXSRC_T = setTimeout(() => { PXSRC_T = null; const o = {}; for (const sk of Object.keys(PX_SPACES)) { o[sk] = {}; for (const px of PX_SPACES[sk].set) o[sk][px] = PX_SPACES[sk].ts.get(px) || Date.now(); } try { fs.writeFileSync(PXSRC_FILE, JSON.stringify(o)); } catch (e) { } }, 3000); }
// ── v1.15.62 মিরর (ইউজার: 'poolhub-e store kora benched proxy gulo nijer ekhane joma kore rakbe and use korbe') ──
// প্রতি-৬০সে: নিজ-নিজ-API-কী-দিয়ে-হাবের-/pick → নিজের-ভাণ্ডারে (POOL)+স্থানীয়-স্পেসে-জমা → রেস/বেঞ্চ-সব-স্থানীয়-পথেই-ব্যবহার; স্ন্যাপশট vidy_px_mirror.json
const MIRROR_FILE = path.join(__dirname, 'vidy_px_mirror.json');
const MIRROR = {}; try { const oM = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8')); for (const kM of Object.keys(oM)) MIRROR[kM] = oM[kM]; } catch (e) { }
let MIRR_B = false;
async function hubMirror() {
  if (!HUB || MIRR_B) return; MIRR_B = true;
  try {
    for (const sp of ['toonworld4all', 'raretoons', 'vidy', 'moviebox', 'multimovies']) {
      try {
        const rM = await fetch(HUB + '/pick?src=' + sp + '&n=40' + (HKEY(sp) ? '&key=' + encodeURIComponent(HKEY(sp)) : ''), { signal: AbortSignal.timeout(6000) });
        const jM = await rM.json(); if (!jM || !Array.isArray(jM.pick)) continue;
        const own = jM.pick.filter(p => p.own); if (!own.length) continue;
        MIRROR[sp] = own.map(p => ({ px: p.px, ms: p.ms || null }));
        for (const p of own) {
          if (!POOL.some(c => c.px === p.px) && POOL.length < 300) POOL.push({ px: p.px, ms: p.ms || 2000 }); // নিজের-ভাণ্ডারে-জমা
          if (!PX_RUN.get(p.px)) PX_RUN.set(p.px, { ok: 1, fail: 0, ms: p.ms || 2000, last: Date.now() }); // হাব-বেঞ্চ-স্কোর-বীজ (স্থানীয়-রেস-তৎক্ষণাৎ-ব্যবহার-করতে-পারে)
          const lsk = sp === 'vidy' ? 'api' : (sp === 'multimovies' ? 'vb' : null);
          if (lsk && PX_SPACES[lsk]) { PX_SPACES[lsk].set.add(p.px); PX_SPACES[lsk].ts.set(p.px, Date.now()); } // স্থানীয়-স্পেসেও (api/vb-বেঞ্চ-গেট-তাৎক্ষণিক-পাস)
        }
        pxSpaceSave();
      } catch (e) { }
    }
    try { fs.writeFileSync(MIRROR_FILE, JSON.stringify(MIRROR)); } catch (e) { }
    if (DBG) console.error('[mirror] হাব-বেঞ্চ-নিজের-জায়গায়: ' + Object.keys(MIRROR).map(k => k + '=' + (MIRROR[k] || []).length).join(' '));
  } finally { MIRR_B = false; }
}
setInterval(hubMirror, 60000).unref(); setTimeout(hubMirror, 12000).unref();
let PXCHK = 0, pxChkBusy = false;
async function pxCheckerWave() {
  if (pxChkBusy || !POOL.length) return;
  pxChkBusy = true;
  try {
    const tnow = Date.now();
    const wave = POOL.filter(c => (PX_COOL.get(c.px) || 0) <= tnow)
      .sort((a, b) => (PX_LASTOK.get(a.px) || 0) - (PX_LASTOK.get(b.px) || 0)).slice(0, 42); // v1.15.27 (ইউজার): সমান্তরাল-ট্রিপল ১৪→৪২
    if (!wave.length) return;
    PXCHK++;
    // v1.15.56 ইউনিভার্সাল: প্রতি-ঢেউয়ে-দুই-স্পেস × ২১-px (ঘূর্ণন site→api→vb→wo) — প্রতি-স্পেস-পূর্ণ-কভার ~২মিন; প্রতি-px-যেকোনো-স্পেসে ~৩১সে
    const SPKEYS = ['site', 'api', 'vb', 'wo'];
    const SPK = SPKEYS[PXCHK % 4], SPK2 = SPKEYS[(PXCHK + 1) % 4];
    const HALF = Math.ceil(wave.length / 2);
    const jobs = [];
    for (let wi = 0; wi < wave.length; wi++) jobs.push({ c: wave[wi], sk: wi < HALF ? SPK : SPK2 });
    let cok = 0, cspare = 0, cdead = 0;
    await Promise.all(jobs.map(j => new Promise(r2 => {
      const SP = PX_SPACES[j.sk];
      const HOME = j.sk === 'site' && (PXCHK % 32 === 0); // R1: হোমপেজ-থরোফে-bench-রক্ষা (৪৫০×-ব্যয়বহুল — বিরল)
      const chkURL = HOME ? VIDY_REFERER : SP.url;
      const minBody = HOME ? 500 : SP.min;
      const t0 = Date.now();
      proxiedGet(j.c.px, chkURL, 6000).then(body => {
        const okS = !!body && String(body).length > minBody;
        pxRec(j.c.px, okS, Date.now() - t0, j.sk); // স্পেস-যাচাই — পাস=স্পেসে-তোলা, ফেল=নামা
        if (okS) { SP.set.add(j.c.px); SP.ts.set(j.c.px, Date.now()); pxSpaceSave(); PX_MISS.delete(j.c.px); PX_COOL.delete(j.c.px); cok++; }
        else { SP.set.delete(j.c.px); const m = (PX_MISS.get(j.c.px) || 0) + 1; if (m >= 2) PX_MISS.set(j.c.px, 0); else PX_MISS.set(j.c.px, m); cspare++; }
        r2(); // v1.15.21: ঢেউ-প্রমিস-মুক্ত
      }).catch(() => { // ব্যর্থ → Google-ফলব্যাক: জীবিত=স্পেয়ার, মরা=প্রমাণহীন
        const t1 = Date.now();
        SP.set.delete(j.c.px); PX_MISS.delete(j.c.px);
        proxiedGet(j.c.px, PX_PROBE_URL, 4000).then(() => { pxRec(j.c.px, true, Date.now() - t1); pxRec(j.c.px, false, 0); cspare++; r2(); })
          .catch(() => { pxRec(j.c.px, false, 0); cdead++; PX_COOL.set(j.c.px, Date.now() + 120000); r2(); });
      });
    })));
    if (PXCHK % 15 === 1) console.error('[pxchk] স্পেস=' + SPK + '+' + SPK2 + ' ওকে=' + cok + ' স্পেয়ার=' + cspare + ' মৃত=' + cdead + ' | সাইট=' + PX_SITE.size + ' api=' + PX_API.size + ' vb=' + PX_VB.size + ' wo=' + PX_WO.size);
    const t2 = Date.now();
    let cut = 0;
    for (let i = POOL.length - 1; i >= 0 && POOL.length > 20; i--) { // v1.15.21: ফ্লোর ১২→২০ (বেঞ্চ-রক্ষকের-জন্য-যথেষ্ট-প্রার্থী-সবসময়)
      if (t2 - (PX_LASTOK.get(POOL[i].px) || t2) > 600000) { const g = POOL.splice(i, 1)[0]; PX_RUN.delete(g.px); PX_LASTOK.delete(g.px); PX_COOL.delete(g.px); for (const sk of SPKEYS) { PX_SPACES[sk].set.delete(g.px); PX_SPACES[sk].ts.delete(g.px); } PX_MISS.delete(g.px); cut++; pxSpaceSave(); }
    }
    if (cut) { try { fs.writeFileSync(POOL_FILE, JSON.stringify(POOL)); } catch (e) {} setTimeout(enrichPool, 1500).unref(); }
    const benchN = POOL.filter(c => PX_SITE.has(c.px)).length;
    if (benchN < 24) { setTimeout(enrichPool, 2000).unref(); if (PXCHK % 10 === 1) console.log('[pxbench-keeper] bench=' + benchN + ' < ২৪ → এনরিচ-ফসল-তাৎক্ষণিক'); } // v1.15.22 বেঞ্চ-রক্ষক: ম্যাক্স-টানা (থ্রেশহোল্ড ১৮→২৪)
    if (cut || PXCHK % 15 === 1 || process.env.VPCHK) console.log('[pxchk] wave=' + wave.length + ' site=' + cok + ' spare=' + cspare + ' dead=' + cdead + ' pool=' + POOL.length + ' bench=' + benchN + ' cut=' + cut); // VPCHK=1: প্রতি-ঢেউয়ে-লগ (ডিবাগ)
  } finally { pxChkBusy = false; }
}
function pxCheckerStart() {
  const loop = () => { setTimeout(() => { Promise.resolve(pxCheckerWave()).catch(() => {}).finally(loop); }, 8000); }; // v1.15.19: ব্যবধান ১২সে→৮সে (পুল-৪৩ → সম্পূর্ণ-চক্র ~২৫সে)
  loop();
}
// v1.15.4 পুল-ট্রেইনার (enrich): পাবলিক-তালিকা → নমুনা-১২০ → সমান্তরাল-২০৪-যাচাই → দ্রুততম(<১.৮সে)-যোগ;
// মূল-১৭-অক্ষত-প্রথমে, ক্যাপ-৭৭, জেতা-প্রক্সি-ফাইলেও-লেখা (রিস্টার্টে-উষ্ণ); PX_ENRICH=0 দিলে-বন্ধ
const PX_BASE_N = 17, PX_CAP = 154, POOL_FILE = path.join(__dirname, 'vidy_proxy_pool.json'); // v1.15.27 (ইউজার): ক্যাপ-ডাবল ৭৭→১৫৪
let _training = false;
async function enrichPool() {
  if (_training || process.env.PX_ENRICH === '0' || !POOL.length) return;
  _training = true;
  try {
    const lists = ['https://raw.githubusercontent.com/TheSpeedX/PROXY-LIST/master/http.txt',
                   'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
                   'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000',
                   'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt']; // v1.15.23: proxifly-http-মডিউল (ইউজার-প্রস্তাব)
    const txts = await Promise.all(lists.map(u => directGet(u, 12000).catch(() => '')));
    const have = new Set(POOL.map(c => c.px));
    const cands = [...new Set((txts.join('\n').match(/\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}\b/g) || [])).values()].filter(px => !have.has(px));
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const w = cands[i]; cands[i] = cands[j]; cands[j] = w; }
    const sample = cands.slice(0, 200), good = []; // v1.15.18: নমুনা ১২০→২০০
    for (let i = 0; i < sample.length && POOL.length < PX_CAP; i += 120) { // v1.15.27 (ইউজার): হার্ভেস্ট-ব্যাচ-ট্রিপল ৪০→১২০
      const res = await Promise.all(sample.slice(i, i + 120).map(px => new Promise(r2 => {
        const t0 = Date.now();
        proxiedGet(px, PX_PROBE_URL, 4000).then(() => { const ms = Date.now() - t0; r2(ms < 2500 ? { px, ms } : null); }).catch(() => r2(null)); // v1.15.22: ভর্তি-সীমা ১.৮→২.৫সে (পুল-ম্যাক্স-পর্যন্ত-ভরে; মান-বেঞ্চের-কাছে-আবার-ছাঁটা)
      })));
      for (const g of res) if (g) good.push(g);
    }
    good.sort((a, b) => a.ms - b.ms);
    const base = POOL.slice(0, Math.min(PX_BASE_N, POOL.length)), rest = POOL.slice(base.length);
    const next = base.slice(); const seen = new Set(next.map(c => c.px));
    let n = 0;
    for (const g of good) { if (next.length >= PX_CAP) break; if (!seen.has(g.px)) { seen.add(g.px); next.push(g); n++; } }
    for (const c of rest) { if (next.length >= PX_CAP) break; if (!seen.has(c.px)) { seen.add(c.px); next.push(c); } }
    POOL.length = 0; for (const c of next) POOL.push(c);
    if (n) { try { fs.writeFileSync(POOL_FILE, JSON.stringify(POOL)); } catch (e) {} }
    if (DBG) console.error('[pool] enrich: +' + n + ' (মোট ' + POOL.length + ', প্রার্থী ' + cands.length + ')');
  } catch (e) { if (DBG) console.error('[pool] enrich-ERR ' + String(e && e.message).slice(0, 80)); } finally { _training = false; }
}

// ---------- মেমো + ডিডুপ ----------
const memo = new Map(); // key → {ts, v}
const pending = new Map();
function memoGet(k, ttl) { const h = memo.get(k); return h && (Date.now() - h.ts) < ttl ? h.v : null; }
function memoSet(k, v) { memo.set(k, { ts: Date.now(), v }); if (memo.size > 3000) memo.clear(); }
function dedupe(k, fn) {
  const ex = pending.get(k);
  if (ex) return ex;
  const p = fn().finally(() => pending.delete(k));
  pending.set(k, p);
  return p;
}

// ---------- vidy decrypt (VidyDecrypt.kt-র বাইট-এক্সাক্ট JS-পোর্ট) ----------
const K = 2654435769, A0 = 2779096485;
const imul = (a, b) => Math.imul(a, b) >>> 0;
function rotl(x, r) { const s = r & 31; return s === 0 ? x >>> 0 : (((x << s) | (x >>> (32 - s))) >>> 0); }
function mix(e) {
  let x = e >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; x = imul(x, 2246822507);
  x = (x ^ (x >>> 13)) >>> 0; x = imul(x, 3266489909);
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}
function fnv1a(str) {
  let t = 2166136261;
  const b = Buffer.from(str, 'utf8');
  for (let i = 0; i < b.length; i++) t = imul((t ^ b[i]) >>> 0, 16777619);
  return mix(t);
}
function keystream(seed, tmdbId, len) {
  const s0 = mix((fnv1a(seed) ^ mix((tmdbId >>> 0) ^ K)) >>> 0) >>> 0;
  const S = new Array(61).fill(0);
  const def = new Array(61).fill(false);
  let s = s0;
  for (let e = 0; e < 8; e++) {
    const t = s % 61;
    const sr = rotl((s + K) >>> 0, 7 + (7 & e));
    S[t] = (sr ^ mix(sr)) >>> 0;
    def[t] = true;
    s = mix((sr + t) >>> 0) >>> 0;
  }
  const acc = mix(A0 ^ s) >>> 0;
  const ks = Buffer.alloc(len);
  let n = acc, counter = 0, i = 0;
  while (i < len) {
    const d = n % 61;
    const inner = (S[d] ^ imul(K, counter + 1)) >>> 0;
    const rbit = def[d] ? -1 : 0;
    const l = (((n ^ inner) | (n & inner & rbit)) >>> 0);
    const x = (rotl((l + n) >>> 0, 31 & d) ^ rotl(n, 31 & ((d * 7) & 31))) >>> 0;
    n = mix((x + K) >>> 0) >>> 0;
    S[d] = n; def[d] = true;
    ks[i++] = n & 0xFF;
    if (i < len) ks[i++] = (n >>> 8) & 0xFF;
    if (i < len) ks[i++] = (n >>> 16) & 0xFF;
    if (i < len) ks[i++] = (n >>> 24) & 0xFF;
    counter++;
  }
  return ks;
}
function vidyDecrypt(b64ct, seed, tmdbId) {
  const ct = Buffer.from(b64ct, 'base64url');
  const ks = keystream(seed, tmdbId >>> 0, ct.length);
  for (let i = 0; i < ct.length; i++) ct[i] ^= ks[i];
  if (ct.slice(0, 4).toString('latin1') !== 'mvm1') throw new Error('decrypt failed: bad seed or tampered payload');
  return ct.slice(4).toString('utf8');
}

// ---------- fetch (direct + CONNECT-প্রক্সি) ----------
const HAGENT = new http.Agent({ keepAlive: true, maxSockets: 32 }); // কানেকশন-পুনঃব্যবহার — ঠান্ডা-কল-দ্রুত
const SAGENT = new https.Agent({ keepAlive: true, maxSockets: 32 });
const HAGENTP = new http.Agent({ keepAlive: false, maxSockets: 16 }); // প্রোব-একবার-ই-চলে — ক্লিন-ক্লোজ
const SAGENTP = new https.Agent({ keepAlive: false, maxSockets: 16 });
function directGet(url, timeoutMs, _re, _hop) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: timeoutMs, agent: u.protocol === 'http:' ? HAGENT : SAGENT }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((_hop || 0) >= 4) return reject(Object.assign(new Error('redirect-loop'), { code: 310 })); // লুপিং-রিডাইরেক্ট-স্টপ
        return resolve(directGet(new URL(res.headers.location, url).toString(), timeoutMs, _re, (_hop || 0) + 1));
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 429) return reject(Object.assign(new Error('rate_limited'), { code: 429 }));
        if (res.statusCode !== 200) return reject(Object.assign(new Error('http_' + res.statusCode), { code: res.statusCode }));
        resolve(body);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', e => {
      // keep-alive-সকেট-নিঃশব্দে-মরলে (NAT/মিডলবক্স) নতুন-সকেট-দিয়ে-এক-বার-অটো-পুনঃচেষ্টা:
      if (req.reusedSocket && !_re && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) return resolve(directGet(url, timeoutMs, 1));
      reject(e);
    });
  });
}
function dechunk(buf) {
  let out = [], i = 0;
  while (i < buf.length) {
    const j = buf.indexOf('\r\n', i);
    if (j < 0) break;
    const size = parseInt(buf.slice(i, j).toString('latin1').split(';')[0], 16);
    if (!size) break;
    out.push(buf.slice(j + 2, j + 2 + size));
    i = j + 2 + size + 2;
  }
  return Buffer.concat(out);
}
function proxiedGet(px, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const ci = px.indexOf(':');
    const phost = px.slice(0, ci), pport = Number(px.slice(ci + 1)) || 8080;
    const sock = net.connect({ host: phost, port: pport });
    const hardTo = setTimeout(() => { sock.destroy(); reject(new Error('proxy-timeout')); }, timeoutMs);
    const bail = e => { clearTimeout(hardTo); try { sock.destroy(); } catch (e2) {} reject(e); };
    sock.once('error', bail);
    sock.once('connect', () => sock.write('CONNECT ' + u.host + ':443 HTTP/1.1\r\nHost: ' + u.host + ':443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      sock.removeListener('data', onData);
      const head = buf.slice(0, i).toString('latin1');
      if (!/^HTTP\/1\.[01] 200/.test(head)) return bail(new Error('proxy-refused'));
      const tl = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
        tl.write('GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: ' + UA + '\r\nAccept: */*\r\nConnection: close\r\n\r\n');
        const chunks = [buf.slice(i + 4)];
        let headTxt = '';
        let hdrDone = false;
        tl.on('data', d2 => {
          if (!hdrDone) { // হেডার-দুই-রেকর্ডে-ভাগ-হলেও-ঠিক (আগে: !headTxt-চেকে ২য়-অংশ-বডিতে-গুলে-যেত)
            headTxt += d2.toString('latin1');
            const j = headTxt.indexOf('\r\n\r\n');
            if (j < 0) return;
            hdrDone = true;
            chunks.push(Buffer.from(headTxt.slice(j + 4), 'latin1'));
            headTxt = headTxt.slice(0, j);
            return;
          }
          chunks.push(d2);
        });
        tl.on('close', () => {
          clearTimeout(hardTo);
          const raw = Buffer.concat(chunks);
          const body = (/chunked/i.test(headTxt) ? dechunk(raw) : raw).toString('utf8');
          const code = parseInt((headTxt.split('\r\n')[0] || '').split(' ')[1] || '0', 10);
          if (code === 429) return reject(Object.assign(new Error('rate_limited'), { code: 429 }));
          if (code !== 200 && code !== 204) return bail(new Error('http_' + code)); // v1.15.0: ২০৪-ও-সাফল্য (generate_204-প্রোব-টার্গেট)
          resolve(body);
        });
      });
      tl.once('error', bail);
    };
    sock.on('data', onData);
  });
}
function racePool(url, n, timeoutMs, srcKey) { // v1.15.56: srcKey = কোন-সোর্সের-জন্য — আগে-ওই-সোর্সের-নিজ-স্পেস, তারপর api→site→জীবিত
  // v1.11.2: সুস্থতা-ব্যান্ড-জুড়ে-ছড়ানো-নমুনা — আগে-তালিকার-প্রথম-n-টা-নিত; ওই-৫টা-একসাথে-মৃত-থাকলে
  // বাকি ১৯-সুস্থ-px-থাকতেও-পুরো-পুল 'pool-exhausted' ঘোষিত-হত ( BreakingBad-runে-ঠিক-তা-ই-হয়েছিল)
  // v1.15.0: ক্রম-রানটাইম-স্কোরে (ব্যর্থতা-ভারী-পিছিয়ে), মৃত-ভারী-পুলে-রেস-প্রস্থ-বাড়ে, ফল-PX_RUN-এ-জমে
  const srt = POOL.slice().sort((a, b) => pxScore(a.px, a.ms) - pxScore(b.px, b.ms));
  const alive = srt.filter(c => { const h = PX_RUN.get(c.px); return !h || h.ok > 0 || h.fail < 3; }); // প্রমাণিত-মৃত (৩-ব্যর্থ-শূন্য-জয়) রেসে-নয়
  // v1.15.17 বেঞ্চ-গেট (ইউজার-মানদণ্ড: বেঞ্চ=সাইটে-যেতে-পারে+জীবিত): ৩+ সাইট-প্রমাণিত-থাকলে রেস-শুধু-বেঞ্চে
  // (স্পেয়ার=জীবিত-কিন্তু-সাইট-অন্ধ শুধু-আপাতকালীন-রিজার্ভ; চেকার-ঢেউ-প্রতিনিয়ত-তাদের-পুনঃপরীক্ষা-করে-বেঞ্চে-তুলবে)
  const SPB = (srcKey && PX_SPACES[srcKey]) ? PX_SPACES[srcKey].set : null;
  const sb = SPB ? alive.filter(c => SPB.has(c.px)) : [];
  const good = alive.filter(c => PX_SITE.has(c.px));
  const api3 = alive.filter(c => PX_API.has(c.px));
  const use = sb.length >= 3 ? sb : (api3.length >= 3 ? api3 : (good.length >= 3 ? good : (alive.length >= 3 ? alive : srt))); // নিজ-স্পেস≥৩ → api → site → জীবিত → সর্বশেষ-ভরসা
  const n2 = Math.min(use.length, Math.max(n, (srt.length - alive.length) >= srt.length / 2 ? n + 3 : n)); // অর্ধেকের-বেশি-মৃত → প্রস্থ+৩
  const cands = [];
  for (let i = 0; i < n2 && use.length; i++) {
    const c = use[Math.floor(i * use.length / n2)];
    if (c && !cands.some(x => x.px === c.px)) cands.push(c);
  }
  if (!cands.length) return Promise.reject(new Error('pool-empty'));
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; reject(new Error('race-timeout')); } }, timeoutMs);
    let fails = 0;
    for (const c of cands) {
      const tP = Date.now();
      proxiedGet(c.px, url, timeoutMs).then(body => {
        pxRec(c.px, true, Date.now() - tP, srcKey); // রেস-জয়=আসল-প্রমাণ — সরাসরি-স্পেসে-তোলা
        if (done) return;
        done = true; clearTimeout(to);
        resolve({ body, px: c.px });
      }).catch(() => {
        pxRec(c.px, false, 0, srcKey); // রেস-ব্যর্থ = ওই-সোর্সের-স্পেস-থেকে-নামা
        if (++fails === cands.length && !done) { done = true; clearTimeout(to); reject(new Error('pool-exhausted')); }
      });
    }
  });
}

// ---------- catalog/search (keyless TMDB) ----------
function tmdbMeta(x, type) {
  const base = {
    type: type === 'tv' ? 'series' : 'movie',
    name: x.name || x.title || '',
    poster: x.poster_path ? 'https://image.tmdb.org/t/p/w300' + x.poster_path : undefined,
    description: (x.overview || '').slice(0, 200) || undefined,
    releaseInfo: String(x.first_air_date || x.release_date || '').slice(0, 4) || undefined
  };
  if (!base.name || !x.id) return null;
  return pooledGet(TMDBP + '/' + (type === 'tv' ? 'tv/' : 'movie/') + x.id + '/external_ids', 10000).then(b => {
    const e = JSON.parse(b);
    return e.imdb_id ? Object.assign({}, base, { id: e.imdb_id }) : Object.assign({}, base, { id: 'tmdb' + x.id });
  }).catch(() => Object.assign({}, base, { id: 'tmdb' + x.id })); // থ্রটল-হলেও ক্যাটালগ-মরবে-না (tmdb-নেটিভ-আইডি)
}
function catalogMeta(type, q, cfg, gn, skip) {
  cfg = cfg || DEFAULT_CFG;
  const gid = genreIds(type, gn);
  let url;
  let cap = 14;
  const off = (skip || 0) % cap; // ইন-পেজ-অফসেট — skip=14-আগে-পেজ-১-রিপিট-হত
  if (q) {
    url = TMDBP + '/search/' + type + '?language=en-US&query=' + encodeURIComponent(q);
  } else if (gid.length || cfg.lang || cfg.era || cfg.sort !== 'pop' || skip) {
    // keyless-প্রক্সি with_genres ব্লক-করে → ৪-পেজ-আনিয়ে genre_ids দিয়ে লোকাল-ফিল্টার
    const qs = [];
    if (cfg.lang) qs.push('with_original_language=' + cfg.lang);
    if (cfg.sort === 'top') { qs.push('sort_by=vote_average.desc'); qs.push('vote_count.gte=80'); }
    else if (cfg.sort === 'new') qs.push('sort_by=' + (type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc'));
    else qs.push('sort_by=popularity.desc');
    if (cfg.era) qs.push((type === 'tv' ? 'first_air_date.gte=' : 'primary_release_date.gte=') + cfg.era + '-01-01');
    const base = TMDBP + '/discover/' + type + '?language=en-US&' + qs.join('&');
    const p0 = 1 + Math.floor((skip || 0) / cap); // জনর-মোডেও-স্ক্রল-পেজিনেশন (৪-পেজ-জানালা, cap-সমলাইন)
    const pages = gid.length ? [p0, p0 + 1, p0 + 2, p0 + 3] : [p0];
    const one = () => Promise.all(pages.map(p =>
      pooledGet(base + '&page=' + p, 14000).then(b => (JSON.parse(b).results || []), () => [])
    )).then(lists => {
      let all = [].concat.apply([], lists);
      if (gid.length) all = all.filter(x => gid.every(gi => (x.genre_ids || []).indexOf(gi) !== -1));
      return Promise.all(all.slice(off, off + cap).map(x => tmdbMeta(x, type))).then(arr => arr.filter(Boolean));
    });
    return one().catch(() => new Promise(r => setTimeout(r, 900)).then(one)); // থ্রটল-এ-১-রিট্রি
  } else {
    url = TMDBP + '/' + (type === 'tv' ? 'tv/top_rated' : 'movie/popular') + '?language=en-US';
  }
  const one = () => pooledGet(url, 14000).then(b => {
    const list = (JSON.parse(b).results || []).slice(off, off + cap);
    return Promise.all(list.map(x => tmdbMeta(x, type))).then(arr => arr.filter(Boolean));
  });
  return one().catch(() => new Promise(r => setTimeout(r, 900)).then(one)); // থ্রটল-এ-১-রিট্রি
}

// ---------- tt → TMDB numeric (keyless) ----------
function tmdbSearchPick(name, year, type) { // keyless-search → বছর-মিল-অগ্রাধিকার, না-মিললেও শীর্ষ-১
  return tmdbGet('/search/' + (type === 'series' ? 'tv' : 'movie') + '?query=' + encodeURIComponent(name), 12000).then(b3 => {
    const list = (JSON.parse(b3).results || []);
    let pick = null;
    for (const x of list) { if (year && String(x.release_date || x.first_air_date || '').slice(0, 4) === year.slice(0, 4)) { pick = x; break; } }
    if (!pick) pick = list[0];
    if (pick && pick.id) return { id: pick.id, name: pick.name || pick.title || name };
    throw new Error('search-empty');
  });
}
function findTmdbInfo(imdb, type) {
  const key = 'find:' + imdb + ':' + type;
  const hit = memoGet(key, 86400000);
  if (hit) return Promise.resolve(hit);
  // v1.15.8: find-empty-মেমো-পাঠ-বিলোপ
  const cinemetaMeta = ms => pooledGet(CINEMETA + '/meta/' + type + '/' + encodeURIComponent(imdb) + '.json', ms).then(b2 => (JSON.parse(b2).meta || {})); // ফ্রি-পাবলিক — Stremio-র-নিজের-IMDb-CDN, IMDb-প্রথম-চেইনের-মাথা
  const suggMeta = () => pooledGet('https://v2.sg.media-imdb.com/suggestion/' + encodeURIComponent(String(imdb)[2]) + '/' + encodeURIComponent(imdb) + '.json', 8000).then(b4 => { // ফ্রি-পাবলিক IMDb-CDN
    const hit = (JSON.parse(b4).d || []).find(x => x && x.l && ['TV series', 'TV mini series', 'feature', 'movie', 'TV movie'].indexOf(String(x.q || '')) >= 0) || {};
    if (!hit.l) throw new Error('sugg-empty');
    return { name: hit.l, year: String(hit.y || '') };
  });
  return dedupe(key, () => cinemetaMeta(15000).then(m => { // ① IMDb-প্রথম: Cinemeta-নাম → অফিসিয়াল-TMDB-search
      const name = m.name || '';
      if (!name) throw new Error('cinemeta-empty');
      return tmdbSearchPick(name, String(m.releaseInfo || m.year || ''), type);
    }).catch(() => suggMeta().then(m2 => tmdbSearchPick(m2.name, m2.year, type))) // ② IMDb-suggestion → অফিসিয়াল-search
  ).catch(() => pooledGet(TMDBP + '/find/' + encodeURIComponent(imdb) + '?external_source=imdb_id', 10000).then(body => { // ③ শেষ-ভরসা: আয়না-find
    const j = JSON.parse(body);
    const r = (type === 'series' ? (j.tv_results || []) : (j.movie_results || []))[0] || null;
    if (r && r.id) { const v = { id: r.id, name: r.name || r.title || '' }; memoSet(key, v); return v; }
    throw new Error('find-empty');
  })).catch(() =>
    // ফলব্যাক-৪ (নাম-শুধু): TMDB-id না-পাওয়া-গেলেও rt/tw-সোর্স নাম-দিয়েই-চলে — পুরো-চেইন-মৃত-হয়-না
    cinemetaMeta(12000).then(m5 => {
      const v = { id: 0, name: m5.name || '' };
      if (v.name) memoSet(key, v);
      return v;
    }).catch(() => ({ id: 0, name: '' }))
  ); // কখনো-থ্রো-নয় — id:0 মানে vidy-সোর্স-স্কিপ কিন্তু rt/tw চলবে
}
function findTmdb(imdb, type) { return findTmdbInfo(imdb, type).then(v => v.id); }
function suggName(imdb) { // দ্রুত-টাইটেল (rt/tw-র-জন্য): IMDb-suggestion — TMDB-মালা-বাদ
  const key = 'snm:' + imdb;
  const hit = memoGet(key, 86400000);
  if (hit !== undefined && hit !== null) return Promise.resolve(hit);
  return dedupe(key, () => pooledGet('https://v2.sg.media-imdb.com/suggestion/' + encodeURIComponent(String(imdb)[2]) + '/' + encodeURIComponent(imdb) + '.json', 8000).then(b => {
    const hit2 = (JSON.parse(b).d || []).find(x => x && x.l && ['TV series', 'TV mini series', 'feature', 'movie', 'TV movie'].indexOf(String(x.q || '')) >= 0) || {};
    const nm = hit2.l || '';
    if (nm) memoSet(key, nm);
    return nm;
  }).catch(() => ''));
}
function nameForTmdb(tmdbId, type) {
  const key = 'nm:' + type + ':' + tmdbId;
  const hit = memoGet(key, 86400000);
  if (hit) return Promise.resolve(hit);
  if (memoGet(key + ':neg', 600000)) return Promise.resolve(''); // ব্যর্থ-লুকআপ-মাত্র-১০মিন — দিনভর-'Vidy'-টাইটেল-নয়
  return dedupe(key, () => tmdbGet('/' + (type === 'series' ? 'tv/' : 'movie/') + tmdbId, 10000).then(b => {
    const j = JSON.parse(b);
    const v = j.name || j.title || '';
    memoSet(key, v);
    return v;
  }).catch(() => { memoSet(key + ':neg', 1); return ''; }));
}

// ---------- seed (direct-first → 429-এ pool-race) ----------
let seedCache = { key: null, seed: null, via: 'direct', px: null, ts: 0 };
let seedInflight = null; // প্যারালাল-জোড়ায়-এক-ই-সিড-কল-শেয়ার-হোক
function hedge2(f0, f1, delayMs, hardMs) { // প্রথম-সফল-উত্তর-জয়ী; দুটোই-ব্যর্থ → reject; হারায়নি-একটাও-বাদ
  return new Promise((resolve, reject) => {
    let done = false;
    const win = v => { if (!done) { done = true; resolve(v); } };
    const die = () => { if (!done) { done = true; reject(new Error('hedge-dead')); } };
    f0().then(win, () => {});
    setTimeout(() => { if (!done) f1().then(win, () => {}); }, delayMs); // f0 জিতে-থাকলে-ডাবল-কল-ই-হবে-না (আপস্ট্রিম-429-লোড-অর্ধেক)
    setTimeout(die, hardMs);
  });
}
function getSeed(tmdbId, force) {
  if (!force && seedCache.seed && seedCache.key === tmdbId && (Date.now() - seedCache.ts) < 45000) { // বিংগে-বান্ধব — সিড-পুনর্ব্যবহার
    return Promise.resolve(seedCache);
  }
  if (!force && seedInflight && seedInflight.key === tmdbId && (Date.now() - seedInflight.ts) < 8000) return seedInflight.p;
  const url = API + '/seed?mediaId=' + tmdbId;
  const p = (async () => {
    // v1.15.7 (ইউজার-নির্দেশ, MovieBox-মডেল): টোকেন/সিড **পুল-থেকেই** — sticky-px-এ-পরের-সব-পথ-কল-ও-পুলে;
    // প্লে-সবসময়-ইউজারের-নিজ-IP-তে। পুল-শূন্য/সর্বমৃত-হলে-শেষ-ভরসা direct (কখনো-ভাঙবে-না)
    try {
      let wbody = ''; let wpx = '';
      if (HUB) { // v1.15.59: হাব-আঁকা — হাব-যে-px-দিয়ে-seed-আনল সেটাই-ফেরত (পরের-সোর্স-কল-ও-সেই-px-ই — seed-IP-বাঁধন; প্রমাণ: ভিন্ন-px-এ-'decrypt failed: bad seed')
        try {
          const r = await fetch(HUB + '/fetch?src=api&ms=9000&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(10500) });
          const j2 = await r.json().catch(() => null);
          if (j2 && j2.ok) { wbody = String(j2.body || ''); wpx = 'hub:' + String(j2.px || ''); }
        } catch { }
      }
      if (!wbody) { const w = await racePool(url, 5, 9000, 'api'); wbody = w.body; wpx = w.px; } // v1.15.56: vidy-seed-স্পেস
      const j = JSON.parse(wbody);
      if (!j.seed) throw new Error('seed-empty-proxy');
      seedCache = { key: tmdbId, seed: j.seed, via: 'proxy', px: wpx, ts: Date.now() };
      return seedCache;
    } catch (e) {
      const b = await directGet(url, 6000);
      const j = JSON.parse(b);
      if (!j.seed) throw Object.assign(new Error('seed-empty'), { code: 429 });
      seedCache = { key: tmdbId, seed: j.seed, via: 'direct', px: null, ts: Date.now() };
      return seedCache;
    }
  })();
  seedInflight = { key: tmdbId, p, ts: Date.now() };
  return p;
}
function pathGet(url, via, px, timeoutMs) {
  if (via === 'proxy' && HUB && px && String(px).indexOf('hub:') === 0) return hubText(url, timeoutMs, 'api', String(px).slice(4)).then(t => { if (!t) throw new Error('hub-empty'); return t; }).catch(() => directGet(url, timeoutMs)); // v1.15.59: হাব-স্টিকি-px — seed-ও-সোর্স-এক-px-ই (ডিক্রিপ্ট-ভাঙা-বন্ধ); হাব-মরলে-সরাসরি
  if (via === 'proxy' && HUB) return hubText(url, timeoutMs, 'api').then(t => { if (!t) throw new Error('hub-empty'); return t; }).catch(() => directGet(url, timeoutMs)); // v1.15.57: হাব-পথ
  return via === 'proxy' && px ? proxiedGet(px, url, timeoutMs) : directGet(url, timeoutMs);
}
// v1.15.5 রাউন্ড-২ (ইউজার: সব-সোর্স-পুল-না-হলে-IP-flag-ঝুঁকি): সুখপথে-direct (শূন্য-দেরি); ৪২৯/৪০৩/৫xx/নেট-ত্রুটিতে-
// পুল-রেস-ফলব্যাক — getSeed-এর-প্রমাণিত-মডেল-মেটাডেটা-API-তেও (TMDB/Cinemeta/IMDb-suggestion এক-IP-ঘন-ব্যবহারে-throttle-করত-পারে)
function pooledGet(url, timeoutMs, n) {
  return directGet(url, timeoutMs).catch(e => {
    const c2 = String((e && (e.code || e.message)) || '');
    if (!/429|403|rate_limited|http_5|^5\d\d$|timeout|ECONN|EPIPE|socket|EAI_AGAIN|fetch/i.test(c2)) throw e;
    return racePool(url, n || 4, Math.min(timeoutMs + 3000, 12000)).then(w => w.body);
  });
}

// ---------- NetHex parallel source (separate source; NEXBASE env, empty = off) ----------
// vidy servers + NetHex (MovieBox direct-MP4) run in parallel; NetHex cards (♧, distinct style)
// are appended after the vidy cards. Any NetHex failure/timeout/slow = vidy cards alone, never an error.
const DBG = !!process.env.VDBG; // সব-debug-লগ-এই-এক-ফ্ল্যাগে-গেটেড (VDBG=1-এ-চালু)
// v1.15.57 PoolHub-মোড (ইউজার-নকশা: ইউনিভার্সাল-পুল-আলাদা-সার্ভিস+API): POOLHUB=http://host:port দিলে-vidy-র-প্রক্সি-চাহিদা-আগে-হাবের-/fetch-এ; হাব-মরলে/না-দিলে-আগের-স্থানীয়-পুল-পথ-অক্ষত
const HUB = String(process.env.POOLHUB || 'https://293c2a7d7dd6-poolhub.baby-beamup.club').replace(/\/$/, ''); // v1.15.66: ডিফল্ট=ডিপ্লয়েড-PoolHub (Badhan-নেমস্পেস) — নতুন-সিস্টেমই-মূল; POOLHUB=http://127.0.0.1:8399 দিলে-লোকাল-ডিভ
// v1.15.62 সাব-স্পেস-API-কী (ইউজার: প্রতি-সোর্স-নিজ-কী-দিয়ে-হাব-ব্যবহার): POOLHUB_KEYS=ফাইল-পথ (JSON {স্পেস:psk}) — লোকালে poolhub/poolhub_keys.json
let HKEYS = {}; try { HKEYS = JSON.parse(fs.readFileSync(String(process.env.POOLHUB_KEYS || path.join(__dirname, 'poolhub', 'poolhub_keys.json')), 'utf8')); } catch (e) { }
const HKEY = n => String(HKEYS[n] || '');
const HALIAS = { tw: 'toonworld4all', toonworld: 'toonworld4all', rt: 'raretoons', raretoons: 'raretoons', api: 'vidy', site: 'vidy', mb: 'moviebox', vb: 'multimovies', wo: 'multimovies' };
const HSPACE = n => HALIAS[String(n || '')] || String(n || '') || 'vidy';
// v1.15.58 (ইউজার-নকশা): সোর্স-ঘোষিত-শর্ত — vidy-বুটে-নিজের-প্রতিটা-সোর্সের-কন্ডিশন-হাবে-নিবন্ধন-করে; হাব-তখন-সব-প্রক্সিকে-এই-শর্তে-বেঞ্চ-করে-পাস-কে-ওই-স্পেসে-জমায় (এক-প্রক্সি-বহু-সোর্সে-পার-হলে-সব-স্পেসে)
if (HUB) {
  // v1.15.62 (গোছানো-কাঠামো): PX_DECL=৫-সাব-স্পেস-ই — প্রতিটা-নিজ-API-কী-দিয়ে-/register (কী=স্পেস-নির্ধারক)
  const PX_DECL = {
    toonworld4all: { url: 'https://toonworld4all.me/robots.txt', min: 100, contains: 'wp-admin' }, // আসল-টার্গেট+WordPress-স্বাক্ষর
    raretoons: { url: 'https://www.rareanimes.mov/robots.txt', min: 100, contains: 'wp-admin' }, // crawler.py-লাইভ-টার্গেট+স্বাক্ষর
    vidy: { url: API + '/seed?mediaId=95350', min: 30, contains: '"seed"' }, // vidy-র-আসল-কাজ
    moviebox: { url: '', tokencheck: true, min: 1 }, // v1.15.65 (ইউজার-প্রমাণ ৮৩%-পাস): হাব-ঢেউয়ে-টোকেন-সংগ্রহ-বেঞ্চ — searchVerify-এর-১ম-দরজা
    multimovies: { url: 'https://vidbolt.xyz/api/resolve?type=tv&id=1&season=1&episode=1', min: 5 } // মাল্টিমুভিজ-CDN-শর্ত
  };
  setTimeout(() => { for (const sk of Object.keys(PX_DECL)) fetch(HUB + '/register', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, HKEY(sk) ? { 'x-poolhub-key': HKEY(sk) } : {}), body: JSON.stringify(Object.assign({ src: sk }, PX_DECL[sk])) }).catch(() => { }); }, 2500);
}
async function hubText(url, ms, src, px) { // v1.15.59: px-দিলে-স্টিকি (হাব-একই-px-দিয়ে-একক-কল — seed-IP-বাঁধন-রক্ষা)
  if (!HUB) return '';
  try {
    const sp = HSPACE(src);
    const r = await fetch(HUB + '/fetch?src=' + encodeURIComponent(sp) + (px ? '&px=' + encodeURIComponent(px) : '') + '&ms=' + Math.min(12000, ms || 8000) + (HKEY(sp) ? '&key=' + encodeURIComponent(HKEY(sp)) : '') + '&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(Math.min(13000, (ms || 8000) + 1500)) });
    const j = await r.json().catch(() => null);
    return j && j.ok ? String(j.body || '') : '';
  } catch { return ''; }
}
process.on('unhandledRejection', e => { if (DBG) console.error('[urej] ' + String((e && (e.stack || e.message)) || e).slice(0, 160)); }); // v1.15.6 রাউন্ড-৪৩: স্ট্রে-promise-রিজেকশন-এ-প্রসেস-মরা-বন্ধ (Node-১৫+ ডিফল্ট-ক্র্যাশ) — লগ-অনলি, পরিষেবা-চলতে-থাকে
let UCEX = 0; // v1.15.36: ধরা-না-পড়া-এক্সেপশন-গণক (/_health-এ-স্বচ্ছ)
process.on('uncaughtException', e => { UCEX++; try { if (DBG) console.error('[ucex#' + UCEX + '] ' + String((e && (e.stack || e.message)) || e).slice(0, 200)); } catch {} }); // v1.15.36: স্ট্রে-সিঙ্ক্রোনাস-বিপর্যয়েও-পরিষেবা-মরবে-না (Node-ডিফল্ট=ক্র্যাশ) — লগ+গণনা, স্টেট-অক্ষত-ধরে-চলতে-থাকে
// v1.11.8: NEXBASE-বাইরে-থেকে-দেওয়া-যায়; না-দিলে-ভেন্ডর-করা-MovieBox(nethex)-চাইল্ড-নিজেই-বুট-হয় (এক-অ্যাপ-ডিপ্লয়)
let NEXBASE = (process.env.NEXBASE || '').replace(/\/$/, '');
const NXDEADLINE = Math.max(Number(process.env.NXDEADLINE || 0), 22000); // absolute cap (stale-env-ও-নিচে-টানবে-না)
const NXEXTRA = Math.max(Number(process.env.NXEXTRA || 0), 12000); // v1.15.25 (ইউজার: "আগে শেষ হলে আগেই রেজাল্ট, না হলে ১২সে পর্যন্ত"): NetHex-এর-জন্য-১২সে-পর্যন্ত-ধরে-রাখো — রেডি-হলে-রেস-আগেই-জেতে, instant-অক্ষত
const NXCOLDX = Math.max(Number(process.env.NXCOLDX || 0), 12000); // v1.15.25: ১২সে-ইউজার-সীমা (কার্ড-থাকলেও-না-শেষ-হলে-১২সে-পর্যন্ত-ধরো; শেষ-হলে-আগেই)
const NXHARD = Math.max(Number(process.env.NXHARD || 0), 12000); // v1.15.25 (ইউজার-নির্দেশ): ফাঁকা-কার্ডে-পূর্ণ-১২সে-বরাদ্দ — স্ট্রিম-উত্তর-সর্বোচ্চ-১২সে (আগে-শেষ=আগে-ফল)
const NXCACHE = new Map(); // nx:imdb:s:e -> {ts, v} — NetHex links are signed/fresh + it caches 30min itself
async function nxStreams(imdb, type, s, e) {
  if (!NEXBASE || !imdb) return [];
  if (NXBENCH === 0 && NEXBASE) await waitNxBench(8000); // v1.15.13: ঠান্ডা-রেপ্লিকায়-প্রথম-বেঞ্চ-ঢেউ-অপেক্ষা (৮সে-সীমা; বেঞ্চ-ঝড়-নয় — এক-single-flight)
  if (NXBENCH === 0) return []; // v1.15.10 শীতলীকরণ-রক্ষক (অক্ষত: সত্যিই-শূন্য-পুলে-স্ক্যান-ঝড়-নয়): বেঞ্চ-খালি = প্রতিটা-কল-403-খায়-আর-বেঞ্চ-আরো-বসে (ইউজারের-'MovieBox-ভাঙা'-মূল-কারণ); ৬০সে-পোল-জীবিত-দেখলে-নিজে-ই-চালু-হবে
  const k = 'nx:' + imdb + ':' + (type === 'series' ? (s || 1) + ':' + (e || 1) : 'm');
  const h = NXCACHE.get(k);
  if (h && (Date.now() - h.ts) < 1800000) return h.v;
  try {
    const path2 = type === 'series' ? encodeURIComponent(imdb + ':' + (s || 1) + ':' + (e || 1)) : encodeURIComponent(imdb);
    const epP = epMetaForImdb(imdb, type, s, e); // বছর+এপি-টাইটেল — nethex-ফেচের-সমান্তরালে
    const olP2 = origLangForImdb(imdb); // আসল-ভাষা — ডাব-না-থাকলে-এ-নামই-বসবে ('Original'-লেখা-আর-নেই)
    const t3 = Date.now();
    const b = await directGet(NEXBASE + '/stream/' + type + '/' + path2 + '.json', 25000);
    const nxMs = Date.now() - t3;
    if (DBG) console.error('[nxdbg] nethex ' + type + '/' + path2 + ' -> ' + nxMs + 'ms');
    // v1.11.7: চূড়ান্ত-ইউনিফর্ম-কার্ড — ⧉ Title | Year | / ⧠ SsEe • EpTitle / ⊞ Server ⌗ Audio (resolution শুধু name-এ, Subs-লেখা নেই)
    // v1.14.3 অভিযোজিত-সাজ-অপেক্ষা: ধীর-চাইল্ড-ফেচে-বেড়ি-কমে — মোট nx ≤ ~২.৬সে+চাইল্ড-সর্বনিম্ন
    const nxMeta = Math.max(0, Math.min(1500, 2600 - nxMs));
    const [em, olRaw] = await Promise.all([
      Promise.race([epP.catch(() => null), new Promise(r => setTimeout(() => r(null), nxMeta))]),
      raceVal(olP2, nxMeta)
    ]);
    const olN = langName(olRaw);
    const arr = (JSON.parse(b).streams || []).filter(x => x && typeof x.url === 'string' && /^https?:/.test(x.url)).map(x => {
      const q2 = (/(\d{3,4})p/.exec(String(x.name || '')) || [])[1] || 'Auto';
      const lang = String(x._lang || '').replace(/\s*dub\s*$/i, '').trim();
      const audio = (!lang || /^original/i.test(lang)) ? (olN || 'Original Audio') : lang; // ডাব-র-নিজের-নাম; না-হলে-আসল-ভাষা; TMDB-ও-না-জানলে-স্পষ্ট-'Original Audio' (nethex-প্যারিটি)
      const yr = (/\u25f4\s*(\d{4})/.exec(String(x.description || '')) || [])[1] || (em && em.year) || '';
      const raw = (em && em.name) || (String(x.name || '').split('\u2739')[1] || '').replace(/\s*S\d+\s*-\s*S\d+.*$/i, '').trim() || 'MovieBox'; // শিরোনাম-ও-IMDb-সংগ্রহ
      const H2 = { 'User-Agent': UA, 'Referer': 'https://movieboxonline.net/' };
      const epLine = type === 'series' ? ('\u29e0 S' + (s || 1) + 'E' + (e || 1) + ((em && em.epT) ? ' \u2022 ' + em.epT : '')) : '\u29e0 Movie';
      const txt = '\u29c9 ' + raw + (yr ? ' | ' + yr + ' |' : '') + '\n' + epLine + '\n\u229e MovieBox \u2317 ' + audio;
      return {
        name: '\u25a5 ' + q2 + ' \u25a5',
        title: txt,
        description: txt,
        quality: q2 === 'Auto' ? '' : q2,
        _lang: lang,
        url: String(x.url),
        headers: H2,
        behaviorHints: { notWebReady: false, isBingeable: true, filename: 'stream.mp4', proxyHeaders: { request: Object.assign({}, H2, { 'Origin': 'https://movieboxonline.net' }) } },
        bingeGroup: 'mbxr|' + raw + '::|' + (/^original/i.test(lang) ? 'Original' : lang) // nethex-প্যারিটি — বিংগে-গ্রুপিং-অডিও-ভাগে
      };
    });
    if (arr.length) { // empty is NEVER cached — a rate-limited/slow NetHex window must not poison the key for 30min (same rule as inside NetHex itself); the next tap re-fetches
      if (NXCACHE.size > 300) NXCACHE.clear();
      if (arr.length) NXCACHE.set(k, { ts: Date.now(), v: arr }); // v2.10.3: শূন্য-মেমো-নিষিদ্ধ — MB-সাইট-সাময়িক langs:0-ঢেউ ৩০মিন-ধরে-MB-০-দেখাত (r57-নীতি: ফলে-ক্যাশ-নয়); শূন্য-হলে-পরের-ট্যাপে-তাজা-রিসলভ
    }
    return arr;
  } catch (e2) { if (DBG) console.error('[nxdbg] nethex ERR: ' + String(e2 && e2.message).slice(0, 80)); return []; } // NetHex down/slow/empty → silently nothing, vidy never breaks
}
const T2IFLIGHT = new Map(); // dedupe concurrent tmdb→imdb translations (tap + prewarm share one mirror call)
const SUBS_CACHE = new Map(); // subtitles-রিসোর্স → ৩০মিন (চাইল্ডের-ব্যয়বহুল-চেইন-পুনরাবৃত্তি-নয়)
async function tmdbToImdb(tmdbId, type) { // NetHex is tt-only — translate tmdb-native ids through the mirror
  const k = 't2i:' + type + ':' + tmdbId;
  const hit = memoGet(k, 86400000);
  if (hit) return hit;
  if (memoGet(k + ':neg', 600000)) return ''; // ব্যর্থ-অনুবাদ-মাত্র-১০মিন — প্রতি-ট্যাপে-১০সে-টাইমআউট-পোড়ানো-নয়
  const fl = T2IFLIGHT.get(k);
  if (fl) return fl;
  const pr = (async () => {
    try {
      const b = await tmdbGet('/' + (type === 'tv' || type === 'series' ? 'tv/' : 'movie/') + tmdbId + '/external_ids', 10000);
      const v = JSON.parse(b).imdb_id || '';
      if (v) memoSet(k, v); else memoSet(k + ':neg', 1);
      return v;
    } catch (e) { return ''; }
    finally { T2IFLIGHT.delete(k); }
  })();
  T2IFLIGHT.set(k, pr);
  return pr;
}
// ---------- v1.11.9 audio language: TMDB original_language → আসল-নাম (vidy-পেলোডে-অডিও-ফিল্ড-নেই, প্রমাণিত) ----------
const TMDBK = '3fd2be6f0c70a2a598f084ddfb75487c'; // public TMDB key (mirror accepts keyless too; find needs it)
const LANG_NAMES = { hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', ja: 'Japanese', ko: 'Korean', zh: 'Mandarin', cn: 'Mandarin', en: 'English', es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian', pt: 'Portuguese', it: 'Italian', tr: 'Turkish', ar: 'Arabic', th: 'Thai', id: 'Indonesian', ms: 'Malay', fa: 'Persian', ur: 'Urdu', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', tl: 'Filipino', vi: 'Vietnamese', he: 'Hebrew', el: 'Greek', hu: 'Hungarian', ro: 'Romanian', cs: 'Czech', uk: 'Ukrainian', sr: 'Serbian', hr: 'Croatian', bg: 'Bulgarian', ka: 'Georgian', my: 'Burmese', si: 'Sinhala', ne: 'Nepali' };
const OL_CACHE = new Map(); // key -> lang code (6h)
const OL_FLIGHT = new Map();
async function origLangCore(k, url) {
  const hit = OL_CACHE.get(k);
  if (hit && (Date.now() - hit.ts) < 21600000) return hit.v;
  const fl = OL_FLIGHT.get(k);
  if (fl) return fl;
  const pr = (async () => {
    try {
      const b = await tmdbGet(url, 8000); // url=পথ — অফিসিয়াল-আগে, আয়না-ফলব্যাক
      const j = JSON.parse(b);
      const cand = j.original_language !== undefined ? j : ((j.movie_results || []).concat(j.tv_results || []))[0] || {}; // detail অথবা find-এর-প্রথম-ফল
      const v = String(cand.original_language || '').toLowerCase();
      if (v) { OL_CACHE.set(k, { ts: Date.now(), v }); if (OL_CACHE.size > 5000) OL_CACHE.clear(); return v; }
      OL_CACHE.set(k, { ts: Date.now() - 21000000, v: '' }); return ''; // টিএমডিবি-ও-জানে-না → ১০মিন-নেগেটিভ (ts-পেছনে-ঘূর্ণিত; প্রতি-ট্যাপে-৮সে-রিট্রাই-নয়)
    } catch (eO) { return ''; } // নেটওয়ার্ক-ব্যর্থতা → নেগেটিভ-নয় (পরের-কলে-আবার-চেষ্টা)
    finally { OL_FLIGHT.delete(k); }
  })();
  OL_FLIGHT.set(k, pr);
  return pr;
}
const origLangForTmdb = (tmdbId, type) => origLangCore('t:' + tmdbId, '/' + (type === 'tv' ? 'tv/' : 'movie/') + tmdbId);
const origLangForImdb = imdb => origLangCore('i:' + imdb, '/find/' + imdb + '?external_source=imdb_id');
const langName = c => LANG_NAMES[c] || '';
// v1.11.11: HLS-মাস্টার-নিজে-অডিও-ভাষা-ঘোষণা-করলে (EXT-X-MEDIA LANGUAGE="da") সেটাই-সত্য — ISO-639-2/3 → নাম
const ISO3 = { eng: 'English', dan: 'Danish', ben: 'Bengali', hin: 'Hindi', spa: 'Spanish', fra: 'French', fre: 'French', deu: 'German', ger: 'German', rus: 'Russian', por: 'Portuguese', ita: 'Italian', jpn: 'Japanese', kor: 'Korean', zho: 'Mandarin', cmn: 'Mandarin', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', mar: 'Marathi', pan: 'Punjabi', urd: 'Urdu', ara: 'Arabic', tur: 'Turkish', tha: 'Thai', ind: 'Indonesian', msa: 'Malay', may: 'Malay', fas: 'Persian', per: 'Persian', nld: 'Dutch', dut: 'Dutch', pol: 'Polish', swe: 'Swedish', nor: 'Norwegian', fin: 'Finnish', vie: 'Vietnamese', heb: 'Hebrew', ell: 'Greek', gre: 'Greek', hun: 'Hungarian', ron: 'Romanian', rum: 'Romanian', ces: 'Czech', cze: 'Czech', ukr: 'Ukrainian', srp: 'Serbian', hrv: 'Croatian', bul: 'Bulgarian', kat: 'Georgian', geo: 'Georgian', mya: 'Burmese', bur: 'Burmese', sin: 'Sinhala', nep: 'Nepali', fil: 'Filipino', tgl: 'Filipino', und: '', mis: '', qaa: '', zxx: '' };
const iso3Name = c => ISO3[String(c || '').toLowerCase()] || '';
async function raceVal(pr, ms) { return Promise.race([pr.catch(() => ''), new Promise(r => setTimeout(() => r(''), ms))]); }

function withDeadline(pr, ms, tag) { // ঠান্ডা-স্পাইকে-গেটওয়ে-HTML-কাট (~12সে)-যেন-কখনো-ছোঁয়া-না-লাগে — আগে-ই-আংশিক/খালি-JSON
  let to;
  const w = Promise.race([pr, new Promise(r => { to = setTimeout(() => { if (DBG) console.error('[deadline] ' + tag + ' cut at ' + ms + 'ms'); r(null); }, ms); })]);
  Promise.resolve(pr).catch(() => {}).then(() => clearTimeout(to)); // v1.14.5: কাজ-শেষে-টাইমার-মুছো — ইভেন্ট-লুপ-পরিষ্কার
  return w;
}

function kickSubs(id, type, s, e, cfg) { // স্ক্যানের-সমান্তরালে-সাব-চেইন-উষ্ণ-করে — /subtitles-রুট-তাৎক্ষণিক-উত্তর-দেয়
  if (!cfg || cfg.sub === 0) return;
  (/^tt\d+$/.test(String(id)) ? Promise.resolve(String(id)) : tmdbToImdb(String(id), type === 'tv' || type === 'series' ? 'tv' : 'movie'))
    .then(iv => iv ? mbSubs(iv, type, s, e) : null).catch(() => {});
}
async function mbSubs(imdb, type, s, e) { // MovieBox-সাব-ট্র্যাক (চাইল্ড-চেইন-ব্যয়বহুল → ৩০মিন-ক্যাশ + ইনফ্লাইট-ডিডুপ)
  if (!NEXBASE || !imdb) return [];
  const isTv = type === 'tv' || type === 'series';
  const k = 'subs:' + (isTv ? 'series' : 'movie') + ':' + imdb + (isTv ? ':' + (s || 1) + ':' + (e || 1) : '');
  const h = SUBS_CACHE.get(k);
  if (h && (Date.now() - h.ts) < 1800000) return h.arr;
  return dedupe(k, async () => {
    const idPath = encodeURIComponent(isTv ? imdb + ':' + (s || 1) + ':' + (e || 1) : imdb);
    const b = await directGet(NEXBASE + '/subtitles/' + (isTv ? 'series' : 'movie') + '/' + idPath + '.json', 18000);
    const arr = (JSON.parse(b).subtitles || []).filter(x => x && x.url && /^https?:/.test(String(x.url))).slice(0, 20)
      .map(x => ({ title: String(x.lang || x.id || 'Subtitle').slice(0, 60), url: String(x.url), lang: subLang({ lang: String(x.lang || ''), label: String(x.id || '') }) })) // ঐতিহাসিক-আকৃতি: title+url+2-অক্ষর-lang (1.10.x-টিভি-ভ্যালিডেটর-প্রমাণিত)
      .filter(x => x.url && /^https?:/.test(x.url) && /^[a-z]{2}$/.test(x.lang));
    if (arr.length) { if (SUBS_CACHE.size > 200) SUBS_CACHE.clear(); SUBS_CACHE.set(k, { ts: Date.now(), arr }); } // খালি-কখনো-ক্যাশ-নয়
    return arr;
  }).catch(() => []);
}

// ---------- v1.11.5 card meta: বছর + প্রতি-এপিসোডের-নাম (Cinemeta, ৬ঘণ্টা-ক্যাশ) ----------
const EP_META = new Map(); // imdb -> {ts, year, videos:[{s,e,n}]}
async function epMetaCore(imdb, type) {
  const h = EP_META.get(imdb);
  if (h && (Date.now() - h.ts) < 21600000) return h;
  const b = await pooledGet('https://v3-cinemeta.strem.io/meta/' + (type === 'tv' || type === 'series' ? 'series' : 'movie') + '/' + imdb + '.json', 8000); // 'series'-ও-টিভি (nxStreams-'series'-পাঠায়)
  const meta = JSON.parse(b).meta || {};
  const rec = {
    ts: Date.now(),
    name: String(meta.name || '').slice(0, 80),
    year: String(meta.releaseInfo || meta.year || meta.released || '').slice(0, 4),
    videos: (meta.videos || []).map(v => ({ s: Number(v.season) || 0, e: Number(v.episode) || 0, n: String(v.name || '').slice(0, 60) })).filter(v => v.n),
  };
  if (rec.year || rec.videos.length || rec.name) { if (EP_META.size > 200) EP_META.clear(); EP_META.set(imdb, rec); }
  return rec;
}
function epMetaForImdb(imdb, type, s, e) {
  return (async () => {
    try {
      const rec = await epMetaCore(imdb, type);
      if (!rec) return null;
      let epT = '';
      if (type === 'tv' || type === 'series') { const v = rec.videos.find(v => v.s === Number(s || 1) && v.e === Number(e || 1)); if (v) epT = v.n; } // 'series'-ও-টিভি
      return (rec.year || epT || rec.name) ? { name: rec.name, year: rec.year, epT } : null;
    } catch (eE) { return null; }
  })();
}
function epMetaFor(tmdbId, type, s, e) { // tmdb-নেটিভ-আইডি → অনুবাদ → Cinemeta
  return tmdbToImdb(String(tmdbId), type).then(imdb => imdb ? epMetaForImdb(imdb, type, s, e) : null).catch(() => null);
}
function nxFor(type, id, s, e) { // starts the parallel fetch immediately; null when source is off
  if (!NEXBASE) return null;
  if (/^tt\d+$/.test(id)) return nxStreams(id, type, s, e);
  return tmdbToImdb(id, type).then(v => v ? nxStreams(v, type, s, e) : []);
}
function twRtPrewarm(nameP, type, s, e) { // v1.14.5 series tap → পরের-২-এপিসোড-রেজলভার-আগেই-গরম (ঠান্ধা-এপিসোড-রেজলভ ৮সে+ → binge-২য়-ক্লিক-তাৎক্ষণিক)
  if ((!TWBASE && !RTBASE) || type !== 'series') return;
  setTimeout(() => { Promise.resolve(nameP).then(nm => {
    if (!nm) return;
    for (let k = 1; k <= 2; k++) {
      if (TWBASE) twrStreams(TWBASE, 'toonworld', nm, 'series', s, e + k, 1).catch(() => {});
      if (RTBASE) twrStreams(RTBASE, 'raretoons', nm, 'series', s, e + k, 1).catch(() => {});
    }
  }).catch(() => {}); }, 1200);
}
function nxPrewarm(type, id, s, e) { // series tap → quietly fetch the next 3 episodes' NetHex into NXCACHE (binge tap-2 = instant)
  if (!NEXBASE) return;
  // v1.11.2: মূল-ট্যাপের-resolve-পুল-থেকে-প্রথম-কামড়-নেয় (সঙ্গে-সঙ্গে-৪-resolve-প্লাবন-ঠান্ডা-E1-ধীর-করত) — ৯০০ms-দেরি
  setTimeout(() => {
    for (let k = 1; k <= 3; k++) {
      nxFor(type, id, s, e + k).catch(() => {});
    }
  }, 900);
}
async function withNx(cardsP, nxP, cfg, t0) {
  // v1.11.2: vidy-মেটা/স্ক্যান-মরলেও (cinemeta-empty / srv-budget / ৪২৯-ঝড়) nx-আর-অনাথ-নয় —
  // ফাঁকা-কার্ড-নিয়ে-nx-hold-তার-সম্পূর্ণ-বরাদ্দ-পায় (Westworld-tapে ১.৪সে-তে-ফাঁকা-উত্তর-গেছিল, nx ৯.৮সে-তে-১০-কার্ড-নিয়ে-এসেছিল-নষ্ট-হয়ে)
  const cards = await cardsP.catch(e => { if (DBG) console.error('[nxdbg] cardsP died: ' + String(e && e.message || e).slice(0, 90) + (e && e.stack ? ' | ' + String(e.stack).split('\n')[1].trim().slice(0, 90) : '')); return []; });
  if (!nxP || (cfg && cfg.nx === 0)) return cards; // nx disabled per-source → zero hold, zero cards
  try {
    const el = Date.now() - t0;
    if (DBG) console.error('[nxdbg] withNx el=' + el + 'ms grace-pending');
    // FIRST-COLD-REQUEST goal: everything resolves on tap-1. NetHex starts with the vidy scan,
    // so on a cold call it already had `el` ms — the hold tops it up toward the hard deadline.
    // vidy answered from cache (<400ms) -> instant-path: only NXEXTRA (a cold NetHex resolve
    // catches the next tap via its own background re-resolve + cache).
    // v1.11.3: কার্ড-একদম-শূন্য (v=0 nx-only মোড, বা vidy কিছু-পায়নি) → NXEXTRA-র ১সে-নয়,
    // সম্পূর্ণ-হার্ড-বাজেট-ধরে-রাখো — nx-only-ব্যবহারকারীর-প্রথম-ঠান্ডা-ট্যাপ-কখনো-গ্যারান্টেড-ফাঁকা-ফেরত-পাবে-না
    const grace = cards.length === 0 ? Math.max(0, NXHARD - el) : (el < 400 ? NXEXTRA : Math.max(0, Math.min(NXCOLDX, NXHARD - el)));
    const left = Math.max(0, Math.min(NXDEADLINE, el + grace) - el);
    const nx = await Promise.race([nxP.then(v => { if (DBG) console.error('[nxdbg] nxP resolved: ' + (v || []).length + ' cards at ' + (Date.now() - t0) + 'ms'); return v; }).catch(() => []), new Promise(r => setTimeout(() => { if (DBG) console.error('[nxdbg] nxP TIMED OUT at ' + (Date.now() - t0) + 'ms'); r(null); }, Math.max(0, left)))]);
    if (nx && nx.length) {
      // v1.11.3 per-source filters: NetHex answers to nxq/nxl (its OWN chips), NOT the vidy-side q
      const nxAllow = qToList(cfg && cfg.nxq);
      const nxSel = Array.isArray(cfg && cfg.nxl) ? cfg.nxl : [];
      return cards.concat(nx.filter(x => qPass(x, nxAllow) && nxLangPass(x, nxSel))); // appended last
    }
  } catch (e) { if (DBG) console.error('[nxdbg] withNx ERR: ' + String(e && e.message).slice(0, 80) + ' @ ' + String(e && e.stack).split('\n')[1].trim().slice(0, 100)); }
  return cards;
}

// ---------- ToonWorld + RareToons সমান্তরাল-সোর্স (রেজলভার; TWBASE/RTBASE env, ফাঁকা = বন্ধ) ----------
let TWBASE = String(process.env.TWBASE || '');
if (!TWBASE) TWBASE = 'https://3404d3c5dc63-raretoons.baby-beamup.club'; // ফলব্যাক: একই-রেজলভার (টুনওয়ার্ল্ড-সোর্স-সহ)
else if (/\.a\.baby-beamup\.club/.test(TWBASE)) TWBASE = TWBASE.replace('.a.baby-beamup.club', '.baby-beamup.club'); // ডোমেইন-মাইগ্রেশন
let RTBASE = String(process.env.RTBASE || '');
if (!RTBASE) RTBASE = 'https://3404d3c5dc63-raretoons.baby-beamup.club'; // ফলব্যাক: নতুন-পাবলিক-ডোমেইন
else if (/\.a\.baby-beamup\.club/.test(RTBASE)) RTBASE = RTBASE.replace('.a.baby-beamup.club', '.baby-beamup.club'); // beamup-ডোমেইন-মাইগ্রেশন (a. বাদ)
function showCore(t) { // v1.15.4 সর্বজনীন-টাইটেল: 'One Piece S1E1' / 'One Piece season 1 episode 8' / 'One Piece s01e0001' / '1x01' / hindi-dub-কোয়ালিটি-টোকেন → খাঁটি-শো-নাম;
  let c2 = String(t || ''); // এক-জায়গায়-সব-আকৃতি-নরমালাইজ — প্রতি-ফরম্যাটে-বাইরের-অ্যাডন-আপডেট-লাগবে-না (ইউজার-নির্দেশ)
  const before = c2.trim();
  c2 = c2.replace(/\b(?:s\d{1,2}[\s._-]?e\d{1,4}|\d{1,2}x\d{1,4}|season[\s._-]?\d{1,2}|episodes?[\s._-]?\d{1,4}|ep[\s._-]?\d{1,4})\b/gi, ' ');
  c2 = c2.replace(/\b(?:hindi|dubbed|dub|subbed|sub|720p|1080p|480p|web[\s.-]?dl|bluray|hevc|x264|x265)\b/gi, ' ');
  c2 = c2.replace(/\s+/g, ' ').replace(/^[\s\-_:.,]+|[\s\-_:.,]+$/g, '').trim();
  return c2.length >= 2 ? c2 : (before || String(t || ''));
}
async function twrStreams(base, tag, title, type, s, e, pre) {
  if (!base || !title) return [];
  const tRaw = String(title);
  const tCore = showCore(tRaw); // v1.15.4: যেকোনো-আকৃতি → ক্যানোনিকাল-শো-নাম — সন্ধান/সিজন-ভ্যারিয়েন্ট/alt/গেট/ক্যাশ-সব-কোরে-চলে; কার্ড-লেখা-ইউজারের-মূল-নামে-ই
  // v1.15.8: কোনো-twr-ক্যাশ-নেই — প্রতি-ট্যাপ-রেজলভারে-তাজা-কোয়েরি (মিস-কখনো-পিন-হয়-না); prewarm-রেজলভার-উষ্ণ-রাখে-বলে-গতি-সুরক্ষিত
  const t3 = Date.now();
  const tries = [tCore]; // v1.15.4: ক্যানোনিকাল-আগে (খাঁটি-নামে-কোর===মূল — আচরণ-অপরিবর্তিত)
  if (tCore.toLowerCase() !== tRaw.toLowerCase()) tries.push(tRaw); // বিকৃত-আকৃতি-হলে-মূলটাও-১ম-ঢেউয়ে-সমান্তরালে
  const sq = tRaw.replace(/[^A-Za-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]/g, ''); // স্পেস/বিরামচিহ্ন-স্কোয়াশ ফলব্যাক
  if (sq && !tries.some(t2 => t2.toLowerCase() === sq.toLowerCase())) tries.push(sq);
  // v1.15.3: Season-যোগ্য-ভ্যারিয়েন্ট-১ম-ঢেউয়েই-সমান্তরালে (আগে-সিকোয়েন্সিয়াল-ফলব্যাকে-৫+৬=১১সে > ৯.৩সে-জানালা → One-Piece-জাতীয়-কাটা-পড়ত);
  // ম্যাস-টেস্ট-প্রমাণ: সমান্তরালে-চালালে-কোনো-শোর-ক্ষতি-নেই — যে-আকৃতি-আগে-ফল-দেয়-সেটাই-জেতে (Naruto=সাধারণ, One Piece/JJK=Season-আকৃতি)
  const seasTry = (type === 'series' && s && tag === 'toonworld') ? [tCore + ' Season ' + s] : []; // v1.15.4: কোর-ভিত্তিক ('One Piece S1E1 Season 1'-জাতীয়-আবর্জনা-নয়); শুধু-TW (RT-ইনডেক্স-ম্যাচ-নিজেই-ঠিক)
  // v1.13.5 সমান্তরাল-ফ্যানআউট: মূল+স্কোয়াশ-একসাথে, alt-লুকআপও-সমান্তরালে-ছোটানো — পরপর-অপেক্ষার-যোগফল-দেরি-নেই (দেয়াল-সময় = এক-ট্রাই-এর-সময়)
  const altP = tmdbAltTitles(tCore);
  const first = tries.concat(seasTry.filter(a => !tries.some(t => t.toLowerCase() === a.toLowerCase())));
  const w1 = first.map(t => twrFetch(base, tag, t, type, s, e, t3));
  tries.push(...first.slice(tries.length));
  // v1.15.3 প্রথম-জয়ী-রেস: Promise.all-ধীর-ভাইকে-অপেক্ষা-করাত (Season-ভ্যারিয়েন্ট-১সে-তে-৩-ফল-দিয়েও-ধীর-সাধারণ-স্ক্র্যাপ ১০-১২সে-ঢেউ-আটকে-রাখত → জানালা-কাটা);
  // এখন-যে-ট্রাই-প্রথম-অ-শূন্য-ফল-দেয়-সঙ্গে-সঙ্গে-জেতে; সব-শূন্য-হলেই-ফলব্যাক-ধাপ
  let used = -1;
  {
    let settled = false;
    const anyHit = new Promise(res => w1.forEach((p1, i1) => p1.then(v => { if (!settled && v && v.length) { settled = true; res(i1); } }).catch(() => {})));
    const allDone = Promise.all(w1.map(p1 => p1.catch(() => []))).then(() => -1);
    used = await Promise.race([anyHit, allDone]);
  }
  let r0 = used >= 0 ? await w1[used] : [];
  if (!r0.length) { // শেষ-ফলব্যাক: Season-যোগ্য-টাইটেল + TMDB-বিকল্প-টাইটেল — সব-একসাথে, অগ্রাধিকার-ক্রমে-প্রথম-জয়ী
    // v1.15.2 ম্যাস-টেস্ট-প্রমাণ: TW-ক্যাটালগ-ম্যাচ-কোয়েরি-আকৃতি-নির্ভর — One Piece/Jujutsu Kaisen 'X Season N'-এ-৩-ফল (সাধারণ-টাইটেলে-০);
    // Naruto-উল্টো (সাধারণ=৩, season=০) — তাই-সিজন-ভ্যারিয়েন্ট-শুধু-ফলব্যাকে (১ম-ধাপ-সাধারণ-টাইটেল-ই-জেতে-যেখানে-জেতা-হয়)
    const tSq = tCore.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]/g, '');
    const lcs4 = a => { // স্কোয়াশড-দুই-টাইটেলের-সাধারণ-খণ্ড ≥৪ — না-থাকলে-অনুবাদ/সংক্ষেপ-জাত-অর্থহীন-alt
      const aSq = String(a).toLowerCase().replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]/g, '');
      for (let i = 0; i + 4 <= aSq.length; i++) if (tSq.indexOf(aSq.slice(i, i + 4)) >= 0) return true; // aSq-এর-যেকোনো-৪-অক্ষর-খণ্ড tSq-তে-আছে-কি
      return false;
    };
    const seas = type === 'series' ? [tCore + ' Season ' + s, tCore + ' Season ' + String(s).padStart(2, '0')] : [];
    const alts = (await altP).filter(a => !tries.some(t => t.toLowerCase() === String(a).toLowerCase()) && lcs4(a)).slice(0, 4);
    const extra = seas.concat(alts).filter(a => !tries.some(t => t.toLowerCase() === String(a).toLowerCase()));
    tries.push(...extra);
    // v1.15.9: Promise.all → প্রথম-জয়ী-রেস (ঢেউ-১-এর-প্রমাণিত-প্যাটার্ন) — ফলব্যাকে-৫-ভ্যারিয়েন্ট-সবার-জন্য-অপেক্ষা-আর-নয়:
    // যে-ভ্যারিয়েন্ট-আগে-ফল-দেয়-জেতে (রেজলভার-হাতুড়ে-কমে — ঠান্ডা-জানালায়-সাইট-কম-থ্রটল-হয়), ধীর-ভাই-আর-সময়-নষ্ট-করে-না
    const w2 = extra.map(a => twrFetch(base, tag, a, type, s, e, t3));
    if (w2.length) {
      let settled2 = false;
      const anyHit2 = new Promise(res => w2.forEach((p2, i2) => p2.then(v => { if (!settled2 && v && v.length) { settled2 = true; res(i2); } }).catch(() => {})));
      const allDone2 = Promise.all(w2.map(p2 => p2.catch(() => []))).then(() => -1);
      const u2 = await Promise.race([anyHit2, allDone2]);
      if (u2 >= 0) { r0 = await w2[u2]; used = tries.length - extra.length + u2; }
    }
  }
  if (r0.length) {
    if (used >= 0 && tries[used].toLowerCase() !== tRaw.toLowerCase()) r0 = r0.map(z => { // কার্ড-টেক্সটে-ইউজারের-মূল-ডিসপ্লে-টাইটেল (v1.15.4: কোর-জয়েও-রিম্যাপ)
      const t2 = String(z.title || '').split(tries[used]).join(tRaw);
      return Object.assign({}, z, { title: t2, description: t2 });
    });
  } // v1.15.8: কোনো-twr-লেখা-নেই — কিছুই-পিন-হয়-না
  if (DBG) console.error('[twr] ' + tag + ' ' + String(title).slice(0, 30) + ' S' + (s || 1) + 'E' + (e || 1) + ' -> ' + r0.length + ' cards @' + (Date.now() - t3) + 'ms');
  return r0;
}

const ALTCACHE = new Map(); // নাম → লাতিন-বিকল্প-টাইটেল[] — মিসে-একবারই
async function tmdbAltTitles(name) {
  const k0 = String(name).toLowerCase();
  if (ALTCACHE.has(k0)) return ALTCACHE.get(k0);
  const out = [];
  try {
    const b = await tmdbGet('/search/multi?query=' + encodeURIComponent(String(name)), 8000);
    const hit = ((JSON.parse(b)).results || [])[0];
    if (hit && hit.id != null) {
      const ty = hit.media_type === 'movie' ? 'movie' : 'tv';
      const b2 = await tmdbGet('/' + ty + '/' + hit.id + '/alternative_titles', 8000);
      const arr = ((JSON.parse(b2)).results || []).map(r => String(r.title || '')).filter(t => t && /^[\x20-\x7E]+$/.test(t) && t.toLowerCase() !== k0);
      out.push(...arr.slice(0, 6));
    }
  } catch (_) {}
  ALTCACHE.set(k0, out);
  if (ALTCACHE.size > 1200) ALTCACHE.clear();
  return out;
}

function twTitleOk(title, fn) { // v1.13.5 ভুল-টাইটেল-বাধা: রেজলভারের-টোকেন-গেট-ছলে-যায় ("Breaking Bad"→"The Bad Guys Breaking In") — নামের-ভেতরে-সব-শব্দ-ক্রমে-থাকা-বাধ্যতামূলক (বা স্কোয়াশ-ফ্রেজ-মিল)
  const c = String(fn || '').replace(/^\[[^\]]*\]\s*/, '').replace(/[\u2018\u2019\u02BC']/g, '').toLowerCase(); // v1.15.11c: অ্যাপস্ট্রফি-মুছে-এক-টোকেন (I'll→ill দুই-পাশে-এক — slug-এ-"ill", কোয়েরিতে-"i ll" ভেঙে-ক্রম-আটকাত)
  const q = String(title || '').toLowerCase().replace(/[\u2018\u2019\u02BC']/g, '').replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]+/g, ' ').trim();
  if (!c || !q) return true; // বিচার-অসম্ভব → থাকুক
  const qt = q.split(' ');
  const cts = c.replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF]+/g, ' ').trim().split(' ');
  const qs2 = q.split(' ').join('');
  if (qs2.length >= 5 && cts.join('').indexOf(qs2) >= 0) return true; // স্কোয়াশ-ফ্রেজ — কেবল-≥৫-অক্ষর-কোয়েরিতে (ছোট-"bb"-"dubbed"-এর-মিলে-যাওয়া-বন্ধ)
  let i = 0;
  for (const t of cts) { if (t === qt[i]) i++; }
  return i >= Math.min(qt.length, Math.max(2, Math.ceil(qt.length * 0.6))); // v1.15.11: RT-পোস্ট-টাইটেল-প্রায়ই-কোয়েরির-শুরুর-অংশ-মাত্র → ৬০%-ক্রমানুসারে-মিল-যথেষ্ট; ভুল-শো (Breaking Bad→Bad Guys: ১/২) আগের-মতোই-বাদ
}

async function twrFetch(base, tag, title, type, s, e, t3) {
  const qs = new URLSearchParams({ source: tag, title: String(title || '').replace(/[\u2018\u2019\u02BC]/g, "'"), _: String(Date.now()) }); // v1.15.11: ইউনিকোড-অ্যাপস্ট্রফি→ASCII (রেজলভার-ক্যাশ-কী-একতা)
  if (type === 'series') { qs.set('season', String(s || 1)); qs.set('episode', String(e || 1)); }
  try {
    if (DBG) console.error('[twrURL] ' + base + '/find?' + qs.toString());
    const FU = base + '/find?' + qs.toString(); let b = '';
    if (HUB && !process.env.TWRT_BRIDGE) { // v1.15.63: TWRT_BRIDGE=থাকলে-এ-শাখা-বন্ধ — রেজলভার-ব্রিজ-নিজেই-tw/rt-সাব-স্পেস-খরচ-করে (ইউজারের-চূড়ান্ত-ম্যাপ: vidy=vidy/moviebox/multimovies, রেজলভার=toonworld4all/raretoons)
      try {
        const sp2 = HSPACE(tag); const kp = HKEY(sp2) ? '&key=' + encodeURIComponent(HKEY(sp2)) : '';
        const hr = await fetch(HUB + '/fetch?src=' + encodeURIComponent(sp2) + kp + '&ms=8000&url=' + encodeURIComponent(FU), { signal: AbortSignal.timeout(9500) });
        const hj = await hr.json();
        if (hj && hj.ok && String(hj.body || '')[0] === '{') { b = String(hj.body); console.error('[twrHUB] ' + tag + '-স্পেস-px=' + hj.px + ' ✓'); }
        else if (hj && hj.px) fetch(HUB + '/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ px: hj.px, ok: false, src: sp2 }) }).catch(() => { }); // echo-জাল/বক্র-বডি → প্রমাণ-ফেল (ঢেউয়ে-স্পেস-থেকে-নামবে)
      } catch { }
    }
    if (!b) b = await directGet(FU, 30000);
    const j = JSON.parse(b);
    // v1.12.3: twr-কার্ড-ও-ইউনিফর্ম-ভিডি-ফরম্যাটে (⧉ Title / ⧠ SsEe • EpTitle / ⨞ Server ⌧ Audio) — resolution-শুধু-name-ব্যাজে, সবসময়-1080 (Auto/360-লেবেল-নয়)
    const raws = ((j && j.results) || []).filter(x => x && typeof x.url === 'string' && /^https?:/.test(x.url));
    const cat0 = (j && j.catalog) || {}; // raretoons-ম্যাচ-পোস্ট-পরিচিতি — দুই-আকৃতি: {show} (ইনডেক্স-পথ) / {live: slug} (লাইভ-পথ)
    const catShow = String(cat0.show || cat0.live || '').replace(/-/g, ' ');
    const named = raws.filter(x => { // বিচারযোগ্য-নাম = ≥৪-অক্ষর, জেনেরিক-MQ-HLS-নাম-নয়
      const nm = String(x.name || '');
      return nm.length >= 4 && !/\b(raretoons|toonworld)?\s*mq\b/i.test(nm);
    });
    const qG = showCore(title); // v1.15.4 গেট-সংশোধন: রায়-শুধু-খাঁটি-শো-নামে — 'Season 1'-জাতীয়-কোয়েরি-টোকেন-কার্ড-লেখায়-থাকে-না-ই (সে/ই-ম্যাচ-রেজলভার-আগে-ই-করে-আনে); আগে-প্রাপ্ত-TW-কার্ড-এখানেই-বাদ-পড়ত (One-Piece-S1E8-মূল-কারণ)
    const keep = catShow ? twTitleOk(qG, catShow) // পোস্ট-পরিচিতি-থাকলে-সেটাই-চূড়ান্ত-রায়
          : (named.length ? named.some(x => twTitleOk(qG, x.name)) : false); // নইলে-নাম-ওয়ালা-কার্ড-রায়; সব-জেনেরিক+পরিচয়হীন → বাদ (ভুল-শো-MQ-লিক-বন্ধ — সুরক্ষা-অক্ষত)
    if (DBG) console.error('[twrGATE] ' + tag + ' title=' + String(title).slice(0, 34) + ' cat=' + (catShow || '(শূন্য)').slice(0, 50) + ' named=' + named.length + '/' + raws.length + ' keep=' + keep + ' names=' + raws.map(x => String(x.name || '').slice(0, 26)).join(' | ').slice(0, 110));
    const arr = (keep ? raws : []).map(x => {
      const hq = parseInt(String(x.quality || ''), 10) || 0; // রেজলভারের-আসল-উচ্চতা — twq-ফিল্টার-এর-জন্য
      const fn = String(x.name || '');
      const q2 = '1080';
      const lang = String(x.lang || '');
      const audio = lang || (/\b(multi|dual)\b/i.test(fn) ? 'Multi Audio' : 'Hindi Audio');
      const epLine = type === 'series' ? ('\u29e0 S' + (s || 1) + 'E' + (e || 1) + ((x.ep_title || '') ? ' \u2022 ' + x.ep_title : '')) : '\u29e0 Movie';
      const lbl = tag === 'toonworld' ? 'ToonWorld' : 'RareToons';
      const hu = String(x.url || '');
      const host = /pixeldrain/.test(hu) ? 'Pixeldrain' : (x.kind === 'hls' || /\/hls\//.test(hu)) ? 'MQ' : /hubcloud|yournewdomain/.test(hu) ? 'HubCloud' : 'Direct';
      const txt = '\u29c9 ' + String(title) + '\n' + epLine + '\n\u229e ' + lbl + ' \u00b7 ' + host + ' \u2317 ' + audio;
      return {
        name: '\u25a5 ' + q2 + ' \u25a5',
        title: txt,
        description: txt,
        quality: q2,
        _hq: hq,
        _lang: lang,
        url: String(x.url),
        behaviorHints: { notWebReady: false, isBingeable: true, filename: fn || (tag === 'toonworld' ? 'toonworld.mkv' : 'raretoons.mkv') },
        bingeGroup: (tag === 'toonworld' ? 'tw|' : 'rt|') + String(title).toLowerCase() + '::|' + (lang || 'Hindi')
      };
    });
    if (DBG) console.error('[twr] ' + tag + ' ' + String(title).slice(0, 30) + ' S' + (s || 1) + 'E' + (e || 1) + ' -> ' + arr.length + ' cards @' + (Date.now() - t3) + 'ms');
    return arr;
  } catch (e2) {
    if (DBG) console.error('[twr] ' + tag + ' ERR ' + String(e2 && e2.message).slice(0, 70) + ' @' + (Date.now() - t3) + 'ms');
    return [];
  }
}

/* ---------- Watchout (v1.15.39: TMDB-নেটিভ-পাবলিক-সূচি; সার্ভার-বান্ধব, রেফারার-চাবি-সহ) ---------- */
const WOBASE = String(process.env.WOBASE || 'https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main'); // স্ট্রিম-সূচি (মুভি: hls/movie/{tmdb}, টিভি: hls/tv/{tmdb}/S{n}.json); লোকাল-টেস্ট: WOBASE=http://127.0.0.1:8320
const WO_REF = 'https://vidout.pages.dev/'; // গোপন-চাবি: এই-Referer-ই স্ট্রিম-CDN-খোলে (না-দিলে-404)
const VB_REF = 'https://vidbolt.xyz/'; // v1.15.46: vidbolt-MM-রেজলভার-রেফারার (পেশাদার-ধ্রুবক — হার্ডকোড-বাদ)
// v1.15.52: স্থায়ী-হ্যাশ-স্মৃতি — vidbolt-ঘূর্ণন-ফাঁকে-আগে-দেখা-animecurx-হ্যাশ-থেকেই-কার্ড (প্রমাণ: পুরনো-হ্যাশ-বহুদিন-খোলে; ঘূর্ণনে-Lanterns-মাঝে-মাঝে-শূন্য-হয়)
const MMHC_FILE = require('path').join(__dirname, 'vidy_mm_hashes.json');
const MMHC = new Map();
try { for (const [kk, vv] of Object.entries(JSON.parse(require('fs').readFileSync(MMHC_FILE, 'utf8')))) MMHC.set(kk, vv); } catch { }
let MMHC_T = null;
const MM_MC = new Map(); // v1.15.55 খুঁত#৯: m → {ts, raw} — ৬০সে-মাস্টার-টেক্সট-ক্যাশ (প্লেয়ার-পুনঃঅনুরোধে-প্রতিবার-আপস্ট্রিম-ভ্রমণ-বন্ধ; সেগমেন্ট-তবু-সরাসরি-CDN)
const MM_VC = new Map(); // v1.15.55: vbq → {ts, m} — তাটা-রেজলভ-৬০সে-স্মৃতি (ঘা-ঘা-করে-vidbolt-রেজলভ-নয়)
function mmPut(map, k, v) { if (map.size > 300) map.clear(); map.set(k, { ts: Date.now(), v }); }
function mmGet(map, k, ttl) { const e = map.get(k); return e && (Date.now() - e.ts) < ttl ? e.v : null; }
function mmhcSave() { if (MMHC_T) return; MMHC_T = setTimeout(() => { MMHC_T = null; try { require('fs').writeFileSync(MMHC_FILE, JSON.stringify(Object.fromEntries(MMHC))); } catch { } }, 4000); }
function mmhcKey(isSeries, tmdbId, s2, e2) { return isSeries ? ('tv:' + tmdbId + ':' + (parseInt(s2, 10) || 1) + ':' + (parseInt(e2, 10) || 1)) : ('mv:' + tmdbId); }
const WO_LANGS = { eng: 'English', en: 'English', hin: 'Hindi', hi: 'Hindi', ara: 'Arabic', fra: 'French', spa: 'Spanish', por: 'Portuguese', rus: 'Russian', zho: 'Chinese', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu' };
function woAudioTag(pl) { // v1.15.47: সত্য-অডিও-দাবি — মাস্টার-প্লেলিস্টের EXT-X-MEDIA:TYPE=AUDIO গণনা (ইউজার-প্রমাণ: বেশিরভাগ-স্ট্রিমে-১টাই-অডিও, 'Multi Audio'-লেখা-মিথ্যা-ছিল)
  if (!pl) return '';
  const langs = [...String(pl).matchAll(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*/g)].map(m => {
    const l = (String(m[0]).match(/LANGUAGE="([^"]+)"/i) || [])[1] || (String(m[0]).match(/NAME="([^"]+)"/i) || [])[1] || '';
    return String(l).trim();
  }).filter(l => l && !/^(audio|def|main|default)$/i.test(l));
  const uniq = [...new Set(langs)];
  if (uniq.length >= 2) return uniq.length + ' Audio (' + uniq.slice(0, 3).join('+') + ')';
  if (uniq.length === 1) return uniq[0];
  return '';
}
function mmMiniKey(m, ref, h, vbq) { // v1.15.53: স্টেটলেস — কী-ই-সব-তথ্য-বহন-করে (মাস্টার|রেফ|উচ্চতা|vbq); .48-এর-সার্ভার-স্মৃতি-ম্যাপ MM_MINI রিস্টার্ট/ডিপ্লয়/অন্য-ইনস্ট্যান্সে-ফাঁকা-হত → প্লেয়ার-404-'gone' (ইউজার-রিপোর্টের-আসল-গল্প)
  return Buffer.from(m + '|' + (ref || WO_REF) + '|' + (h | 0) + '|' + (vbq || '')).toString('base64url');
}
function mmMiniOpen(k) { // কী-থেকে-প্যারাম-উদ্ধার — যেকোনো-ইনস্ট্যান্স, যেকোনো-সময়
  try {
    const pp = Buffer.from(k, 'base64url').toString('utf8').split('|');
    if (pp.length < 3 || !/^https?:\/\//.test(pp[0])) return null;
    return { m: pp[0], ref: pp[1] || WO_REF, h: parseInt(pp[2], 10) || 0, vbq: pp[3] || '' };
  } catch { return null; }
}
function mmMiniBuild(masterUrl, wantH, raw) { // v1.15.49: সব-গুণমান-থাকে (প্লেয়ার-মেনুতে-বদলানো-যায় — ইউজার-প্রমাণ: এক-ভেরিয়েন্ট-মিনিতে-অপশন-ই-নেই), চাওয়া-গুণমান-প্রথমে (শুরু-সেটাই); অডিও/সাব/KEY/MAP-URI-সব-পরম
  const L = String(raw).split('\n'); const tags = []; const vars = [];
  for (let i = 0; i < L.length; i++) {
    let ln = L[i];
    if (ln.charAt(0) === '#' && /EXT-X-(MEDIA|KEY|MAP|I-FRAME-STREAM-INF|SESSION)/.test(ln)) { tags.push(ln.replace(/URI="([^"]*)"/g, (mm, uu) => { try { return 'URI="' + new URL(uu, masterUrl).href + '"'; } catch { return mm; } })); continue; }
    if (/^#EXT-X-STREAM-INF/.test(ln)) {
      const nxt = L[i + 1] && L[i + 1].charAt(0) !== '#' ? L[i + 1].trim() : '';
      if (!nxt) continue;
      const r2 = (ln.match(/RESOLUTION=(\d+)x(\d+)/i) || [])[2];
      const hh = r2 ? parseInt(r2, 10) || 0 : 0;
      let abs2 = nxt; try { abs2 = new URL(nxt, masterUrl).href; } catch { }
      vars.push({ ln: ln, uri: abs2, h: hh, w: hh === wantH ? 0 : 1 });
      i++;
      continue;
    }
  }
  vars.sort((a, b) => a.w - b.w || b.h - a.h); // চাওয়া-গুণমান-আগে, তারপর-উঁচু-থেকে-নিচু
  const seenK = new Set(); const out = tags.slice();
  for (const v of vars.slice(0, 6)) { if (seenK.has(v.uri)) continue; seenK.add(v.uri); out.push(v.ln, v.uri); }
  if (!vars.length) return null; // ভেরিয়েন্ট-ই-নেই → কলার-raw-ফলব্যাক
  return out.join('\n');
}
function woHasAudioGrp(pl) { // v1.15.47: EXT-X-MEDIA:TYPE=AUDIO = অডিও-বাইরের-গ্রুপে → ভেরিয়েন্ট-শুধু-ভিডিও (হলস-স্পেক); মাস্টার-URL-না-দিলে-প্লেয়ার-অডিও-পায়-ই-না
  return /#EXT-X-MEDIA:TYPE=AUDIO/i.test(String(pl || ''));
}
function woPoolText(url, ms) { // v1.15.44: সরাসরি-প্রথম; ভিডি-র-নিজের-পুল-শুধু-উদ্ধারে — .42/.43-এ-প্রতি-ট্যাপে ~৪০-পুল-প্রোব-ঝড়ে-শেয়ার্ড-পুল+PX-পাইপলাইন-ডুবে-১২সে-চুক্তি-ভাঙছিল (প্রোড-প্রমাণিত); এখন-সুখ-পথে-শূন্য-অতিরিক্ত-প্রোব, সরাসরি-ফেললে-পুল-রেস
  const T = ms || 7000;
  return fetch(url, { headers: { 'User-Agent': UA, Referer: VB_REF }, signal: AbortSignal.timeout(Math.ceil(T * 0.55)) }).then(x => x.ok ? x.text() : '').catch(() => '').then(t => {
    if (t) return t;
    const sk = String(url).indexOf('vidbolt') >= 0 ? 'vb' : 'wo';
    if (HUB) return hubText(url, T, sk).then(h2 => h2 || racePool(url, 4, Math.ceil(T * 0.4), sk).then(r => String(r.body || '')).catch(() => '')).catch(() => ''); // v1.15.57: হাব-পুল-আগে → স্থানীয়-রেস-ফলব্যাক
    return racePool(url, 4, Math.ceil(T * 0.4), sk).then(r => String(r.body || '')).catch(() => '');
  });
}
function woFetch(url, ms) {
  return fetch(url, { headers: { 'User-Agent': UA, Referer: WO_REF, Accept: '*/*' }, signal: AbortSignal.timeout(ms || 7000) });
}
async function woSubs(tmdb, type, s, e, ms) { // sub/tv/{id}/{s}/{e}/subtitles.json | sub/movie/{id}/subtitles.json
  try {
    const u = type === 'series' ? (WOBASE + '/sub/tv/' + tmdb + '/' + (parseInt(s, 10) || 1) + '/' + (parseInt(e, 10) || 1) + '/subtitles.json') : (WOBASE + '/sub/movie/' + tmdb + '/subtitles.json');
    const r = await woFetch(u, Math.min(5000, ms || 5000));
    if (!r.ok) return [];
    const d = await r.json().catch(() => null);
    const subs = (d && d.subtitles) || {};
    return Object.keys(subs).slice(0, 8).map(k => ({ url: String(subs[k]), lang: WO_LANGS[String(k).toLowerCase()] || String(k).toUpperCase() })).filter(x => /^https?:/.test(x.url));
  } catch { return []; }
}
async function woVidbolt(tmdbId, isSeries, s, e, ms) { // v1.15.46: MM-রেজলভার-সম্পূর্ণ-ব্যবহার — সব-সোর্স (hls-ব্রিজ+সরাসরি-MP4), kind/quality/language-ফিল্ড, অভ্যন্তরীণ-বাজেট, সমান্তরাল-প্লেলিস্ট (গবেষণা-প্রমাণ: সোর্স={url,kind,quality,language}; পর্ব-নির্ভুল S1E1≠S2E1)
  const vT0 = Date.now(); const vLeft = cap => Math.max(350, Math.min(cap, (ms || 6500) - (Date.now() - vT0)));
  try {
    const q = isSeries ? ('type=tv&id=' + tmdbId + '&season=' + (parseInt(s, 10) || 1) + '&episode=' + (parseInt(e, 10) || 1)) : ('type=movie&id=' + tmdbId);
    const ck = mmhcKey(isSeries, tmdbId, s, e);
    const out = []; const oseen = new Set();
    const push = (h, url, ref, mp4, lang, aud, mini, k) => { const kk = k || url; if (kk && !oseen.has(kk)) { oseen.add(kk); out.push({ h: h | 0, url: url, ref: ref, mp4: mp4 ? 1 : 0, lang: lang || '', aud: aud || '', mini: mini ? 1 : 0, vbq: mini ? q : '' }); } };
    for (let draw = 0; draw < 3; draw++) { // v1.15.54: ঘূর্ণন-প্রতি-আঁকায়-ভিন্ন-সার্ভার — মৃত-আঁকা (ফল=০) হলে ৪৫০ms-পরে-আবার; প্রমাণ: একই-মুহূর্তে-বাইরের-কল ১০/১০-সফল, অ্যাডন-আঁকায়-মাঝে-মাঝে-৪০৪-সার্ভার
      let j = null;
      const jtxt = await woPoolText('https://vidbolt.xyz/api/resolve?' + q, vLeft(6500));
      try { j = jtxt ? JSON.parse(jtxt) : null; } catch { }
      let srcs = (j && j.stream && Array.isArray(j.stream.sources) ? j.stream.sources : []).slice(0, 8);
      if (!srcs.length) { // ঘূর্ণন-ফাঁক → স্মৃতির-হ্যাশ (সরাসরি-মাস্টার; পাইপলাইন-নিজেই-যাচায় — মৃত-হলে-সৎ-শূন্য)
        const cm = MMHC.get(ck);
        if (cm && cm.m) { if (DBG) console.error('[mm] হ্যাশ-স্মৃতি-ব্যবহার ' + ck); srcs = [{ url: cm.m, kind: 'hls', quality: cm.q || '', language: cm.lang || '' }]; }
        if (!srcs.length) continue;
      } else {
        for (const sc of srcs) { // স্থায়ী-প্রকৃতির-হ্যাশ-মনে-রাখা (স্বাক্ষরযুক্ত-অন্য-হোস্ট-বাদ — ওগুলো-মেয়াদ-শেষে-মৃত)
          const hm = sc && sc.url && String(sc.url).match(/\/tvshows\/([a-f0-9]{8,40})\/index\.m3u8/);
          if (hm) { MMHC.set(ck, { m: sc.url, q: String(sc.quality || ''), lang: String(sc.language || ''), at: Date.now() }); mmhcSave(); break; }
        }
        if (MMHC.size > 2500) { const cut = Date.now() - 30 * 86400e3; for (const [kk2, vv2] of MMHC) if (vv2.at < cut) MMHC.delete(kk2); }
      }
    await Promise.all(srcs.map(async sc => {
      const u = sc && sc.url;
      if (!u || !/^https?:/.test(u)) return;
      const hq = parseInt(String(sc.quality || ''), 10) || 0;
      const lang = String(sc.language || '').trim();
      if (String(sc.kind || '').toLowerCase() === 'mp4' || /\.mp4($|\?)/i.test(u)) { // সরাসরি-MP4 (proxy.vidbolt.xyz) — হেড-চেকে-সোজা-কার্ড; প্লেলিস্ট-দরকার-নেই
        try {
          const hd = await fetch(u, { headers: { 'User-Agent': UA, Referer: VB_REF }, method: 'GET', signal: AbortSignal.timeout(vLeft(4500)) }); // প্রমাণিত: এই-প্রক্সি HEAD-এ-ঝুলে (টাইমআউট), GET-এ ৩৬০ms-এ-হেডার
          if (hd.ok) { try { if (hd.body) hd.body.cancel(); } catch { } push(hq, u, VB_REF, 1, lang); } // হেডার-পেলেই-যথেষ্ট — বডি-বাতিল (১.৪৫GB-নামানো-নয়)
        } catch { }
        return;
      }
      try {
        const pl = await woPoolText(u, vLeft(5500)); // hls-ব্রিজ — সরাসরি-প্রথম, পুল-উদ্ধারে
        if (!pl || pl.indexOf('#EXTM') < 0) return;
        let base = u; try { base = new URL(u).href.replace(/[^/]*$/, ''); } catch { }
        const lines = pl.split('\n'); let found = 0; const atag = woAudioTag(pl); // v1.15.47: এ-প্লেলিস্টের-সত্য-অডিও
        if (woHasAudioGrp(pl)) { // অডিও-গ্রুপ-ঘোষিত → প্রতি-গুণমানে-মিনি-মাস্টার-কার্ড (রেজোলিউশন-হাতে-আটকানো+অডিও-অক্ষত; v1.15.48)
          let pcount = 0;
          for (let jj = 0; jj < lines.length - 1 && pcount < 4; jj++) {
            if (lines[jj].indexOf('#EXT-X-STREAM-INF') < 0) continue;
            const r2 = lines[jj].match(/RESOLUTION=(\d+)x(\d+)/i);
            const hh = r2 ? parseInt(r2[2], 10) || 0 : 0;
            const kk = 'm' + hh;
            if (oseen.has(kk)) continue;
            oseen.add(kk);
            push(hh || hq, u, VB_REF, 0, lang, atag, 1, kk);
            pcount++;
          }
          if (!pcount) push(hq, u, VB_REF, 0, lang, atag, 1, 'mx');
          return;
        }
        for (let jj = 0; jj < lines.length - 1 && found < 3; jj++) {
          if (lines[jj].indexOf('#EXT-X-STREAM-INF') < 0) continue;
          const rm = lines[jj].match(/RESOLUTION=(\d+)x(\d+)/i);
          const uri = String(lines[jj + 1] || '').trim();
          if (!uri || uri.charAt(0) === '#') continue;
          let abs = uri; try { abs = new URL(uri, base).href; } catch { }
          push(rm ? parseInt(rm[2], 10) || 0 : hq, abs, VB_REF, 0, lang, atag);
          found++;
        }
        if (!found && /#EXTINF/.test(pl)) push(hq, u, VB_REF, 0, lang, atag); // মিডিয়া-প্লেলিস্ট-সরাসরি — quality-ফিল্ড-থেকে-উচ্চতা
      } catch { }
    }));
      if (DBG) console.error('[mm] vb আঁকা-' + draw + ' সোর্স=' + srcs.length + ' ফল=' + out.length + ' @' + (Date.now() - vT0) + 'ms');
      if (out.length) break;
      if (draw < 2 && vLeft(1500) > 800) await new Promise(r3 => setTimeout(r3, 450));
    }
    return out.slice(0, 10);
  } catch { return []; }
}

async function woStreams(tmdbId, title, type, s, e, cfg, origin) { // origin: v1.15.48-মিনি-মাস্টার-URL-এর-জন্য // TMDB-আইডি-সরাসরি — টাইটেল-ম্যাচ-দরকার-নেই (হুবহু-নির্ভুল)
  if (!WOBASE || !tmdbId) return [];
  const t3 = Date.now(); const WOB = 9000; const left = () => Math.max(300, WOB - (Date.now() - t3));
  try {
    const isSeries = type === 'series';
    const u = isSeries ? (WOBASE + '/hls/tv/' + tmdbId + '/S' + (parseInt(s, 10) || 1) + '.json') : (WOBASE + '/hls/movie/' + tmdbId);
    const vbP = woVidbolt(tmdbId, isSeries, s, e, left()).catch(() => []); // v1.15.41: সমান্তরাল — সূচি-থাকুক-বা-না-থাকুক
    const idxRes = await woFetch(u, left()).catch(() => null); // v1.15.45: সরাসরি-woFetch(WO_REF) — vidout-সূচি-পথে-হেডারহীন-পুল-রেস-৪০৪-নিশ্চিত-ব্যর্থ (রেফারার-বাধ্যতামূলক, পুনঃপ্রমাণিত) — বৃথা-প্রোব+pxRec-শাস্তি-বন্ধ
    const idxTxt = idxRes && idxRes.ok ? await idxRes.text().catch(() => '') : '';
    const r0ok = !!idxTxt;
    let servers = [];
    if (r0ok) {
      if (isSeries) {
        const d = (() => { try { return JSON.parse(idxTxt); } catch { return null; } })();
        const ep = String(parseInt(e, 10) || 1);
        if (d && typeof d[ep] === 'string') servers = [d[ep]]; // হুবহু-পর্বই — ভুল-পর্ব-নয় (সৎ)
      } else {
        const txt = idxTxt.trim();
        if (txt && /^https?:/.test(txt)) servers = [txt.split('\n')[0].trim()];
      }
    }
    servers = servers.slice(0, 6);
    const lists = servers.length ? await Promise.all(servers.map(su => woFetch(su, Math.min(6500, left())).then(x => x.ok ? x.text() : '').catch(() => ''))) : []; // v1.15.45: সরাসরি-woFetch(WO_REF) (.41-প্রমাণিত); শূন্য-সূচি=শূন্য-তালিকা — vidbolt-ই-কার্ড-দেবে
    const woq = Array.isArray(cfg && cfg.woq) ? cfg.woq : [];
    const seen = new Set(); const raws = [];
    for (let i = 0; i < lists.length; i++) {
      const pl = lists[i];
      if (!pl || pl.indexOf('#EXTM') < 0) continue;
      let base = servers[i]; try { base = new URL(servers[i]).href.replace(/[^/]*$/, ''); } catch { }
      const atag = woAudioTag(pl); // v1.15.47: সত্য-অডিও (যেমন-স্কয়ার-গেমে hi+en)
      const lines = pl.split('\n'); // ঘোষণা-আগে (TDZ-দোষ-সংশোধন)
      if (woHasAudioGrp(pl)) { // অডিও-গ্রুপ-ঘোষিত → প্রতি-গুণমানে-মিনি-মাস্টার-কার্ড (রেজোলিউশন-হাতে-আটকানো+অডিও-অক্ষত; v1.15.48)
        let pcount = 0;
        for (let j2 = 0; j2 < lines.length - 1 && pcount < 4; j2++) {
          if (lines[j2].indexOf('#EXT-X-STREAM-INF') < 0) continue;
          const r3 = lines[j2].match(/RESOLUTION=(\d+)x(\d+)/i);
          const hh = r3 ? parseInt(r3[2], 10) || 0 : 0;
          const kk = 'm' + i + 'h' + hh;
          if (seen.has(kk)) continue;
          seen.add(kk);
          raws.push({ h: hh, url: servers[i], aud: atag, mini: 1 });
          pcount++;
        }
        if (!pcount && !seen.has(servers[i])) { seen.add(servers[i]); raws.push({ h: 0, url: servers[i], aud: atag, mini: 1 }); }
        continue;
      }
      let found = 0;
      for (let j = 0; j < lines.length - 1; j++) {
        if (lines[j].indexOf('#EXT-X-STREAM-INF') < 0) continue;
        const rm = lines[j].match(/RESOLUTION=(\d+)x(\d+)/i);
        const uri = String(lines[j + 1] || '').trim();
        if (!uri || uri.charAt(0) === '#') continue;
        let abs = uri; try { abs = new URL(uri, base).href; } catch { }
        const h = rm ? parseInt(rm[2], 10) || 0 : 0;
        if (!seen.has(abs)) { seen.add(abs); raws.push({ h, url: abs, aud: atag }); found++; }
        if (found >= 6) break;
      }
      if (!found && /#EXTINF/.test(pl) && !seen.has(servers[i])) { seen.add(servers[i]); raws.push({ h: 0, url: servers[i], aud: atag }); } // মাস্টার-ই-মিডিয়া-প্লেলিস্ট
    }
    try { const vbl = await vbP; for (const v of (vbl || [])) if (v && v.url && !seen.has(v.url)) { seen.add(v.url); raws.push(v); } } catch { } // v1.15.41: vidbolt-ভেরিয়েন্ট-মেশানো
        if (DBG) console.error('[mm] ' + tmdbId + '/' + (isSeries ? 'S' + (s || 1) + 'E' + (e || 1) : 'movie') + ' সার্ভার=' + servers.length + ' ভেরিয়েন্ট=' + raws.length + ' @' + (Date.now() - t3) + 'ms');
    let vars = raws.filter(x => !woq.length || woq.indexOf(x.h) >= 0);
    vars.sort((a, b) => b.h - a.h);
    vars = vars.slice(0, 12);
    if (!vars.length) return [];
    const subs = await woSubs(tmdbId, type, s, e, left()).catch(() => []);
    const T = String(title || 'Multimovies');
    const epLine = isSeries ? ('\u29e0 S' + (parseInt(s, 10) || 1) + 'E' + (parseInt(e, 10) || 1)) : '\u29e0 Movie';
    return vars.map(x => {
      const q2 = x.h ? String(x.h) : (x.mp4 ? 'MP4' : 'HLS');
      const aud = [x.aud, x.lang].filter(Boolean).join(' \u00b7 '); // v1.15.47: সত্য-অডিও-গণনা+vidbolt-ভাষা — দাবি-নেই-হলে-কিছু-লেখা-নয়
      const txt = '\u29c9 ' + T + '\n' + epLine + '\n\u229e Multimovies \u00b7 ' + (x.mp4 ? 'MM-MP4' : 'MM-HLS') + (aud ? ' \u2317 ' + aud : '') + (subs.length ? ' \u2022 \ud83c\udfac' : '');
      return {
        name: '\u25a5 ' + q2 + ' \u25a5',
        title: txt,
        description: txt,
        quality: q2,
        url: x.mini ? (origin ? origin + '/mm/' + mmMiniKey(x.url, x.ref || WO_REF, x.h, x.vbq) + '/mini.m3u8' : x.url) : x.url, // v1.15.49: +vbq — উজ্জ্বল-স্বাক্ষর-প্রতি-অনুরোধে
        behaviorHints: { notWebReady: false, isBingeable: true, filename: x.mp4 ? 'multimovies.mp4' : 'multimovies.m3u8', proxyHeaders: { request: { Referer: x.ref || WO_REF, 'User-Agent': UA } } }, // v1.15.41: প্রতি-সার্ভার-নিজের-রেফারার
        bingeGroup: 'mm|' + T.toLowerCase() + '::',
        ...(subs.length ? { subtitles: subs.map(y => ({ url: y.url, lang: y.lang })) } : {})
      };
    });
  } catch (e2) {
    if (DBG) console.error('[mm] ERR ' + String(e2 && e2.message).slice(0, 70) + ' @' + (Date.now() - t3) + 'ms');
    return [];
  }
}

// ---------- বহু-সোর্স-মার্জ (withNx-এর-সাধারণ-রূপ — একই-অনুগ্রহ-বাজেট, সব-সোর্স-একসাথে-রেস) ----------
async function withSources(cardsP, srcs, cfg, t0) {
  const cards = await cardsP.catch(e => { if (DBG) console.error('[srcdbg] cardsP died: ' + String(e && e.message || e).slice(0, 90)); return []; });
  const live = (srcs || []).filter(x => x && x.p && !(cfg && cfg[x.key] === 0));
  if (!live.length) return cards; // সব-বন্ধ → শূন্য-অপেক্ষা
  try {
    const el = Date.now() - t0;
    // v1.14.6 ঐক্যবদ্ধ-১ম-ক্লিক-সময়সীমা (ইউজার-টপ-অগ্রাধিকার: প্রতি-নির্বাচিত-সোর্স-১ম-ক্লিকেই):
    // সব-লাইভ-সোর্স-একই-পরম-সীমা ~৯.৩সে (রুট-সেফটি ১০সে/এজ-কাট ১২সে-র-ভেতরে) — যে-সোর্স-আগে-সেটল
    // উত্তর-তার-পরেই (দ্রুত-ক্ষেত্রে ২-৫সে), ধীর-সোর্স-কাটা-পড়ার-আগে-সর্বোচ্চ-সময়-পায়। পৃথক-৫.৫/৮.৫সে-জানালা-বাদ —
    // প্রোডে-চাইল্ড/রেজলভার-লেটেন্সি-ওঠানামায়-পৃথক-জানালা-১ম-ক্লিক-মিস-করত (MB কখনো ৬.৬সে-তে-১৬-কার্ড, কখনো >৫.৫সে)।
    const uniLeft = Math.max(0, Math.min(NXDEADLINE, 10800) - el); // v1.15.12: প্রথম-ক্লিক-সীমা ৯.৩→১০.৮সে (ইউজার-রিপোর্ট: সীমানায়-n=0; লগ-প্রমাণ tt7326322 ১০সে→০)
    let errFlag = false; // v1.15.3: সোর্স-ত্রুটি (রিবিল্ড/নেটওয়ার্ক) ≠ সত্যিকারের-খালি — আংশিক-গণ্য হোক
    const outs = await Promise.all(live.map(x => Promise.race([
      x.p.catch(() => { errFlag = true; return []; }),
      new Promise(r => setTimeout(() => r(null), uniLeft))
    ])));
    let all = cards.slice();
    for (let i = 0; i < live.length; i++) {
      const v = outs[i];
      if (!v || !v.length) continue;
      if (live[i].key === 'nx') {
        const nxAllow = qToList(cfg && cfg.nxq);
        const nxSel = Array.isArray(cfg && cfg.nxl) ? cfg.nxl : [];
        const strict = v.filter(z => qPass(z, nxAllow) && nxLangPass(z, nxSel));
        if (strict.length || !v.length) all = all.concat(strict); // কড়া-মিল-থাকলে-সেটাই
        else { // v1.15.14 শিথিল-ফলব্যাক: কড়া-কম্বোয়-০-হলে কাছের-যা-আছে-তা-ই (উদ্ধৃত-কেস: একমাত্র-1080=কান্নাড়া, English/Hindi=শুধু-480p → আগে-পরম-শূন্য)
          const qOnly = v.filter(z => qPass(z, nxAllow));
          all = all.concat(qOnly.length ? qOnly : v);
          if (DBG) console.error('[nxFALLBACK] strict=0 -> ' + (qOnly.length ? 'quality-only ' + qOnly.length : 'raw ' + v.length) + ' cards');
        }
      } else if (live[i].key === 'rt') {
        const rtSel = Array.isArray(cfg && cfg.rtl) ? cfg.rtl : [];
        all = all.concat(v.filter(z => rtLangPass(z, rtSel)));
      } else if (live[i].key === 'tw') {
        const twAllow = qToList(cfg && cfg.twq); // ToonWorld-নিজের-চিপস — রেজলভারের-আসল-উচ্চতায়
        all = all.concat(twAllow.length ? v.filter(z => !z._hq || twAllow.indexOf(z._hq) >= 0) : v);
      } else all = all.concat(v);
    }
    if (DBG) console.error('[srcdbg] withSources el=' + el + 'ms uniLeft=' + uniLeft + 'ms → ' + all.length + ' কার্ড (partial=' + !!all.$partial + ')');
    all.$partial = outs.some(v => v === null) || errFlag; // v1.15.3: কাটা-বা-ত্রুটিজ-সোর্স → ৩০মিন-নয়-৯০সে-ক্যাশ (পরের-ট্যাপে-সম্পূর্ণ-আপগ্রেড)
    return all;
  } catch (e) { if (DBG) console.error('[srcdbg] ERR ' + String(e && e.message).slice(0, 80)); return cards; }
}

// ---------- sources ----------
// সার্ভার-স্কোর: যেটা-ভালো-চলে-সেটাই-সবসময়-আগে (ফাইলে-জমে — রিস্টার্টেও-মনে-থাকে):
const SRV_SCORE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'vidy_server_scores.json'), 'utf8')); } catch (e) { return {}; } })();
function srvBump(srv, d) {
  SRV_SCORE[srv] = Math.max(-20, Math.min(20, (SRV_SCORE[srv] || 0) + d));
  try { fs.writeFileSync(path.join(__dirname, 'vidy_server_scores.json'), JSON.stringify(SRV_SCORE)); } catch (e) {}
}
const srvOrder = () => SERVERS.slice().sort((a, b) => (SRV_SCORE[b] || 0) - (SRV_SCORE[a] || 0));
// প্রথম-সোর্স-URL-বাঁচা-কি-না (master-m3u8-ছোট — সস্তা-GET; Referer-ছাড়া-CDN-403-দেয়):
function probePlaylist(u, hop) { // Auto-HLS-master পড়ে-সর্বোচ্চ-উচ্চতা-বের-করে (ok=২০০); বড়-বডি-১২৮KB-তে-কাটা
  return new Promise(resolve => {
    const mod2 = u.indexOf('http:') === 0 ? http : https;
    const req = mod2.get(u, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': VIDY_REFERER, 'Connection': 'close' }, timeout: 3500, agent: u.indexOf('http:') === 0 ? HAGENTP : SAGENTP }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hop || 0) < 2) { res.resume(); return resolve(probePlaylist(new URL(res.headers.location, u).toString(), (hop || 0) + 1)); }
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, h: 0 }); }
      const ch = []; let n = 0;
      res.on('data', d => { n += d.length; if (n <= 131072) ch.push(d); });
      res.on('end', () => {
        const t = Buffer.concat(ch).toString('latin1');
        if ((hop || 0) < 2 && t.trim().charAt(0) === '{') { // player-config JSON (dallas-জাতীয়) — ভেতরের-.m3u8-খুঁজে-পুনঃপ্রোব
          const m3 = (t.match(/https?:[^"'\s]+\.m3u8[^"'\s]*/) || [])[0];
          if (m3) return resolve(probePlaylist(m3, (hop || 0) + 1));
        }
        const hs = [...t.matchAll(/RESOLUTION=\d+x(\d+)/g)].map(m => Number(m[1]));
        let h = hs.length ? Math.max(...hs) : 0;
        if (!h) { // BANDWIDTH-only masters (majorplay): industry ladder heuristic
          const bws = [...t.matchAll(/BANDWIDTH=(\d+)/g)].map(m => Number(m[1]));
          if (bws.length) { const b = Math.max(...bws); h = b >= 2200000 ? 1080 : b >= 900000 ? 720 : b >= 450000 ? 480 : 360; }
        }
        const auds = [...new Set([...t.matchAll(/TYPE=AUDIO[^>'"\n]*?LANGUAGE="([a-zA-Z]{2,3})"/g)].map(m2 => iso3Name(m2[1])).filter(Boolean))]; // সোর্স-নিজের-ঘোষণা — TMDB-অনুমানের-চেয়ে-সত্য
        resolve({ ok: true, h, auds });
      });
      res.on('error', () => resolve({ ok: false, h: 0 }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok: false, h: 0 }));
  });
}
function probeAny(urls) { // প্রথম-জীবিত-রায়-সঙ্গে-সঙ্গে-জয়ী; সব-ব্যর্থ-হলেই-মৃত
  return new Promise(resolve => {
    let left = urls.length, settled = false;
    urls.forEach(u => playable(u).then(v => {
      if (settled) return;
      if (v) { settled = true; resolve(true); }
      else if (--left === 0) { settled = true; resolve(false); }
    }));
  });
}
function playable(u, hop) {
  if (!u || !/^https?:/.test(u)) return Promise.resolve(false);
  return new Promise(resolve => {
    const mod = u.indexOf('http:') === 0 ? http : https;
    const req = mod.get(u, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': VIDY_REFERER, 'Connection': 'close' }, timeout: 3500, agent: u.protocol === 'http:' ? HAGENTP : SAGENTP }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hop || 0) < 2) { // a redirect is served by a live server — follow it
        const loc = new URL(res.headers.location, u).toString();
        res.resume();
        return resolve(playable(loc, (hop || 0) + 1));
      }
      const ok = res.statusCode === 200;
      res.destroy(); // শুধু-স্ট্যাটাস-দরকার — প্লেলিস্ট-বডি (৩০০KB-পর্যন্ত) টানা-বৃথা
      resolve(ok);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve(false));
  });
}
function getSources(tmdbId, type, s, e, title, cfg, titleP) { // titleP: টাইটেলের-প্রমিস — sources-সমান্তরালে-ছোটা-হয়
  const qsig = (Array.isArray(cfg && cfg.q) ? cfg.q.slice().sort((a, b) => a - b).join('.') : String((cfg && cfg.q) || '')) + ':' + ((cfg && cfg.sub) === 0 ? 0 : 1) + ':' + ((cfg && Array.isArray(cfg.srv) && cfg.srv.length) ? cfg.srv.slice().sort().join('.') : '');
  const key = ['src', VERSION, tmdbId, type, s || '', e || '', qsig].join('|'); // VERSION+cfg-ভার্সনড — ভিন্ন-ফিল্টার-ভিন্ন-ক্যাশ
  // v1.15.8 (ইউজার): ৩-ঘণ্টা-মেমো+৬০সে-মেমোশর্ট-পাঠ-বিলোপ — এটাই-ছিল-সবচেয়ে-বড়-মিস-পিনার (মিস-সহ-উত্তর-৩ঘণ্টা-আটকে-থাকত); প্রতি-ট্যাপ-প্রকৃত-স্ক্যান
  return dedupe(key, async () => {
    const epMetaP = epMetaFor(tmdbId, type, s, e); // বছর+এপি-টাইটেল — স্ক্যানের-সমান্তরালে
    const olP = origLangForTmdb(tmdbId, type); // আসল-অডিও-ভাষা (TMDB) — সমান্তরালে
    let lastErr = null;
    let force = false;
    let bestAny = null; let bestAnySrv = null; let bestAnyNs = -1; // সবচেয়ে-সাবসমৃদ্ধ (মূল-অডিওর-চিহ্ন)
    let deadJ = null;
    let deadSrv = null;
    const t0 = Date.now();
    // v1.11.2: seed-আগেই-একবার (আগেও-প্রতিটা-one()-এর-প্রথম-await-এই-এক-ই-ছিল — লেটেন্সি-অপরিবর্তিত);
    // পথ-জানা-হলে-বাজেট-পথ-অনুযায়ী: প্রক্সি-চেইন (৪২৯-উইন্ডো) ধীর-কিন্তু-জীবন্ত — বাজেট-প্রশস্ত-না-হলে ৪.৭-৬.৩সে-র-সফল-ফেচ-বাদ-পড়ত
    const sc0 = await getSeed(tmdbId, false).catch(() => null);
    const viaProxy = !!(sc0 && sc0.via === 'proxy');
    const ckFor = srv => ['srvc', VERSION, tmdbId, type, s || '', e || '', srv].join('|');
    const allow = srvOrder().filter(srv => !cfg || !Array.isArray(cfg.srv) || !cfg.srv.length || cfg.srv.indexOf(srv) >= 0); // cfg-সার্ভার-সাবসেট
    const one = async srv => {
      const ck = ['srvc', VERSION, tmdbId, type, s || '', e || '', srv].join('|');
      // v1.15.8 (ইউজার): SRV_CACHE/SRV_NEG-পাঠ-বিলোপ — প্রতি-ট্যাপ-লাইভ-স্ক্যান; নতুন/মিস-হওয়া-স্ট্রিম-পরের-ক্লিকেই-ধরা-পড়ে
      // এক-সার্ভার-সম্পূর্ণ-মূল্যায়ন (seed+sources+প্রোব):
      const tS = Date.now(); // try-এর-বাইরে — catch-ও-লগ-দেখাতে-পারে
      try {
        const sc = (sc0 && !force) ? sc0 : await getSeed(tmdbId, force);
        if (DBG) console.error('[t1g] ' + srv + ' seed=' + (Date.now() - tS) + 'ms via=' + sc.via);
        const q = { mediaType: type, tmdbId: String(tmdbId), enc: '2', seed: sc.seed, title: title || '' };
        if (type === 'tv') { q.seasonId = String(s || 1); q.episodeId = String(e || 1); } // ভুল-ছিল s/e — upstream-এগুলো-উপেক্ষা-করত → সবসময়-EP1
        const u = API + '/' + srv + '/sources?' + new URLSearchParams(q).toString();
        // v1.11.2 FETCH-HEDGE: আটকে-যাওয়া-আপস্ট্রিম-উত্তরের (phoenix 4.9s, dallas/tampa 7.5s+) +2.5সে-পরে-আরেক-টা-একই-কল;
        // প্রথম-সফল-টা-জেতে, হেরে-যাওয়া-টা-বাদ। প্রতি-সার্ভার-এখনো-এক-স্ক্যান-ফল-দেয়।
        const ct = await hedge2(() => pathGet(u, sc.via, sc.px, 12000), () => pathGet(u, sc.via, sc.px, 12000), 2500, 12500);
        const j = JSON.parse(vidyDecrypt(ct, sc.seed, tmdbId));
        if (DBG) console.error('[t1g] ' + srv + ' fetch=' + (Date.now() - tS) + 'ms n=' + (j.sources || []).length + ' | jkeys=' + Object.keys(j).join(',') + ' | s0=' + JSON.stringify((j.sources || [])[0] || {}).slice(0, 220) + (j.audios ? ' | audios=' + JSON.stringify(j.audios).slice(0, 200) : '') + (j.audio ? ' | audio=' + JSON.stringify(j.audio).slice(0, 120) : ''));
        if (DBG && j.playlist) console.error('[t1g] ' + srv + ' PLAYLIST=' + JSON.stringify(j.playlist).slice(0, 500));
        if (!j.sources || !j.sources.length) {
          if (DBG) console.error('[t1g] ' + srv + ' EMPTY at ' + (Date.now() - tS) + 'ms');
          force = true; return { srv, empty: true };
        }
        // v1.9.0 filter-aware probing: never spend probe time on assets the filter will discard.
        const allowD = Array.isArray(cfg && cfg.q) ? cfg.q : qToList(cfg && cfg.q);
        const pass = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && qPass(x, allowD));
        // v1.11.2 PROBE-RACE: top-2-ফিল্টার-পাস-অ্যাসেট-একসাথে-প্রোব; প্রথম-জীবিত-রায়-তৎক্ষণাৎ-জেতে,
        // মৃত-রায়-আসে-কেবল-দুটোই-মৃত-হলে। ধীর/মৃত-প্রথম-লিংক-আর-পুরো-সার্ভার-জিম্মি-করে-না।
        // v1.11.9: Auto-লেবেল-থাকলে-master-playlist-পড়ে-আসল-সর্বোচ্চ-উচ্চতা-বসে ('Auto er jaigai highest resolution')
        const autoRows = pass.filter(x => !/^\d{3,4}$/.test(String(x.quality || '').replace('p', '')));
        let autoH = 0;
        // v1.11.11: payload-এর-নিজস্ব-মাস্টার (j.playlist) আগে — ওখানেই EXT-X-MEDIA-অডিও-ঘোষণা; মৃত-হলে-আগের-সব-পথ-অক্ষত
        const masterU = (j.playlist && /^https?:/.test(String(j.playlist))) ? String(j.playlist) : '';
        let pr = masterU ? await probePlaylist(masterU) : null;
        if (!pr || !pr.ok) {
          if (autoRows.length) { let r2 = await probePlaylist(autoRows[0].url); if (!r2.ok && autoRows[1]) r2 = await probePlaylist(autoRows[1].url); if (!pr || r2.ok) pr = r2; }
          else if (pass.length > 1) pr = { ok: await probeAny([pass[0].url, pass[1].url]), h: 0, auds: [] };
          else if (pass.length) pr = { ok: await playable(pass[0].url), h: 0, auds: [] };
          else if (!pr) pr = { ok: true, h: 0, auds: [] }; // zero filter-matches -> probe skipped entirely
        }
        autoH = pr.h || 0;
        if (pr.auds && pr.auds.length) j._audN = pr.auds.join('/'); // সোর্স-ঘোষিত-ভাষা — TMDB-অনুমানকে-হারায়
        const ok = !!pr.ok;
        if (autoH) j.sources.forEach(x => { if (!/^\d{3,4}$/.test(String(x.quality || '').replace('p', ''))) x.quality = autoH + 'p'; });
        const ns = (j.subtitles || []).length;
        const nfit = ok ? decorate(j, type, s, e, title || '', cfg, srv).length : 0;
        if (DBG) console.error('[t1g] ' + srv + ' probe=' + (Date.now() - tS) + 'ms ok=' + ok + ' nfit=' + nfit + ' ns=' + ns);
        // v1.15.8: ক্যাশ-লেখা-বিলোপ — প্রতি-ট্যাপ-তাজা
        return { srv, j, ok, ns, nfit };
      } catch (er) {
        if (DBG) console.error('[t1g] ' + srv + ' ERR at ' + (Date.now() - tS) + 'ms: ' + String(er && er.message).slice(0, 60));
        force = true; return { srv, err: er };
      }
    };
    const absorb = r => {
      if (r.late) return; // v1.14.2 early-harvest-কাট — দোষ-নেই, শাস্তি/নেগ-নয় (পেছনে-ক্যাশে-জমবে)
      if (r.neg) return; // নেগেটিভ-হিট — স্কোর-আর-শাস্তি-নয়
      if (r.err) { srvBump(r.srv, -1); lastErr = r.err; return; }
      if (r.empty) { srvBump(r.srv, 0); return; }
      if (r.ok) {
        if (r.ns > bestAnyNs) { bestAny = r.j; bestAnySrv = r.srv; bestAnyNs = r.ns; }
        srvBump(r.srv, r.nfit > 0 ? (r.ns >= 5 ? 2 : 1) : 0); // ভালো-সার্ভার-সবসময়-আগে
      } else { deadJ = r.j; deadSrv = r.srv; srvBump(r.srv, -1); }
    };
    // সব-নির্বাচিত-সার্ভার-একসাথে-সমান্তরাল — কোনো-আগে-থামা-নয়: "সবগুলা-সোর্স = সবগুলা-স্ট্রিম"
    // প্রতি-সার্ভার-হার্ড-বাজেট: দৈত্য-ত্রয়ী (miami/boise/atlanta) ১০.৫সে — ধীর-হলেও-ফল-সহ্য-করবে; বাকিরা ৭.৫সে:
    // v1.9.0 fix: the timeout timer used to fire even when one() had already won the race,
    // negative-caching healthy servers for 45-90s after every scan (empty-card windows).
    // Now the neg write only happens when the timeout genuinely fires first.
    let okWave = 0; // v1.14.2 early-harvest: কত-সার্ভার-ইতিমধ্যে-জিতেছে
    const pend = new Map(); // v1.14.2 early-harvest: এখনো-ঝুলন্ত-সার্ভারের-রেজলভার
    const budget = srv => {
      let done = false;
      let fire = null;
      const tmo = setTimeout(() => {
        if (done || !fire) return; // one() won — server is healthy, no neg
        if (DBG) console.error('[t1g] ' + srv + ' BUDGET-CUT');
        pend.delete(srv); // v1.14.2: বসে-গেছে — early-harvest-গণিত-যেন-ভুল-না-হয়
        fire({ srv, err: new Error('srv-budget') });
      }, GIANT.indexOf(srv) >= 0 ? (viaProxy ? 6500 : 5500) : (viaProxy ? 5500 : 3800)); // v1.15.24 (ইউজার: '৬-৭সে-তে-সব-কার্ড'): প্রক্সি-পথ-বাজেট ৮.৫/৭→৬.৫/৫.৫সে — vidy-শাখা-নিজেই-ধীরতম-হয়ে-গোটা-উত্তর-৮-১০সে-টানছিল; প্রক্সি-চেইনের-সফল-ফেচ ৪.৭-৬.৩সে-তে-বলে-৬.৫সে-দৈত্য-সীমা-ওদের-ধরে; সরাসরি-পথ ৫.৫/৩.৮-অক্ষত
      return Promise.race([
        one(srv).then(r => { done = true; clearTimeout(tmo); pend.delete(srv); if (r.ok) okWave++; return r; }), // timer cleared on win — no dangling timeouts
        new Promise(r => { fire = r; pend.set(srv, v => { done = true; clearTimeout(tmo); fire(v); }); }) // v1.14.2: tighten-কাটও-টাইমার-পরিষ্কার-করে — পরের-আসল-বাজেট-কাট/শাস্তি-আর-গুলে-খায়-না
      ]);
    };
    // সবাই-একসাথে-ফেল-করলে (যেমন-upstream-সাময়িক-http_500) ১.২-সে-পরে-এক-বার-অটো-রিট্রাই:
    // v1.14.2 EARLY-HARVEST: পণ্যদর্শী-কাজ-মাত্র ~১-সে-তে-শেষ (fetch ০.২-০.৬সে + probe); ঝুলন্ত-সার্ভারের-পূর্ণ-বাজেট-আর-গোটা-ঢেউ-জিম্মি-করে-না।
    // ≥৬-ওকে-হলে (২.২সে-পরে) বাকিদের-কাটো — শাস্তি-নেই (বাজেট-কাট-নয়), ওরা-পেছনে-শেষ-করে-SRV_CACHE-এ-জমে → পরের-ট্যাপ-তাৎক্ষণিক-পায়।
    // giants-একা-উৎস-হলে (পুরনো-সিরিজ) okWave-কখনো-৬-ছোঁয়-না → পুরনো-পূর্ণ-বাজেট-আচরণ-অক্ষত।
    const stopTighten = setInterval(() => {
      const el2 = Date.now() - t0;
      // স্তর-১: ব্যাপক-সাফল্য (≥৬-ওকে) → ২.২সে-থেকেই-ঝুলন্ত-কাট
      // স্তর-২: প্রায়-সবাই-বসে-গেছে (≤২-ঝুলন্ত) + অন্তত-১-ওকে + ৩.৯সে → শেষ-জিদ্দিদের-কাটো (সাধারণত-ধীর-giant, যে-শেষে-err/empty-ই-দেয় — অপেক্ষা-নিষ্ফল)
      if (pend.size && el2 >= 2200 && (okWave >= 6 || (okWave >= 1 && el2 >= 3900 && allow.length - pend.size >= allow.length - 2))) {
        if (DBG) console.error('[t1g] TIGHTEN ok=' + okWave + ' cut=' + pend.size + ' at ' + el2 + 'ms');
        for (const [srv2, f2] of Array.from(pend)) { pend.delete(srv2); f2({ srv: srv2, late: true }); }
      }
    }, 150);
    let rs = await Promise.all(allow.map(s => budget(s)));
    clearInterval(stopTighten); pend.clear();
    if (DBG) console.error('[t1g] ALL-SERVERS el=' + (Date.now() - t0) + 'ms ok=' + rs.filter(r => r.ok).length + '/' + rs.length);
    if (!rs.some(r => r.ok) && Date.now() - t0 < 3400) { // gate 3.4s (নতুন-বাজেটে-সমন্বয়): দ্রুত-সর্বব্যর্থতায়-রিট্রাই-এখনো-৯.৮সে-সীমার-ভেতরে-শেষ-হয়
      await new Promise(r2 => setTimeout(r2, 800)); force = true;
      rs = rs.concat(await Promise.all(allow.map(srv => budget(srv)))); // v1.15.10: পূর্ণ-পুনরুদ্ধার-ঢেউ-ফিরল (v1.15.9-ফিল্টার-ঠান্ডা-জানালার-কার্ড-উদ্ধার-ভাঙছিল — ইউজার-রিপোর্ট-অনুযায়ী-ফিরেছে)
    }
    rs.forEach(absorb);
    // v1.11.5: এপি-মেটা (বছর+টাইটেল) এসে-গেলে-কার্ডে-বসাও — সর্বোচ্চ ১.৮সে-অপেক্ষা (স্ক্যান-চলার-সময়েই-সাধারণত-আসে):
    let EXT0 = null;
    try {
      // v1.14.2 অভিযোজিত-অপেক্ষা: স্ক্যান-দেরি-হলে-সাজসজ্জার-বাড়তি-অপেক্ষা-আর-যোগ-হয়-না (মোট-স্ক্যান+সাজ ~৪.৬সে-ছোঁয়-না);
      // দ্রুত-স্ক্যানে-পুরো ১.৫সে-বেড়ি থাকে (সাধারণত-মেটা-ইতিমধ্যে-এসে-গেছে — তাৎক্ষণিক-ফেরত)
      const metaWait = Math.max(0, Math.min(1500, 4600 - (Date.now() - t0)));
      const [em, olc] = await Promise.all([ // দুই-মেটা-একসাথে — worst-case +১.৫সে (স্ক্যান-বাজেটের-সাথে-মসৃণ)
        Promise.race([epMetaP.catch(() => null), new Promise(r => setTimeout(() => r(null), metaWait))]),
        raceVal(olP, metaWait) // আসল-ভাষা-নাম (hi→Hindi, bn→Bengali, ta→Tamil…)
      ]);
      if (em || olc) EXT0 = { year: (em && em.year) || '', epT: (em && em.epT) || '', audio: langName(olc) || '' };
    } catch (eE) {}
    // মার্জ: কোনো-ক্রস-সার্ভার-ডিউপ-নয় — প্রতিটা-সার্ভারের-প্রতিটা-স্ট্রিম-কার্ড-থাকবে;
    // ক্রম: দৈত্য-সার্ভার (miami→boise→atlanta) সবার-উপরে, তারপর-বাড়তি, ভেতরে-রেজোলিউশন-বড়→ছোট:
    const PRIO = ['miami', 'boise', 'atlanta', 'phoenix', 'dallas', 'austin', 'seattle', 'delhi', 'munich', 'paris', 'orlando', 'reno', 'oakland', 'vegas', 'cancun', 'tampa'];
    const prio = v => { const i = PRIO.indexOf(v); return i < 0 ? 99 : i; };
    const all = [];
    for (const r of rs) {
      if (!r.j || !r.ok) continue;
      for (const c of decorate(r.j, type, s, e, title || '', cfg, r.srv, EXT0)) all.push({ c, srv: r.srv });
    }
    all.sort((a, b) => prio(a.srv) - prio(b.srv) || (parseInt(b.c.quality, 10) || 0) - (parseInt(a.c.quality, 10) || 0));
    let out = all.map(x => x.c);
    // কোনো-কার্ড-ফিট-করেনি (অদ্ভুত-লেবেল) → সবচেয়ে-সাবসমৃদ্ধ/শেষ-ভরসা-সেট:
    if (!out.length) {
      let pick = bestAny, pickSrv = bestAnySrv;
      if (!pick) { pick = deadJ; pickSrv = deadSrv; }
      if (pick) out = decorate(pick, type, s, e, title || '', cfg, pickSrv, EXT0);
    }
    // টাইটেল-প্রমিস-সমান্তরালে-ছুটেছিল → সর্বোচ্চ ৪০০ms-অপেক্ষা, এসে-গেলে-কার্ডে-বসাও (memoSet-এর-আগে-ই):
    if (titleP && out.length) {
      const nm = await Promise.race([titleP.catch(() => ''), new Promise(r => setTimeout(() => r(''), 400))]);
      if (nm) {
        const PRE = '\u29c9 Vidy'; // খালি-টাইটেলের-ফলব্যাক-টোকেন — শুধু-নাম-রিপ্লেস (বছর/এপি/⊞-লাইন-অক্ষত)
        out = out.map(c => {
          const t2 = c.title.indexOf(PRE) === 0 ? '\u29c9 ' + nm + c.title.slice(PRE.length) : c.title;
          return Object.assign({}, c, { title: t2, description: t2 });
        });
      }
    }
    // v1.15.8: কোনো-ফল-ক্যাশ-হয়-না — মিস-হলে-পরের-ক্লিকেই-তাজা-স্ক্যানে-পাওয়া-যায়
    if (DBG) console.error('[vdbg] ' + qsig + ' | ' + rs.map(r => r.srv + ':' + (r.neg ? 'neg' : r.err ? 'err' : r.empty ? 'empty' : 'ok' + r.nfit + '/' + (r.j && r.j.sources || []).length)).join(' '));
    if (!out.length && lastErr) throw lastErr;
    return out;
  });
}
const SUB_LANGS = { english: 'en', bangla: 'bn', bengali: 'bn', hindi: 'hi', japanese: 'ja', korean: 'ko', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', turkish: 'tr', arabic: 'ar', chinese: 'zh', mandarin: 'zh', thai: 'th', indonesian: 'id', malay: 'ms', tamil: 'ta', telugu: 'te', russian: 'ru', urdu: 'ur', malayalam: 'ml', marathi: 'mr', punjabi: 'pa', kannada: 'kn', nepali: 'ne', sinhala: 'si', filipino: 'tl', tagalog: 'tl', bhojpuri: 'bh', persian: 'fa', farsi: 'fa', vietnamese: 'vi' };
const NATIVE_SUB = { 'العربية': 'ar', 'اَلْعَرَبِيَّةُ': 'ar', 'français': 'fr', 'हिन्दी': 'hi', 'বাংলা': 'bn', 'indonesia': 'id', 'bahasa indonesia': 'id', 'melayu': 'ms', 'bahasa melayu': 'ms', 'español': 'es', 'deutsch': 'de', 'русский': 'ru', '日本語': 'ja', '한국어': 'ko', 'தமிழ்': 'ta', 'తెలుగు': 'te', 'മലയാളം': 'ml', 'português': 'pt', 'italiano': 'it', 'türkçe': 'tr', 'tiếng việt': 'vi', 'ไทย': 'th', 'فارسی': 'fa' };
function subLang(x) { // subtitle language code — schema-required on strict (TV) validators
  const raw = String(x.lang || x.language || '').trim();
  if (NATIVE_SUB[raw] || NATIVE_SUB[raw.toLowerCase()]) return NATIVE_SUB[raw] || NATIVE_SUB[raw.toLowerCase()];
  const v = raw.toLowerCase();
  if (/^[a-z]{2}(-|$)/.test(v)) return v.slice(0, 2);
  const s = v + ' ' + String(x.label || '').toLowerCase();
  for (const k in SUB_LANGS) if (s.indexOf(k) >= 0) return SUB_LANGS[k];
  return 'en';
}
// v1.9.0: shared quality-filter predicate — one() probes ONLY assets the filter would serve,
// decorate keeps exactly the same set. Unknown quality and Auto-HLS always pass.
function nxLangKey(p) { // normalize one dub token → canonical chip key
  p = String(p || '').toLowerCase().trim();
  if (!p || p.indexOf('original') >= 0) return 'original'; // v1.11.12: 'Original Audio'-ও-original (nethex-স্ট্যান্ডঅ্যালোন-সেমান্টিক্স: startsWith('original') — এ-ছাড়া-original-চিপ-নিজের-রো-ই-ফিল্টার-হয়ে-যেত)
  if (p.indexOf('esla') >= 0 || p.indexOf('spanish') >= 0) return 'spanish';
  if (p.indexOf('ptbr') >= 0 || p.indexOf('portug') >= 0) return 'portuguese';
  return p;
}
function nxLangPass(x, sel) { // sel empty = every language stays
  if (!sel || !sel.length) return true;
  const raw = String(x._lang || '').replace(/\s*dub\s*$/i, '').trim();
  if (!raw) return sel.indexOf('original') >= 0;
  const parts = raw.split('/').map(nxLangKey);
  if (parts.indexOf('original') >= 0) return sel.indexOf('original') >= 0;
  return parts.some(pt => sel.indexOf(pt) >= 0);
}
function qPass(x, allow) {
  if (!allow || !allow.length) return true;
  const h = parseInt(String(x.quality || '0'), 10) || 0;
  return !h || allow.indexOf(h) >= 0;
}
function decorate(j, type, s, e, showTitle, cfg, srv, ext) {
  cfg = cfg || DEFAULT_CFG;
  const headers = { 'User-Agent': UA, 'Referer': VIDY_REFERER };
  const order = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4 };
  // v1.11.14: payload-সাব-লিঙ্ক-মৃত-প্রমাণিত (api.playhq.net/sub → 400, ভেতরের-ডোমেইন-নিষ্ক্রিয়) — আর-সংযুক্ত-হয়-না;
  // কাজ-করা-MovieBox-ট্র্যাক-getSources-এর-মার্জ-স্তরে-সব-কার্ডে-বসে (mbSubs), cfg.sub=0-এ-দ্বার-বন্ধ
  const seen = {};
  const allow = Array.isArray(cfg.q) ? cfg.q : qToList(cfg.q);
  const cards = (j.sources || []).filter(x => x.url && /^https?:/.test(x.url) && !seen[x.url] && (seen[x.url] = 1)).filter(x => qPass(x, allow)).sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).map(x => {
    let q = String(x.quality || 'Auto').replace('p', '');
    if (!/^\d{3,4}$/.test(q)) q = 'Auto'; // v1.11.7: 'Auto HLS'/'Streamwish'/'Vidara'-জাতীয়-অ-সংখ্যা-লেবেল → Auto (শুধু-আসল-উচ্চতা-সংখ্যা-থাকে)
    const sd = ((srv || 'vidy').charAt(0).toUpperCase() + (srv || 'vidy').slice(1)); // কার্ডে-সার্ভার-নাম
    // v1.11.6: ঘরে-সবসময়-সার্ভারের-নাম; সোর্স-নাম-শুধু-সার্ভার-বিহীন-সোর্সে (MovieBox নিজে-নেয়)
    const yTx = (ext && ext.year) ? ' | ' + ext.year + ' |' : '';
    // v1.11.7: description = ⧉ Title | Year | / ⧠ SsEe • EpTitle / ⊞ Server ⌗ Audio — resolution নয়, Subs-লেখা নয় (resolution শুধু name-ঘরে)
    const epLine = type === 'tv'
      ? '\u29e0 S' + s + 'E' + e + ((ext && ext.epT) ? ' \u2022 ' + ext.epT : '')
      : '\u29e0 Movie';
    const txt = '\u29c9 ' + (showTitle || 'Vidy') + yTx + '\n' + epLine + '\n\u229e ' + sd + ' \u2317 ' + (j._audN || (ext && ext.audio) || 'Original Audio'); // সোর্স-ঘোষিত > TMDB > Original Audio
    return {
      name: '\u25a5 ' + q + ' \u25a5',
      title: txt,
      description: txt,
      quality: q === 'Auto' ? '' : q,
      url: String(x.url),
      headers: headers,
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } }
    };
  });
  return cards;
}

// ---------- config + manifest ----------
// TMDB-TV-জনর আলাদা (TV-তে Thriller/Romance নেই — জনর-আইডি টাইপ-ভেদে ভিন্ন):
const GENRES_TV = [['Drama', 18], ['Comedy', 35], ['Action & Adventure', 10759], ['Crime', 80], ['Mystery', 9648], ['Sci-Fi & Fantasy', 10765], ['Animation', 16], ['Family', 10751], ['Documentary', 99], ['War & Politics', 10768], ['Kids', 10762], ['Reality', 10764]];
const GENRES_MV = [['Action', 28], ['Comedy', 35], ['Thriller', 53], ['Romance', 10749], ['Drama', 18], ['Crime', 80], ['Sci-Fi', 878], ['Horror', 27], ['Mystery', 9648], ['Fantasy', 14], ['Animation', 16], ['Adventure', 12]];
function genreIds(type, names) {
  const gl = type === 'tv' ? GENRES_TV : GENRES_MV;
  return (Array.isArray(names) ? names : names ? [names] : []).map(n => String(n).trim().toLowerCase())
    .map(n => (gl.find(g2 => g2[0].toLowerCase() === n) || [0, 0])[1]).filter(Boolean);
}
const QH = [2160, 1080, 720, 480, 360];
function rtLangPass(x, sel) { // RareToons-নিজের-ফিল্টার: sel খালি = সব-ভাষা-থাকুক; যা-কার্ডে-দেখা-যায়-সেটাই-মানদণ্ড (_lang+ফাইলনাম+ডিসপ্লে)
  if (!sel || !sel.length) return true;
  const blob = (String(x._lang || '') + ' ' + String((x.behaviorHints || {}).filename || '') + ' ' + String(x.name || '') + ' ' + String(x.title || '')).toLowerCase();
  if (!blob.trim()) return false;
  return sel.some(l => blob.indexOf(l) >= 0);
}
function qToList(q) { // মাল্টি-রেজোলিউশন: অ্যারে/কমা-লিস্ট → ঠিক-ওইগুলো; সংখ্যা → ≤n-ক্যাপ (পুরনো-cfg); 0/খালি → সব
  const pick = [];
  const add = x => { const h = Number(x); if (QH.indexOf(h) >= 0 && pick.indexOf(h) < 0) pick.push(h); };
  if (Array.isArray(q)) { q.forEach(add); return pick; }
  if (typeof q === 'string' && q.indexOf(',') >= 0) { q.split(',').forEach(add); return pick; }
  const n = Math.min(2160, Math.max(0, Number(q) || 0));
  return n ? QH.filter(h => h <= n) : [];
}
const DEFAULT_CFG = { q: 0, sub: 1, cat: 'kd,mv', lang: '', sort: 'pop', era: '', g: [], srv: [], v: 1, nx: 1, nxq: 0, nxl: [], tw: 1, rt: 1, twq: [], rtl: [], wo: 1, woq: [] }; // wo/woq = Watchout-মাস্টার+নিজের-গুণমান-চিপস (v1.15.39) // v/nx/tw/rt = per-source master switches (tw=ToonWorld, rt=RareToons) // v/nx = per-source master switches; nxq/nxl = NetHex's OWN quality/audio-language filters (independent of the vidy-side q)
function parseCfgFromObj(o) {
  const c = Object.assign({}, DEFAULT_CFG, { g: [] });
  if (o) {
    if (o.q !== undefined && o.q !== null && o.q !== '') c.q = qToList(o.q);
    if (o.sub === 0 || o.sub === '0') c.sub = 0;
    if (typeof o.cat === 'string' && o.cat) c.cat = o.cat;
    if (o.lang === 'ko' || o.lang === 'zh') c.lang = o.lang;
    if (['pop', 'top', 'new'].indexOf(o.sort) >= 0) c.sort = o.sort;
    if (['2020', '2010', '2000'].indexOf(o.era) >= 0) c.era = o.era;
    if (Array.isArray(o.g)) c.g = o.g.map(String).map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (Array.isArray(o.srv)) c.srv = o.srv.map(x => String(x).toLowerCase()).filter(x => SERVERS.indexOf(x) >= 0).slice(0, 16);
    if (o.v === 0 || o.v === '0') c.v = 0;
    if (o.nx === 0 || o.nx === '0') c.nx = 0;
    if (o.tw === 0 || o.tw === '0') c.tw = 0;
    if (o.wo === 0 || o.wo === '0') c.wo = 0; // Watchout-মাস্টার (v1.15.39)
    if (o.twq !== undefined && o.twq !== null && o.twq !== '') c.twq = qToList(o.twq); // ToonWorld-নিজের-কোয়ালিটি-ফিল্টার (আসল-উচ্চতায়, কার্ড-লেবেল-নয়)
    if (o.rt === 0 || o.rt === '0') c.rt = 0;
    if (o.nxq !== undefined && o.nxq !== null && o.nxq !== '') c.nxq = qToList(o.nxq);
    if (Array.isArray(o.nxl)) c.nxl = o.nxl.map(x => String(x).toLowerCase().replace(/[^a-z]/g, '')).filter(x => x.length >= 2 && x.length <= 12).slice(0, 12);
    if (Array.isArray(o.rtl)) c.rtl = o.rtl.map(x => String(x).toLowerCase().replace(/[^a-z]/g, '')).filter(x => ['hindi', 'tamil', 'telugu', 'malayalam', 'bengali'].indexOf(x) >= 0).slice(0, 5); // RareToons-নিজের-অডিও-ভাষা-ফিল্টার
    if (o.woq !== undefined && o.woq !== null && o.woq !== '') c.woq = qToList(o.woq); // Watchout-নিজের-কোয়ালিটি-চিপস (v1.15.39)
  }
  return c;
}
function decodeCfg(b64) {
  try { return parseCfgFromObj(JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))); } catch (e) { return Object.assign({}, DEFAULT_CFG, { g: [], srv: [] }); }
}
const crypto = require('crypto');
function manifest(cfg, origin, cfgged) {
  // v1.13.8 PHOENIX-প্যারিটি: Stremio-ম্যানিফেস্ট-id-প্রতি-ক্যাশ-করে — আগের-ভাঙা-ইনস্টলের-id-পুনঃব্যবহার-নিষিদ্ধ
  const m = {
    id: cfgged ? 'community.xre.vidy.' + crypto.createHash('md5').update(JSON.stringify(cfg || {})).digest('hex').slice(0, 8) : 'community.xre.vidy.p7',
    version: VERSION,
    name: 'Phoenix',
    logo: (origin || '') + '/logo.png',
    description: 'Stream-only, parallel sources: Vidy (16 servers, up to 4K, subtitles) + MovieBox (direct-MP4 dubs & multi-audio) + RareToons (Hindi/Tamil/Telugu anime & cartoons, auto-HLS) + ToonWorld4All (multi-audio movies & anime via encrypted-link resolver) — every card in one unified format; each source keeps its own filters (quality, audio language, servers).',
    author: 'xre000001-ai',
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false, logging: false } // কনফিগ-পেজ-ছাড়া-অ্যাপে-অ্যাডন-আসবে-না
  };
  if (cfgged) { // কনফিগ-ইনস্টল: ফুল-নোটেশন-রিসোর্স (per-type idPrefixes) — টপ-লেভেল-বাদ (PHOENIX-নিয়ম)
    m.resources = [
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'] },
      { name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb'] }
    ];
    delete m.idPrefixes;
  } else m.resources = ['stream', 'subtitles']; // v1.11.13: MovieBox-সাবটাইটেল-ট্র্যাক
  return m;
}

// ---------- HTTP ----------
const reqLog = [];
function logReq(path, ms, n, err, ua) {
  reqLog.push({ t: new Date().toISOString().slice(11, 19), path: path.slice(0, 60), ms, n, err: err || undefined, ua: (ua || '').split(')')[0].split('(')[1] || (ua || '').slice(0, 24) });
  if (reqLog.length > 60) reqLog.shift();
}
function originOf(req) { // beamup-প্রক্সি-Host-হেডার-মাঝে-মাঝে-অভ্যন্তরীণ-নাম (ডট-হীন) → পরিচিত-পাবলিক-ডোমেইন; লোকাল-পরীক্ষায়-http
  const h = req.headers || {};
  let host = String(h['x-forwarded-host'] || '').split(',')[0].trim() || String(h.host || '');
  let proto = String(h['x-forwarded-proto'] || '').split(',')[0].trim() || (/^(127\.|localhost|\[)/.test(host) ? 'http' : 'https');
  if (!host || host.indexOf('.') < 0) { host = '3404d3c5dc63-vidy.baby-beamup.club'; proto = 'https'; } // অভ্যন্তরীণ-নাম → পাবলিক
  return proto + '://' + host;
}
function sendJson(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(b);
}
// v1.13.9 স্ট্রিম-উত্তর-ক্যাশ — nethex-v2.4.0-প্যারিটি: TTL-৩০মি + সর্বোচ্চ-৪০০, পুরনো-আগে-বাদ
const stripCards = cards => (cards || []).map(({ _hq, _lang, quality, headers, subtitles, ...r }) => r); // nethex-প্যারিটি-শেপ: ভেতরে-গাঁথা-সাব+অ-স্পেক-ফিল্ড-ছাঁটা
function sendStreams(res, skey, plog, ms, cards, ua) {
  const partial = !!(cards && cards.$partial);
  const n = (cards || []).length; // v1.15.8: কোনো-stash-নেই — প্রতি-উত্তর-তাজা
  logReq(plog, ms, n, null, ua);
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  return res.end(JSON.stringify({ streams: stripCards(cards) }));
}

function sendFile2(res, name) {
  try {
    const b = fs.readFileSync(path.join(__dirname, name));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); // CDN-ক্যাশ-নয় — নতুন-ডিপ্লয়ে-সাথে-সাথে-নতুন-পেজ
    return res.end(b);
  } catch (e) { return sendJson(res, 500, { error: 'missing ' + name }); }
}
const server = http.createServer((req, res) => {
  req.on('error', () => {}); res.on('error', () => {}); // v1.15.37 R2: ক্লায়েন্ট-মাঝপথে-ছেড়ে-গেলে (abort/EPIPE) socket-error-ইভেন্ট-শূন্যে-পড়ুক — বিপর্যয়-নয়
  const RVA = String(req.headers['user-agent'] || '');
  let pRaw = new URL(req.url, 'http://x').pathname;
  let p;
  try { p = decodeURIComponent(pRaw); } catch (eDec) { p = pRaw; } // ডিভাইস ':'-কে %3A-পাঠায় — ডিকোড-বাধ্যতামূলক
  let cfg = null;
  let cfgged = false; // v1.13.8: /cfg/-ইনস্টল → নিজস্ব-md5-ম্যানিফেস্ট-id (Stremio-ক্যাশ-সংঘর্ষ-নিষিদ্ধ)
  try {
    const cm2 = p.match(/^\/cfg\/([^\/]+)(\/.*)$/); // যেকোনো-অক্ষর-সহ্য — ভাঙা-b64-ও decodeCfg-এর-catch-এ-ডিফল্ট-হয় (404-নয়)
    if (cm2) { cfg = decodeCfg(cm2[1]); p = cm2[2]; cfgged = true; }
    else {
      const qs = new URL(req.url, 'http://x').searchParams;
      if ([...qs.keys()].length) cfg = parseCfgFromObj({ q: qs.get('q') || qs.get('maxq'), sub: qs.get('sub') === '0' ? 0 : 1, cat: qs.get('cat') || '', lang: qs.get('lang') || '', sort: qs.get('sort') || '', era: qs.get('era') || '', g: (qs.get('g') || '').split(',').filter(Boolean), srv: (qs.get('srv') || '').split(',').filter(Boolean), v: qs.get('v') === '0' ? 0 : undefined, nx: qs.get('nx') === '0' ? 0 : undefined, tw: qs.get('tw') === '0' ? 0 : undefined, rt: qs.get('rt') === '0' ? 0 : undefined, rtl: qs.get('rtl') ? qs.get('rtl').split(',') : undefined, wo: qs.get('wo') === '0' ? 0 : undefined, woq: qs.get('woq') ? qs.get('woq').split(',').map(Number) : undefined, nxq: qs.get('nxq') || undefined, nxl: qs.get('nxl') ? qs.get('nxl').split(',') : undefined });
    }
    if (!cfg) cfg = Object.assign({}, DEFAULT_CFG, { g: [], srv: [] });
    if (p === '/' || p === '/config' || p === '/configure') return sendFile2(res, 'config.html');
    if (p === '/manifest.json') return sendJson(res, 200, manifest(cfg, originOf(req), cfgged));
    if (p === '/logo.png') {
      try {
        const lb = fs.readFileSync(path.join(__dirname, 'logo.png'));
        res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' });
        return res.end(lb);
      } catch (eL) { return sendJson(res, 404, { error: 'no logo' }); }
    }
    if (p === '/rt_logo.png') { // RareToons-অফিসিয়াল-লোগো (ট্রান্সপারেন্ট — rareanimes.mov থেকে)
      try {
        const lb = fs.readFileSync(path.join(__dirname, 'assets', 'raretoons_logo.png'));
        res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' });
        return res.end(lb);
      } catch (eL) { return sendJson(res, 404, { error: 'no rt logo' }); }
    }
    const mmR = p.match(/^\/mm\/([A-Za-z0-9_-]{8,2400})\/mini\.m3u8$/); // v1.15.49: স্বাক্ষর-সহ-ব্রিজ-মাস্টার-কী ~১৪০০-অক্ষর — ৩০০-সীমায়-সব-404 হচ্ছিল (ইউজার-প্রমাণ)
    if (mmR) return (async () => { // v1.15.48: মিনি-মাস্টার — রেজোলিউশন-হাতে-আটকানো+অডিও-অক্ষত; উজ্জ্বল-উজ্জ্বল-উজ্জ্বল (স্ট্রিম-ফল-ক্যাশ-নয় — প্রতি-অনুরোধে-উজ্জ্বল-ফেচ)
      const ent = mmMiniOpen(mmR[1]); // কী-ই-সব-জানে — স্মৃতি-লাগে-না; সত্যিকারের-কী-কখনো-মরে-না
      if (!ent) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('gone'); }
      try {
        if (ent.vbq) { // v1.15.49: স্বাক্ষর-দ্রুত-ঘোরে — তাটা-রেজলভ (v1.15.55: ৬০সে-স্মৃতি — প্লেয়ার-প্রতি-মাস্টার-টানায়-ঘা-ঘা-রেজলভ-বন্ধ)
          const cm2 = mmGet(MM_VC, ent.vbq, 60000);
          if (cm2) ent.m = cm2;
          else {
            try {
              const rj2 = await woPoolText('https://vidbolt.xyz/api/resolve?' + ent.vbq, 6000);
              const jj2 = rj2 ? JSON.parse(rj2) : null;
              const fh = jj2 && jj2.stream && jj2.stream.sources && jj2.stream.sources.find(x2 => x2 && x2.kind === 'hls' && /^https?:/.test(x2.url || ''));
              if (fh) { ent.m = fh.url; mmPut(MM_VC, ent.vbq, ent.m); }
            } catch { }
          }
        }
        let raw = mmGet(MM_MC, ent.m, 60000); // v1.15.55: ৬০সে-মাস্টার-ক্যাশ — হিট-হলে-আপস্ট্রিম-ভ্রমণ-ই-নেই
        if (!raw) {
          const rr = await fetch(ent.m, { headers: { 'User-Agent': UA, Referer: ent.ref }, signal: AbortSignal.timeout(8000) });
          raw = rr.ok ? await rr.text() : '';
          if (raw.indexOf('#EXTM') < 0) { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('upstream'); }
          mmPut(MM_MC, ent.m, raw);
        } else if (DBG) console.error('[mm] মিনি-ক্যাশ-হিট');
        const mini = mmMiniBuild(ent.m, ent.h, raw) || raw; // ভেরিয়েন্ট-শূন্য-হলে-সম্পূর্ণ-পরম-মাস্টার
        ent.at = Date.now();
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
        return res.end(mini);
      } catch { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('upstream-err'); }
    })();
    if (p === '/_health') return sendJson(res, 200, { ok: 1, version: VERSION, pool: POOL.length, pxbench: POOL.filter(c => PX_SITE.has(c.px)).length, apibench: PX_API.size, vbbench: PX_VB.size, wobench: PX_WO.size, memo: memo.size, nx: NEXBASE ? 1 : 0, nxpool: NXBENCH, nxwaves: NXWAVES, nxsize: NXSIZE, tw: TWBASE ? 1 : 0, rt: RTBASE ? 1 : 0, wo: WOBASE ? 1 : 0, up: Math.floor(process.uptime()), ucex: UCEX }); // v1.15.36: +up(সেকেন্ড)+ucex — যোগাত্মক-মাত্র // v1.15.18: pxbench=সাইট-প্রমাণিত-বেঞ্চ (v1.15.8: nxpool=MB-বেঞ্চ)
    if (p === '/_pool') return sendJson(res, 200, POOL.map(c => Object.assign({}, c, PX_RUN.get(c.px) || {}, { site: PX_SITE.has(c.px) ? 1 : 0, cool: Math.max(0, ((PX_COOL.get(c.px) || 0) - Date.now()) / 1000 | 0), lastok: PX_LASTOK.get(c.px) || 0, sp: ['site', 'api', 'vb', 'wo'].filter(k => PX_SPACES[k].set.has(c.px)) }))); // v1.15.56: +sp(যে-যে-সোর্স-স্পেসে-সদস্য)
    if (p === '/_nxring') { if (!NEXBASE) return sendJson(res, 200, { off: 1 }); directGet(NEXBASE + '/debug/ring', 4000).then(b => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(b); }).catch(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"err":1}'); }); return; } // v2.10.2 চাইল্ড-রিজলভ-ধাপ-প্রমাণ
    if (p === '/_log') return sendJson(res, 200, reqLog.slice(-40).reverse());
    if (p === '/_servers') return sendJson(res, 200, { order: srvOrder(), scores: SRV_SCORE }); // কনফিগ-পেজের-লাইভ-হেলথ
    let m;
    // সব-পথ-লগ (৪০৪-ও-দৃশ্যমান-হোক):
    logReq(p, 0, -1, 'route-in', RVA);
    // v1.15.8 (ইউজার): স্ট্রিম-উত্তরে-ক্যাশ-পাঠ-বিলোপ — আগে-৩০মিন-পিন-মিস-হলে-২য়-ক্লিকে-একই-মিস-দেখাত; এখন-প্রতি-ক্লিক-প্রকৃত-স্ক্যান
    // ── catalog (search + genre + skip — NetHex-ধাঁচ):
    if ((m = p.match(/^\/catalog\/(series|movie)\/(vidy-kdrama|vidy-movies)(?:\/(.*))?\.json$/))) {
      const type = m[1] === 'series' ? 'tv' : 'movie';
      const ex = {};
      if (m[3]) m[3].split('&').forEach(kv => { const i3 = kv.indexOf('='); if (i3 > 0) ex[kv.slice(0, i3)] = decodeURIComponent(kv.slice(i3 + 1)); });
      const q = ex.search || '';
      const gid = [ex.genre].concat(cfg.g || []).filter(Boolean); // নাম-তালিকা → টাইপ-ভেদে-আইডি catalogMeta-র-ভেতরে
      const skip = Number(ex.skip || 0) || 0;
      const t0 = Date.now();
      return catalogMeta(type, q, cfg, gid, skip).then(metas => {
        logReq(p, Date.now() - t0, metas.length);
        sendJson(res, 200, { metas });
      }, e => { logReq(p, Date.now() - t0, 0, e && e.message); sendJson(res, 200, { metas: [] }); });
    }
    // ── tmdb-নেটিভ-আইডি-স্ট্রিম (Nuvio-মোড):
    if ((m = p.match(/^\/stream\/movie\/tmdb(\d+)\.json$/))) {
      const t0 = Date.now();
      const tp = nameForTmdb(Number(m[1]), 'movie'); // টাইটেল-আর-sources-একসাথে-ছোটা — টাইটেল-শুধু-কার্ডের-জন্য
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('movie', String(m[1]), 0, 0) : null;
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? tp.then(n => twrStreams(TWBASE, 'toonworld', n, 'movie', 0, 0)).catch(() => []) : null; // v1.12: টাইটেল-প্রমিস-থেকেই-সমান্তরালে-ছোটা
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? tp.then(n => twrStreams(RTBASE, 'raretoons', n, 'movie', 0, 0)).catch(() => []) : null;
      const woP = (WOBASE && !(cfg && cfg.wo === 0)) ? tp.then(n => woStreams(Number(m[1]), n, 'movie', 0, 0, cfg, originOf(req))).catch(() => []) : null; // v1.15.39: TMDB-নেটিভ
      kickSubs('tmdb' + m[1], 'movie', null, null, cfg);
      return withDeadline(withSources(vOn ? getSources(Number(m[1]), 'movie', null, null, '', cfg, tp) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (ইউজার: কার্ড-দেখানোর-টাইমআউট ১২সে): NXHARD(১২সে)-সমান-কার্যত-১২সে; এজ-কাট(~১২সে)-এর-১০০ms-নিচে — উত্তর-হারানো-রক্ষা */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/tmdb(\d+):?(?:(\d+):(\d+))?\.json$/))) {
      const t0 = Date.now();
      const tp = nameForTmdb(Number(m[1]), 'series');
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', String(m[1]), Number(m[2] || 1), Number(m[3] || 1)) : null;
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? tp.then(n => twrStreams(TWBASE, 'toonworld', n, 'series', Number(m[2] || 1), Number(m[3] || 1))).catch(() => []) : null;
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? tp.then(n => twrStreams(RTBASE, 'raretoons', n, 'series', Number(m[2] || 1), Number(m[3] || 1))).catch(() => []) : null;
      const woP = (WOBASE && !(cfg && cfg.wo === 0)) ? tp.then(n => woStreams(Number(m[1]), n, 'series', Number(m[2] || 1), Number(m[3] || 1), cfg, originOf(req))).catch(() => []) : null; // v1.15.39
      if (nxOn) nxPrewarm('series', String(m[1]), Number(m[2] || 1), Number(m[3] || 1));
      twRtPrewarm(tp, 'series', Number(m[2] || 1), Number(m[3] || 1));
      kickSubs('tmdb' + m[1], 'series', Number(m[2] || 1), Number(m[3] || 1), cfg);
      return withDeadline(withSources(vOn ? getSources(Number(m[1]), 'tv', Number(m[2] || 1), Number(m[3] || 1), '', cfg, tp) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (ইউজার: কার্ড-দেখানোর-টাইমআউট ১২সে): NXHARD(১২সে)-সমান-কার্যত-১২সে; এজ-কাট(~১২সে)-এর-১০০ms-নিচে — উত্তর-হারানো-রক্ষা */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/movie\/(tt\d+)\.json$/))) {
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('movie', m[1], 0, 0) : null;
      const infoP = vOn ? findTmdbInfo(m[1], 'movie') : null; // v1.12: এক-কলেই-সব-সোর্স-খাওয়ানো
      const nmP = suggName(m[1]); // v1.12.6: rt/tw-দ্রুত-নাম
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? nmP.then(nm => nm ? twrStreams(TWBASE, 'toonworld', nm, 'movie', 0, 0) : []).catch(() => []) : null; // v1.15.15: infoP-গেট-বাদ — v=0-কনফিগেও TW/RT-জীবন্ত (আগে vidy-সোর্স-বন্ধ=TW/RT-ও-নীরবে-মৃত — 'শুধু-MovieBox'-মূল-কারণ)
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? nmP.then(nm => nm ? twrStreams(RTBASE, 'raretoons', nm, 'movie', 0, 0) : []).catch(() => []) : null;
      const woOn = !!WOBASE && !(cfg && cfg.wo === 0); // v1.15.39
      const woIdP = woOn ? ((vOn && infoP) ? infoP.then(v => (v && v.id > 0) ? v.id : 0) : findTmdb(m[1], 'movie').catch(() => 0)) : null; // infoP-থেকেই-আইডি-ভাগ (দ্বিতীয়-কল-নয়)
      const woP = woOn ? woIdP.then(id => id ? nmP.then(nm => woStreams(id, nm || '', 'movie', 0, 0, cfg, originOf(req))) : []).catch(() => []) : null;
      kickSubs(m[1], 'movie', null, null, cfg);
      return withDeadline(withSources(vOn ? (infoP ? infoP.then(info => (info && info.id > 0) ? getSources(info.id, 'movie', null, null, info.name, cfg) : Promise.resolve([])) : Promise.resolve([])) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (ইউজার: কার্ড-দেখানোর-টাইমআউট ১২সে): NXHARD(১২সে)-সমান-কার্যত-১২সে; এজ-কাট(~১২সে)-এর-১০০ms-নিচে — উত্তর-হারানো-রক্ষা */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+):(\d+):(\d+)\.json$/))) {
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', m[1], Number(m[2]), Number(m[3])) : null;
      const infoP = vOn ? findTmdbInfo(m[1], 'series') : null;
      const nmP = suggName(m[1]); // v1.12.6: rt/tw-দ্রুত-নাম
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? nmP.then(nm => nm ? twrStreams(TWBASE, 'toonworld', nm, 'series', Number(m[2]), Number(m[3])) : []).catch(() => []) : null; // v1.15.15: infoP-গেট-বাদ — v=0-তেও TW/RT-জীবন্ত (nmP=IMDb-suggestion, v-নিরপেক্ষ)
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? nmP.then(nm => nm ? twrStreams(RTBASE, 'raretoons', nm, 'series', Number(m[2]), Number(m[3])) : []).catch(() => []) : null;
      const woOn = !!WOBASE && !(cfg && cfg.wo === 0); // v1.15.39
      const woIdP = woOn ? ((vOn && infoP) ? infoP.then(v => (v && v.id > 0) ? v.id : 0) : findTmdb(m[1], 'series').catch(() => 0)) : null;
      const woP2 = woOn ? woIdP.then(id => id ? nmP.then(nm => woStreams(id, nm || '', 'series', Number(m[2]), Number(m[3]), cfg, originOf(req))) : []).catch(() => []) : null;
      if (nxOn) nxPrewarm('series', m[1], Number(m[2]), Number(m[3]));
      twRtPrewarm(nmP, 'series', Number(m[2]), Number(m[3]));
      kickSubs(m[1], 'series', Number(m[2]), Number(m[3]), cfg);
      return withDeadline(withSources(vOn ? (infoP ? infoP.then(info => (info && info.id > 0) ? getSources(info.id, 'tv', Number(m[2]), Number(m[3]), info.name, cfg) : Promise.resolve([])) : Promise.resolve([])) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP2, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (ইউজার: কার্ড-দেখানোর-টাইমআউট ১২সে): NXHARD(১২সে)-সমান-কার্যত-১২সে; এজ-কাট(~১২সে)-এর-১০০ms-নিচে — উত্তর-হারানো-রক্ষা */, p).then(
        cards => { sendStreams(res, req.url, p, Date.now() - t0, cards, RVA); },
        e => { logReq(p, Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    if ((m = p.match(/^\/stream\/series\/(tt\d+)\.json$/))) { // সেফটি-নেট: s:e-ছাড়া কল → S1E1
      const t0 = Date.now();
      const vOn = !(cfg && cfg.v === 0), nxOn = !(cfg && cfg.nx === 0); // per-source masters
      const nxP = nxOn ? nxFor('series', m[1], 1, 1) : null;
      const infoP = vOn ? findTmdbInfo(m[1], 'series') : null;
      const nmP = suggName(m[1]); // v1.12.6: rt/tw-দ্রুত-নাম
      const twP = (TWBASE && !(cfg && cfg.tw === 0)) ? nmP.then(nm => nm ? twrStreams(TWBASE, 'toonworld', nm, 'series', 1, 1) : []).catch(() => []) : null;
      const rtP = (RTBASE && !(cfg && cfg.rt === 0)) ? nmP.then(nm => nm ? twrStreams(RTBASE, 'raretoons', nm, 'series', 1, 1) : []).catch(() => []) : null;
      const woOn = !!WOBASE && !(cfg && cfg.wo === 0); // v1.15.39
      const woIdP = woOn ? ((vOn && infoP) ? infoP.then(v => (v && v.id > 0) ? v.id : 0) : findTmdb(m[1], 'series').catch(() => 0)) : null;
      const woP3 = woOn ? woIdP.then(id => id ? nmP.then(nm => woStreams(id, nm || '', 'series', 1, 1, cfg)) : []).catch(() => []) : null;
      if (nxOn) nxPrewarm('series', m[1], 1, 1);
      twRtPrewarm(nmP, 'series', 1, 1);
      kickSubs(m[1], 'series', 1, 1, cfg);
      return withDeadline(withSources(vOn ? (infoP ? infoP.then(info => (info && info.id > 0) ? getSources(info.id, 'tv', 1, 1, info.name, cfg) : Promise.resolve([])) : Promise.resolve([])) : Promise.resolve([]), [{ p: nxP, key: 'nx' }, { p: twP, key: 'tw' }, { p: rtP, key: 'rt' }, { p: woP3, key: 'wo' }], cfg, t0), 11900 /* v1.15.26 (ইউজার: কার্ড-দেখানোর-টাইমআউট ১২সে): NXHARD(১২সে)-সমান-কার্যত-১২সে; এজ-কাট(~১২সে)-এর-১০০ms-নিচে — উত্তর-হারানো-রক্ষা */, p).then(
        cards => { sendStreams(res, req.url, p + ' [no-s:e]', Date.now() - t0, cards, RVA); },
        e => { logReq(p + ' [no-s:e]', Date.now() - t0, 0, e && e.message, RVA); sendJson(res, 200, { streams: [] }); });
    }
    // ── subtitles-রিসোর্স (MovieBox-সাবটাইটেল-ট্র্যাক — এমবেডেড-চাইল্ডের-/subtitles-প্রক্সি) ──
    if ((m = p.match(/^\/subtitles\/(movie|series)\/([^/]+?)(?:\.json)?$/))) {
      const t0 = Date.now();
      const done2 = arr => { logReq(p, Date.now() - t0, (arr || []).length); sendJson(res, 200, { subtitles: arr || [] }); };
      if (!NEXBASE) return done2([]);
      // ক্যাশ-ম্যানেজমেন্ট-mbSubs-এর-ভেতরে (SUBS_CACHE) — রুট-শুধু-আকৃতি-ম্যাপ-করে
      (async () => {
        const pp0 = String(m[2]).split(':'); // [id, s?, e?] — s:e-আগেই-আলাদা (অনুবাদে-হারায়-না)
        let id2 = pp0[0];
        if (/^tmdb\d+$/.test(id2)) { const iv = await tmdbToImdb(id2.slice(4), m[1] === 'series' ? 'tv' : 'movie'); if (!iv) return done2([]); id2 = iv; } // Nuvio-tmdb-আইডি
        const isTv = m[1] === 'series';
        const canon = await mbSubs(id2, isTv ? 'tv' : 'movie', Number(pp0[1] || 1), Number(pp0[2] || 1)); // আসল-s:e
        done2(canon.map(x => ({ id: x.lang, url: x.url, lang: x.lang }))); // রিসোর্স-আকৃতি (স্ট্রিমিও-নেটিভ)
      })().catch(e2 => { if (DBG) console.error('[nxdbg] subs ERR: ' + String(e2 && e2.message).slice(0, 60)); done2([]); });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) { try { if (!res.headersSent) sendJson(res, 500, { error: String(e && e.message) }); else { try { res.end(); } catch {} } } catch (e2) { try { res.destroy(); } catch {} } } // v1.15.37 R2: headers-পাঠানোর-পরে-বিপর্যয়-হলে সকেট-সৌজন্যে-বন্ধ — দ্বিতীয়-বিপর্যয়ের-ঝুঁকি-শূন্য
});
// v1.15.0: ৬০-সে-অন্তর-সব-agent-socket-ধ্বংস-বাদ — এটাই-কিপ-অ্যালাইভ-কে-অর্থহীন-করত (প্রতি-ট্যাপে-DNS+TLS-পুনরায়);
// warmBases()-এর-৪৫-সে-অন্তর-ট্রাফিক-সকেট-সক্রিয়-রাখে (NAT-কাট-স্বাভাবিকভাবেই-টালানো); মরা-সকেট-সার্ভার-FIN-এ-এজেন্ট-নিজেই-ফেলে।
// ---------- v1.11.8 embedded MovieBox (vendored nethex child; single-app deploy) ----------
let _nxEnsure = null;
function ensureNxChild(nxPort) { // v1.15.8: ৯০সে-অন্তর-7137-যাচাই; জীবিত-পেলে-NEXBASE-সেট; মৃত-হলে-পুনঃস্পন (৩মিন-স্পন-গার্ড — স্পন-ঝড়-নয়)
  if (_nxEnsure) return;
  let lastSpawn = 0;
  _nxEnsure = setInterval(() => {
    if (NEXBASE) return;
    const rq = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r => {
      r.resume();
      if (r.statusCode === 200) { NEXBASE = 'http://127.0.0.1:' + nxPort; console.log('[nx-embed] MovieBox দেরিতে-জীবন্ত: ' + NEXBASE); }
    });
    rq.on('error', () => {
      if (Date.now() - lastSpawn < 180000) return;
      lastSpawn = Date.now();
      if (DBG) console.error('[nx-embed] ensure: চাইল্ড-নেই — পুনঃস্পন');
      try { require('child_process').spawn(process.execPath, [path.join(__dirname, 'nethex', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(nxPort), NX_POOL_FILE: path.join(__dirname, 'vidy_proxy_pool.json') }), stdio: 'ignore' }); } catch (e) {}
    });
    rq.on('timeout', () => { rq.destroy(); });
  }, 90000);
  _nxEnsure.unref();
}
function startEmbeddedNx() {
  return new Promise(resolve => {
    try {
      if (!fs.existsSync(path.join(__dirname, 'nethex', 'server.js'))) return resolve('');
      const nxPort = Number(process.env.PORT || 7000) + 137;
      const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'nethex', 'server.js')], {
        env: Object.assign({}, process.env, { PORT: String(nxPort), NX_POOL_FILE: path.join(__dirname, 'vidy_proxy_pool.json') }),
        stdio: 'ignore',
      });
      ensureNxChild(nxPort); // v1.15.8: বুট থেকেই-প্রহরী — চাইল্ড-বুটেই-ব্যর্থ-হলেও-৯০সে-অন্তর-যাচাই→পুনঃস্পন (আগে-স্থায়ী-off-হয়ে-যেত)
      let nxRespawned = false;
      child.on('exit', c2 => { // v1.15.6 রাউন্ড-৩৬: চাইল্ড-মাঝপথে-মরলে-একবার-৯০সে-পরে-পুনঃস্পন (গার্ডেড — মাত্র-একবার, unref);
        if (DBG) console.error('[nx-embed] child exited ' + c2);
        if (nxRespawned) return;
        nxRespawned = true;
        setTimeout(() => {
          try {
            const c3 = require('child_process').spawn(process.execPath, [path.join(__dirname, 'nethex', 'server.js')], {
              env: Object.assign({}, process.env, { PORT: String(nxPort), NX_POOL_FILE: path.join(__dirname, 'vidy_proxy_pool.json') }),
              stdio: 'ignore',
            });
            c3.on('exit', () => { // v1.15.7 রাউন্ড-৮: respawn-চাইল্ড-মরলেও-আগে-যাচাই — 7137-তে-কেউ-সেবা-দিলে-'off'-বলা-মিথ্যা
              const rq3 = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r3 => {
                r3.resume();
                console.error('[nx-embed] respawn exited — 7137 এখনো-সক্রিয়, MovieBox-সেবা-চলছে');
              });
              rq3.on('error', () => { if (DBG) console.error('[nx-embed] respawn exited — MovieBox off'); });
              rq3.on('timeout', () => { rq3.destroy(); if (DBG) console.error('[nx-embed] respawn exited — MovieBox off'); });
            });
            const t4 = Date.now();
            (function ping2() {
              const rq2 = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r2 => {
                r2.resume();
                if (r2.statusCode === 200) { NEXBASE = 'http://127.0.0.1:' + nxPort; console.log('[nx-embed] MovieBox respawned on ' + NEXBASE); return; }
                retry2();
              });
              rq2.on('error', retry2); rq2.on('timeout', () => { rq2.destroy(); retry2(); });
              function retry2() { if (Date.now() - t4 > 20000) { if (DBG) console.error('[nx-embed] respawn not ready — MovieBox off'); return; } setTimeout(ping2, 500); }
            })();
          } catch (eR) { if (DBG) console.error('[nx-embed] respawn failed: ' + eR.message); }
        }, 90000).unref();
      });
      const t0 = Date.now();
      (function ping() {
        const rq = http.get({ host: '127.0.0.1', port: nxPort, path: '/manifest.json', timeout: 1500 }, r => {
          r.resume();
          if (r.statusCode === 200) { const u = 'http://127.0.0.1:' + nxPort; console.log('[nx-embed] MovieBox child ready on ' + u); return resolve(u); }
          retry();
        });
        rq.on('error', retry); rq.on('timeout', () => { rq.destroy(); retry(); });
        function retry() { if (Date.now() - t0 > 20000) { console.error('[nx-embed] child not ready in 20s — MovieBox off'); return resolve(''); } setTimeout(ping, 500); }
      })();
    } catch (eE) { console.error('[nx-embed] spawn failed: ' + eE.message); resolve(''); }
  });
}
const PORT = Number(process.env.PORT || 7000);
let NXBENCH = -1, NXWAVES = -1, NXSIZE = -1; // v2.10.1: waves=চাইল্ডের-মোট-স্ক্যান-ঢেউ (কম্পাঙ্ক-যাচাইযোগ্য)
function nxBenchHealth() {
  if (!NEXBASE) { NXBENCH = -1; return Promise.resolve(-1); }
  return directGet(NEXBASE + '/health', 3000).then(b => { const j = JSON.parse(b); NXBENCH = typeof j.pool === 'number' ? j.pool : -1; NXWAVES = typeof j.waves === 'number' ? j.waves : NXWAVES; NXSIZE = typeof j.size === 'number' ? j.size : NXSIZE; return NXBENCH; }).catch(() => { NXBENCH = -1; return -1; });
}
let nxBenchWait = null; // single-flight — ঘন-ট্যাপে-এক-অপেক্ষাই (বেঞ্চ-ঝড়-নয়)
function waitNxBench(maxMs) { // v1.15.13: NXBENCH===0 → হার্ড-[]-এর-বদলে-প্রথম-বেঞ্চ-ঢেউয়ের-সীমিত-অপেক্ষা (শিশু-স্ট্রিমিং-বুট ~৫-১৫সে)
  if (NXBENCH !== 0) return Promise.resolve(NXBENCH);
  if (nxBenchWait) return nxBenchWait;
  const t0 = Date.now();
  nxBenchWait = (async () => {
    while (Date.now() - t0 < maxMs) {
      await new Promise(r => setTimeout(r, 700));
      const n = await nxBenchHealth();
      if (n !== 0) break;
    }
    nxBenchWait = null;
    return NXBENCH;
  })();
  return nxBenchWait;
}
setInterval(() => { nxBenchHealth(); }, 15000).unref();
(async () => {
  if (!NEXBASE) NEXBASE = await startEmbeddedNx();
  nxBenchHealth(); // v1.15.13: বুটেই-জানি (৬০সে-অপেক্ষা-নয়)
  server.listen(PORT, '0.0.0.0', () => console.log('[vidy] ' + VERSION + ' on :' + PORT + ' | pool=' + POOL.length + (NEXBASE ? ' | moviebox embedded' : '')));
  server.on('error', e => { const pre = !server.listening; console.error('[listen] পোর্ট-' + PORT + ' ব্যর্থ: ' + (e && e.code || '') + (e && e.code === 'EADDRINUSE' && pre ? ' — একই-পোর্টে-অন্য-vidy-চলছে; ওটা-বন্ধ-করো (pkill -f "node server.js") বা PORT=অন্য-দাও' : ' — ' + String(e && e.message).slice(0, 100))); if (pre) process.exit(1); }); // v1.15.40: শুধু-listen-আগের-ত্রুটিতে-প্রস্থান — চলন্ত-অবস্থায়-লগ-ই, মৃত্যু-নয়
  setTimeout(probePool, 3000).unref(); // v1.15.0 বুট-প্রোব
  setTimeout(pxCheckerStart, 5000).unref(); // v1.15.19: বুটের-৫সে-পরেই-ঢেউ-শুরু
  // v1.15.18 (r68b ইউজার-অনুমোদিত): রেপ্লিকা-জাগ্রত নিজ-পিং — প্রতি-৪মিনিটে নিজের-পাবলিক-URL-এ /_health
  // (স্কেল-টু-জিরো/নিষ্ক্রিয়তা-ঘুম-বন্ধ; রাউটার-সর্বদা-গরম) + warmBases (রেজলভার/শিশুর-সকেট-DNS+TLS-হাত গরম — ঠান্ডা-১ম-ট্যাপের-মূল-কারণ)
  const SELF_URL = String(process.env.SELFPING_URL || 'https://3404d3c5dc63-vidy.baby-beamup.club/_health');
  const SELF_SEC = Math.max(60, Number(process.env.SELFPING_SEC || 180)); // v1.15.19: ৪মিন→৩মিন
  const selfPing = () => { directGet(SELF_URL, 8000).then(() => { if (DBG) console.error('[selfping] ok ' + SELF_URL); }).catch(() => {}); try { warmBases(); } catch (e) {} };
  setInterval(selfPing, SELF_SEC * 1000).unref();
  setTimeout(selfPing, 20000).unref(); // বুটের-২০সে-পরেই-প্রথম-পিং
  setInterval(probePool, 180000).unref(); // v1.15.4: প্রতি-৩-মিনিট (বড়-পুলে-তাজা-লেটেন্সি-দ্রুত)
  setTimeout(enrichPool, 20000).unref(); // v1.15.4 বুট-এনরিচ
  setInterval(enrichPool, 420000).unref(); // v1.15.19: প্রতি-৭-মিনিটে-তাজা-ফসল (আগে-৩০: বেঞ্চ-বৃদ্ধি-ধীর-ছিল — প্রতি-১২-ঢেউয়ে-মাত্র ১-৪টা সাইট-প্রমাণিত হয়)
  const warmBases0 = () => { try { warmBases(); } catch (e) {} };
  setTimeout(warmBases0, 1500).unref();
  setInterval(warmBases0, 45000).unref(); // প্রতি-৪৫-সে-সকেট-উষ্ণ
})();

// ---------- selftest ----------
if (process.argv[2] === 'selftest') {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'test_fixture.json'), 'utf8'));
  try {
    const j = JSON.parse(vidyDecrypt(fx.ct, fx.seed, 1396));
    const ok = j.sources.length === fx.sources && j.sources[0].url.slice(0, fx.first_url.length) === fx.first_url;
    console.log(ok ? 'selftest ✓ (JS-decrypt byte-exact: ' + j.sources.length + ' sources)' : 'selftest ✗ MISMATCH');
    process.exit(ok ? 0 : 1);
  } catch (e) { console.log('selftest ✗', e.message); process.exit(1); }
}
module.exports = { vidyDecrypt, getSources, findTmdb, _internal: { keystream, mix, fnv1a } };