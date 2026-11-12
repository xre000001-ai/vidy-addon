#!/usr/bin/env node
// dt-index3.mjs — Deadtoons **সম্পূর্ণ সাইট-কপি** ইনডেক্স বিল্ডার (v3, ২০২৬-১১-১২)
//
// ইউজার-নির্দেশ: "GitHub e ekta file create korba jekhane deadtoons er jonno active index hobe,
//   oitate deadtoons er hub cloud pixeldrain link gulo store hobe, **puro website ta copy korba**,
//   taile toh 1st tap ei easily asar kotha"
//
// আগের বিল্ডার sparse ছিল (২৬ শো ⇒ later ১৩৯৯ শো, কিন্তু প্রতি শো-এ ১–২ এপিসোড) — ফলে
// ২৩,৮৮৯ ইউনিটের মধ্যে মাত্র ১১% কভার হতো, তাই অধিকাংশ টাইটেলে Deadtoons কার্ড আসত না।
// এখন: **ক্যাটালগ-চালিত কাজের সারি** — সব শো × সব সিজন × সব এপিসোড + সব মুভি, প্রতিটির
// HubCloud **ও** Pixeldrain (সেরা কোয়ালিটি) => ক্রমাগত রান করলে পুরো সাইট কভার হয়।
//
// আউটপুট (GitHub-এ কমিট হয়):
//   dti/manifest.json  { ver:3, ts, shards, n, units:{done,total}, slugs:[...] }
//   dti/s00.json … sNN.json  { "<slug>": [[s,e,h,q,"<id|url>"], …] }
//        h: 1=hubcloud, 0=pixeldrain, -1=চেষ্টা-হয়েছে-কিছু-নেই (পুনরায় চেষ্টা নয়)
//        q: কোয়ালিটি-সংখ্যা (1080/720/…); id সংক্ষিপ্ত — সার্ভার URL বানায়
//
// ব্যবহার: node dt-index3.mjs [--budget=2700] [--scan=10] [--conc=56] [--max=6000] [--publish] [--verify=0]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API = 'https://api.deadbase.host/api/v1/public';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://deadtoons.sbs/', 'Origin': 'https://deadtoons.sbs' };

const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : (process.argv.includes('--' + k) ? true : d); };
const BUDGET = Number(arg('budget', 2700)) * 1000;   // এই রানে সর্বোচ্চ কাজের সময় (CI ৫৮মিনিট-টাইমআউটের ভিতরে)
const SCAN = Number(arg('scan', 30));                // সমান্তরাল ডিটেইল-ফেচ (ইউনিট-ইন-ফ্লাইট = আনলক-পুলের গতি)
const CONC = Number(arg('conc', 56));                // সমান্তরাল আনলক (১৫সে গেট)
const MAXU = Number(arg('max', 6000));               // এই রানে সর্বোচ্চ কতটি নতুন এন্ট্রি
const WANT = Math.max(1, Number(arg('want', 1)));     // প্রতি ইউনিটে কতটি হোস্ট লাগবে (১ = HubCloud-আগে দ্রুত কভার, ২ = +Pixeldrain মিরর)
const SHARDS = Number(arg('shards', 16));
const PUBLISH = !!arg('publish', false);
const SHORTENER = Number(arg('short', 7));
const CHECK_MS = Number(arg('check', 600)) * 1000;   // প্রতি ১০মিনে checkpoint-publish (কাজ হারাবে না)
const DIR = path.join(__dirname, 'dti');
const CAT = path.join(__dirname, 'dt_catalog.json');
const LEGACY = path.join(__dirname, 'dt_index.json');

const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const shardOf = slug => hash(String(slug)) % SHARDS;
const pad = n => String(n).padStart(2, '0');

const getJson = async (p, ms = 15000) => { try { const r = await fetch(API + p, { headers: H, signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
const postJson = async (p, body, ms = 9000) => {
  try {
    const r = await fetch(API + p, { method: body === null ? 'GET' : 'POST', headers: Object.assign({}, H, body === null ? {} : { 'Content-Type': 'application/json' }), body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

// ---------- ১৫সে গেট পেরিয়ে চূড়ান্ত URL ----------
async function unlock(id) {
  const st = await postJson('/unlock/' + id + '/start', { shortener_id: SHORTENER });
  const ru = st && st.redirect_url; if (!ru) return null;
  const tok = String(ru).replace(/\/+$/, '').split('/').pop();
  const g = await postJson('/own-shortener/gate/' + tok, {});
  if (!g) return null;
  if (!g.done) {
    let rem = Math.max(1, Number(g.remaining_seconds || g.wait_seconds || 15)) * 1000 + 400;
    if (rem > 32000) return null;
    let c = null;
    for (let a = 0; a < 3; a++) {
      await new Promise(r => setTimeout(r, rem));
      c = await postJson('/own-shortener/gate/' + tok + '/continue', {});
      if (c && c.done) break;
      if (!c) return null;
      rem = Math.max(600, Number(c.remaining_seconds || 1) * 1000 + 400);
    }
    if (!c || !c.done) return null;
  }
  const cb = await postJson('/unlock/callback/' + tok, {}, 16000);
  const url = cb && (cb.url || cb.final_url || cb.redirect_url);
  return url ? String(url) : null;
}

// ---------- URL ⇄ (host, id) ----------
function hostCode(u) {
  if (/pixeldrain\.(com|dev)\/(?:u|api\/file)\//i.test(u)) return 0;
  if (/hubcloud\.(pw|xyz|cf|site)\/drive\//i.test(u) || /hubcloud/i.test(u)) return 1;
  return -1;   // অন্যান্য (FSL/অজানা) — পুরো URL রাখি
}
function idOf(u) {
  let m = String(u).match(/pixeldrain\.(?:com|dev)\/(?:u|api\/file)\/([A-Za-z0-9]+)/i); if (m) return m[1];
  m = String(u).match(/hubcloud\.[a-z]+\/drive\/([A-Za-z0-9]+)/i); if (m) return m[1];
  return String(u);   // অজানা ফর্ম ⇒ পুরো URL
}
const qnum = q => { const m = String(q || '').match(/(\d{3,4})\s*p/i); return m ? Number(m[1]) : 0; };

// ---------- ক্যাটালগ (সব শো × সিজন × এপিসোড) ----------
async function ensureCatalog() {
  try { const c = JSON.parse(fs.readFileSync(CAT, 'utf8')); if (Array.isArray(c) && c.length) { console.log('[idx] ক্যাটালগ:', c.length, 'শো'); return c; } } catch { }
  console.log('[idx] ক্যাটালগ নেই — তৈরি করছি…');
  const shows = [];
  for (let p = 1; p <= 40; p++) {
    const j = await getJson('/anime?page=' + p + '&limit=50');
    const d = (j && j.data) || []; if (!d.length) break;
    for (const x of d) if (x && x.slug) shows.push({ slug: x.slug, type: x.type || 'tv', name: x.anime_name });
  }
  const out = [];
  let i = 0;
  const worker = async () => {
    for (;;) {
      const s = shows[i++]; if (!s) return;
      const j = await getJson('/anime/' + encodeURIComponent(s.slug), 12000);
      const ss = ((j && j.seasons) || []).filter(x => (x.episode_count || 0) > 0)
        .map(x => ({ s: Number(x.season_number || 1), n: Number(x.episode_count || 0) }));
      out.push(Object.assign({}, s, { seasons: ss, eps: ss.reduce((a, b) => a + b.n, 0), movie_links: ((j && j.links) || []).length }));
    }
  };
  await Promise.all(Array.from({ length: 14 }, worker));
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  fs.writeFileSync(CAT, JSON.stringify(out));
  console.log('[idx] ক্যাটালগ তৈরি:', out.length, 'শো | ইউনিট =', out.reduce((a, r) => a + (r.seasons.length ? r.eps : 1), 0));
  return out;
}

// ---------- বিদ্যমান শার্ড + পুরোনো dt_index.json মাইগ্রেশন ----------
function loadShards() {
  const rows = new Map();   // slug -> [ [s,e,h,q,id], ... ]
  const add = (slug, row) => { if (!rows.has(slug)) rows.set(slug, []); rows.get(slug).push(row); };
  try {
    for (const f of fs.readdirSync(DIR)) {
      if (!/^s\d+\.json$/.test(f)) continue;
      const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      for (const slug of Object.keys(j)) for (const r of j[slug]) add(slug, r);
    }
  } catch { }
  if (!rows.size) {
    try {
      const old = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
      for (const k of Object.keys(old.links || {})) {
        const e = old.links[k]; if (!e || !e.u || !e.slug) continue;
        const h = hostCode(e.u); add(String(e.slug), [Number(e.s || 0), Number(e.e || 0), h, qnum(e.q), idOf(e.u)]);
      }
      if (rows.size) console.log('[idx] পুরোনো dt_index.json থেকে মাইগ্রেট:', rows.size, 'শো');
    } catch { }
  }
  return rows;
}

(async () => {
  const t00 = Date.now();
  const cat = await ensureCatalog();
  const rows = loadShards();
  const dirty = new Set();

  // কাজের সারি — যে ইউনিটের কোনো সারি নেই (এবং empty-মার্কারও নেই)
  const cnt = new Map();   // unitKey -> কতটি বৈধ (h>=0) সারি
  for (const slug of rows.keys()) for (const r of rows.get(slug)) {
    const k = slug + '|' + r[0] + '|' + r[1];
    if (!cnt.has(k)) cnt.set(k, 0);
    if (r[2] >= 0) cnt.set(k, cnt.get(k) + 1);
  }
  const unitFull = k => (cnt.get(k) || 0) >= WANT;
  const todo = [];
  let totalUnits = 0;
  for (const r of cat) {
    if (r.seasons && r.seasons.length) {
      for (const s2 of r.seasons) for (let e = 1; e <= s2.n; e++) {
        totalUnits++;
        const k = r.slug + '|' + s2.s + '|' + e;
        if (!unitFull(k)) todo.push({ slug: r.slug, s: s2.s, e });
      }
    } else {
      totalUnits++;
      const k = r.slug + '|0|0';
      if (!unitFull(k)) todo.push({ slug: r.slug, s: 0, e: 0 });
    }
  }
  // ডিটারমিনিস্টিক ক্রম ⇒ রান একই জায়গা থেকে শুরু করে, ক্রমাগত এগোয়
  todo.sort((a, b) => (a.slug === b.slug ? (a.s - b.s) || (a.e - b.e) : a.slug.localeCompare(b.slug)));
  const haveUnits = totalUnits - todo.length;
  console.log('[idx] সাইট-ইউনিট =', totalUnits, '| ইনডেক্সে =', haveUnits, '(' + (haveUnits / totalUnits * 100).toFixed(1) + '%)', '| বাকি =', todo.length);
  console.log('[idx] budget=' + (BUDGET / 1000) + 's max=' + MAXU + ' scan=' + SCAN + ' unlock-conc=' + CONC + ' want=' + WANT);

  let added = 0, tried = 0, noHost = 0, unlockFail = 0, unitsDone = haveUnits;
  const addRow = (slug, row) => {
    if (!rows.has(slug)) rows.set(slug, []);
    rows.get(slug).push(row); dirty.add(shardOf(slug));
    const k = slug + '|' + row[0] + '|' + row[1];
    if (!cnt.has(k)) cnt.set(k, 0);
    if (row[2] >= 0) cnt.set(k, cnt.get(k) + 1);
  };

  // সেমাফোর — আনলক-সমান্তরালতা
  let act = 0; const waiters = [];
  const acquire = () => (act < CONC ? (act++, Promise.resolve()) : new Promise(r => waiters.push(() => { act++; r(); })));
  const release = () => { act--; const w = waiters.shift(); if (w) w(); };

  async function workUnit(u) {
    const det = u.s > 0
      ? await getJson('/anime/' + encodeURIComponent(u.slug) + '/season/' + u.s + '/episode/' + u.e, 9000)
      : await getJson('/anime/' + encodeURIComponent(u.slug), 9000);
    const links = (det && det.links) || [];
    // প্রতি হোস্টে সেরা কোয়ালিটির একটি লিঙ্ক-সার্ভার-আইডি
    const best = {};   // host -> {q, id}
    for (const l of links) {
      const q = qnum(l.quality);
      for (const sv of (l.servers || [])) {
        if (!sv || !sv.link_server_id) continue;
        const nm = String(sv.name || '');
        if (!/pixeldrain|hubcloud/i.test(nm)) continue;     // FilePress বাদ (নীতি)
        const hn = /pixeldrain/i.test(nm) ? 0 : 1;
        if (!best[hn] || q > best[hn].q) best[hn] = { q, id: String(sv.link_server_id) };
      }
    }
    let cands = Object.keys(best).map(hn => ({ h: Number(hn), q: best[hn].q, id: best[hn].id }))
      .sort((a, b) => (b.h - a.h) || (b.q - a.q));   // HubCloud আগে (আগের নীতি: pixeldrain/hubcloud দুটোই সমর্থিত)
    const need = Math.max(1, WANT - (cnt.get(u.slug + '|' + u.s + '|' + u.e) || 0));
    cands = cands.slice(0, need);
    if (!cands.length) { addRow(u.slug, [u.s, u.e, -1, 0, '']); noHost++; tried++; unitsDone++; return; }
    for (const c of cands) {
      if (added >= MAXU || Date.now() - t00 > BUDGET) return;
      await acquire();
      let url = null;
      try { url = await unlock(c.id); } finally { release(); }
      tried++;
      if (!url) { unlockFail++; continue; }
      const hc = hostCode(url);
      addRow(u.slug, [u.s, u.e, c.h === 1 && hc === -1 ? -1 : hc, c.q, idOf(url)]);
      added++;
      if (added % 50 === 0) console.log('[idx] +' + added + ' এন্ট্রি | চেষ্টা=' + tried + ' | ইউনিট=' + unitsDone + '/' + totalUnits + ' @' + Math.round((Date.now() - t00) / 1000) + 's');
    }
    unitsDone++;
  }

  // checkpoint-publish
  let pubIdx = 0;
  async function publish(note) {
    if (!PUBLISH) return;
    const tok = process.env.GH_TOKEN || '';
    const repo = process.env.GH_REPO || 'xre000001-ai/vidy-addon';
    if (!tok) { console.error('[idx] GH_TOKEN নেই — প্রকাশ বাদ'); return; }
    const api = 'https://api.github.com/repos/' + repo + '/contents/';
    fs.mkdirSync(DIR, { recursive: true });
    // শার্ড লেখা
    const perShard = new Map();
    let n = 0;
    for (const slug of rows.keys()) {
      const sd = shardOf(slug);
      if (!perShard.has(sd)) perShard.set(sd, {});
      perShard.get(sd)[slug] = rows.get(slug);
      n += rows.get(slug).length;
    }
    const manifest = {
      ver: 3, ts: Date.now(), shards: SHARDS, n,
      units: { done: unitsDone, total: totalUnits },
      slugs: [...rows.keys()].filter(s => (rows.get(s) || []).some(r => r[2] >= 0)).sort()
    };
    const files = [['dti/manifest.json', JSON.stringify(manifest)]];
    for (const [sd, obj] of perShard) files.push(['dti/s' + pad(sd) + '.json', JSON.stringify(obj)]);
    let ok = 0;
    for (const [p2, txt] of files) {
      try {
        const cur = await fetch(api + p2 + '?ref=main', { headers: { Authorization: 'Bearer ' + tok, 'User-Agent': UA } }).then(r => (r.ok ? r.json() : null)).catch(() => null);
        const body = { message: 'dt index: ' + p2 + ' (' + n + ' rows, units ' + unitsDone + '/' + totalUnits + ') ' + (note || ''), content: Buffer.from(txt).toString('base64'), branch: 'main' };
        if (cur && cur.sha) body.sha = cur.sha;
        const r2 = await fetch(api + p2, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r2.ok) ok++;
        else if (r2.status !== 422) console.log('[idx] publish-fail', p2, r2.status);
      } catch { }
    }
    console.log('[idx] checkpoint-publish: ' + ok + '/' + files.length + ' ফাইল | rows=' + n + ' | added=' + added + ' @' + Math.round((Date.now() - t00) / 1000) + 's');
  }

  const cp = setInterval(() => { publish('checkpoint').catch(() => { }); }, CHECK_MS);
  cp.unref?.();

  // স্ক্যানার-পুল
  let qi = 0;
  const runner = async () => {
    for (;;) {
      if (Date.now() - t00 > BUDGET || added >= MAXU) return;
      const u = todo[qi++]; if (!u) return;
      try { await workUnit(u); } catch (e) { }
    }
  };
  await Promise.all(Array.from({ length: SCAN }, runner));
  clearInterval(cp);
  await publish('final');

  console.log('[idx] ✅ এই রান: নতুন=' + added + ' | চেষ্টা=' + tried + ' | হোস্ট-নেই=' + noHost + ' | আনলক-ব্যর্থ=' + unlockFail +
    ' | কভারেজ=' + unitsDone + '/' + totalUnits + ' (' + (unitsDone / totalUnits * 100).toFixed(1) + '%) | ' + Math.round((Date.now() - t00) / 1000) + 's');
})().catch(e => { console.error('[idx] fatal', e && e.message); process.exit(1); });
