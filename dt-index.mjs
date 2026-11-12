#!/usr/bin/env node
// dt-index.mjs — Deadtoons ডাউনলোড-লিঙ্ক ইনডেক্স বিল্ডার (ইউজার-আইডিয়া: "GitHub e index build kora jay,
//                phole 15s time wait korte hoi na")
//
// কেন দরকার: Deadtoons-এর HubCloud/Pixeldrain লিঙ্ক `link_server_id`-ভিত্তিক **সার্ভার-সাইড ১৫সে গেটের**
// পেছনে (api.deadbase.host `/unlock/{id}/start` → `own-shortener/gate` → ১৫সে → `continue` → `callback` ⇒ url)।
// গেটটা একবার পেরোলে ফাইনাল URL (pixeldrain `/u/<id>`, hubcloud `/drive/<id>`) **স্থির** — তাই একবার
// বিল্ড করে ইনডেক্সে রাখলে ইউজারের ১৫সে অপেক্ষা লাগে না (অ্যাডন শুধু প্রমাণ/Range করে কার্ড দেয়)।
//
// আউটপুট ফরম্যাট (dt_index.json):
//   { "ver": 1, "ts": <epoch ms>, "n": <entries>, "links": { "<link_server_id>": {"u": "<final url>",
//     "h": "pixeldrain|hubcloud", "q": "1080p x264", "slug": "...", "s": 1, "e": 1, "t": <epoch ms>} } }
//
// ব্যবহার:  node dt-index.mjs [--max=1200] [--conc=24] [--out=dt_index.json] [--pages=29] [--publish]
//   --max      এই রানে সর্বোচ্চ কতটি নতুন লিঙ্ক আনলক করবে (গেট ১৫সে ⇒ conc=24 হলে ~২৪টি/১৭সে)
//   --publish  GitHub contents-API দিয়ে রিপোতে কমিট (env: GH_TOKEN, GH_REPO=xre000001-ai/vidy-addon, GH_PATH=dt_index.json)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API = 'https://api.deadbase.host/api/v1/public';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://deadtoons.sbs/', 'Origin': 'https://deadtoons.sbs' };

const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : (process.argv.includes('--' + k) ? true : d); };
const MAX = Number(arg('max', 1600));   // ★ v1.34.142: ১২০০ → ১৬০০ (ব্রেডথ-পাস: ১৪৩৩ শো × ১ এপি ≈ ১৪০০-১৮০০ লিঙ্ক)
const CONC = Number(arg('conc', 24));
const OUT = String(arg('out', path.join(__dirname, 'dt_index.json')));
const PAGES = Number(arg('pages', 29));
// ★★ v1.34.142 (প্রোড-প্রমাণ: ইনডেক্স ২৬ শো / ১৪৩৩ শো-র তালিকা ⇒ `idxReady:0` ⇒ Deadtoons কার্ড ০):
//   পুরোনো বিল্ডার **ডেপথ-ফার্স্ট** ছিল — MAX লিঙ্ক একই শো-এর সব এপিসোডে খরচ হতো (মাপা: `স্ক্যান=১ শো`),
//   তাই কভারেজ আটকে থাকত। এখন ডিফল্ট **ব্রেডথ-ফার্স্ট**: প্রতি রানে প্রতিটি শো-এর কেবল
//   **পাস-নম্বরের এপিসোড** (১ম পাসে S1E1, ২য় পাসে S1E2 …) ⇒ ১৪৩৩ শো-র E1 এক রানেই কভার হয়।
const MODE = String(arg('mode', 'breadth'));
// ★ v1.34.142: প্রতি শো-এ সর্বোচ্চ কতটি লিঙ্ক রাখবে (ব্রেডথ)। ১-২ রাখলেই DT-প্রমাণের জন্য যথেষ্ট,
//   আর তাতে এক রানেই ১৪৩৩ শো-র প্রথম-এপিসোড কভার হয়ে যায় (মাপা: ~৬ লিঙ্ক/শো ⇒ রান অনেক লম্বা হতো)।
const PER_SHOW = Math.max(1, Number(arg('per', 2)));
const PUBLISH = !!arg('publish', false);
const SHORTENER = Number(arg('short', 7));
const VERIFY = Number(arg('verify', 400));      // প্রতি রানে কতটি পুরোনো এন্ট্রি Range-প্রমাণে যাচাই হবে

const getJson = async (p, ms = 15000) => { try { const r = await fetch(API + p, { headers: H, signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
const postJson = async (p, body, ms = 9000) => { try { const r = await fetch(API + p, { method: body === null ? 'GET' : 'POST', headers: Object.assign({}, H, body === null ? {} : { 'Content-Type': 'application/json' }), body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };

// ---------- unordered → একটি লিঙ্ক আনলক (১৫সে গেট, অ্যাডনের dtUnlockOne-এর হুবহু কপি) ----------
async function unlock(id) {
  const t0 = Date.now();
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
      c = null;
      const g2 = await postJson('/own-shortener/gate/' + tok, {});
      if (!g2) break;
      if (g2.done) { c = g2; break; }
      rem = Math.max(600, Number(g2.remaining_seconds || 1) * 1000 + 400);
    }
    if (!c || !c.done) return null;
  }
  const f = await postJson('/unlock/callback/' + tok, {});
  const url = f && f.url;
  return url ? { u: String(url), ms: Date.now() - t0 } : null;
}

// ---------- লিঙ্ক-তালিকা → কাজের আইডি (HubCloud + Pixeldrain, 480p বাদ — ইউজার-নীতি) ----------
function idsOf(links) {
  const out = [];
  for (const l of (links || [])) {
    const q = String(l.quality || '');
    if (/^480p/i.test(q)) continue;
    for (const s of (l.servers || [])) {
      const nm = String(s.name || '');
      if (!/^(hubcloud|pixeldrain)$/i.test(nm)) continue;            // FilePress/Telegram বাদ (প্রমাণ হয় না)
      if (!s.link_server_id) continue;
      out.push({ id: Number(s.link_server_id), h: nm.toLowerCase(), q, size: String(l.size || '') });
    }
  }
  return out;
}

// ---------- পুরোনো এন্ট্রির সত্যতা যাচাই (ফাইল মরে গেলে এন্ট্রি বাদ) ----------
async function proofPixeldrain(u) {
  try {
    const id = u.split('/u/')[1].split(/[?#]/)[0];
    const r = await fetch('https://pixeldrain.com/api/file/' + id + '?download', { headers: { 'User-Agent': UA, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) });
    if (r.status !== 200 && r.status !== 206) return false;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > 0 && b[0] !== 0x3c;
  } catch { return false; }
}
// ★ মাপা (১২-১১-২০২৬): gamerxyt-পেজে **দুটো** PixelServer — একটি মৃত (`negn6f` ৪০৪), একটি জীবিত।
//   পুরোনো verify শুধু প্রথমটাই দেখত ⇒ ৪০০-এর ২৮০ ভুয়া-"dead" (pixeldrain 12/12 সুস্থ)। এখন **সব** প্রার্থী।
async function proofHubcloud(u) {
  try {
    const g = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://hubcloud.pw/' }, signal: AbortSignal.timeout(15000) }).then(r => (r.ok ? r.text() : '')).catch(() => '');
    if (!g) return false;
    const gx = (g.match(/https:\/\/gamerxyt\.com\/hubcloud\.php\?[^"'\s]+/) || [])[0];
    const page = gx ? await fetch(gx, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }).then(r => (r.ok ? r.text() : '')).catch(() => '') : g;
    const px = [...String(page).matchAll(/pixeldrain\.(?:dev|com)\/u\/([A-Za-z0-9]{5,})/g)].map(m => m[1]);
    const fsl = [...String(page).matchAll(/https:\/\/[A-Za-z0-9.\-]+\.(?:r2\.cloudflarestorage\.com|workers\.dev)\/[^"'\s]+/g)].map(m => m[0]);
    const cands = px.map(id => 'https://pixeldrain.com/u/' + id).concat(fsl)
      .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => (/negn6f/.test(a) ? 1 : 0) - (/negn6f/.test(b) ? 1 : 0));
    for (const c of cands.slice(0, 5)) {
      if (/pixeldrain/.test(c)) { if (await proofPixeldrain(c)) return true; }
      else { try { const rr = await fetch(c, { headers: { 'User-Agent': UA, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(12000) }); if (rr.status === 200 || rr.status === 206) return true; } catch { } }
    }
    return false;
  } catch { return false; }
}

(async () => {
  const t00 = Date.now();
  // (১) পুরোনো ইনডেক্স মিলিয়ে নাও (merge — কখনো হারায় না) + cursor (কোথা থেকে স্ক্যান শুরু)
  let idx = { ver: 1, ts: 0, n: 0, cursor: 0, pass: 0, links: {} };
  try { const j = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (j && j.links) idx = Object.assign(idx, j); } catch { }
  const have = new Set(Object.keys(idx.links || {}));
  const before = have.size;

  // (২) অ্যানিমে-তালিকা (পেজিনেটেড পাবলিক লিস্টিং)
  const list = [];
  for (let p = 1; p <= PAGES; p++) {
    const j = await getJson('/anime?page=' + p + '&limit=50');
    const d = (j && j.data) || [];
    if (!d.length) break;
    for (const x of d) if (x && x.slug) list.push({ slug: x.slug, type: x.type || 'tv' });
  }
  // (২খ) ★ পুরোনো এন্ট্রি যাচাই — মাপা: একই link_server_id বারবার আনলকেও URL **একই থাকে**,
  //      কিন্তু pixeldrain/hubcloud-এর ফাইল **মরে যেতে পারে** ⇒ Range-প্রমাণে মৃত এন্ট্রি বাদ।
  if (VERIFY > 0 && Object.keys(idx.links).length) {
    const keys = Object.keys(idx.links).sort((a, b) => (idx.links[a].t || 0) - (idx.links[b].t || 0)).slice(0, VERIFY);
    let vOk = 0, vBad = 0, vi = 0;
    const vq = keys.slice();
    await Promise.all(Array.from({ length: Math.min(24, vq.length) }, async () => {
      for (;;) {
        const k = vq.shift(); if (!k) return;
        const e = idx.links[k]; if (!e || !e.u) { delete idx.links[k]; continue; }
        const good = e.h === 'pixeldrain' ? await proofPixeldrain(e.u) : await proofHubcloud(e.u);
        if (good) { e.t = Date.now(); vOk++; } else { delete idx.links[k]; vBad++; }
        if (++vi % 100 === 0) console.log('[idx] verify ' + vi + '/' + keys.length + ' ok=' + vOk + ' dead=' + vBad);
      }
    }));
    console.log('[idx] verify শেষ: ok=' + vOk + ' dead=' + vBad + ' (বাদ-পড়েছে) @' + Math.round((Date.now() - t00) / 1000) + 's');
  }

  let cur0 = Number(idx.cursor || 0);
  if (!(cur0 >= 0 && cur0 < list.length)) { cur0 = 0; idx.pass = Number(idx.pass || 0); }
  console.log('[idx] anime তালিকা:', list.length, '| cursor:', cur0, '| pass:', idx.pass || 0, '| mode:', MODE, '| max:', MAX, '| আগের ইনডেক্স:', before);

  // (৩) ★ পাইপলাইন: স্ক্যান আর আনলক একসাথে (আগে সব স্ক্যান শেষে আনলক ⇒ সময় নষ্ট)
  const q = [];
  let done = 0, ok = 0, fail = 0, queued = 0;
  const TARGET = MAX * 1.15;
  async function worker() {
    for (;;) {
      const c = q.shift();
      if (!c) { if (globalThis.__dtScanDone) return; await new Promise(r => setTimeout(r, 250)); continue; }
      const r = await unlock(c.id);
      done++;
      if (r && r.u) { ok++; idx.links[String(c.id)] = { u: r.u, h: c.h, q: c.q, slug: c.slug, s: c.s, e: c.e, t: Date.now() }; }
      else fail++;
      if (done % 60 === 0) console.log('[idx] unlock ' + done + ' (ok=' + ok + ' fail=' + fail + ') queue=' + q.length + ' @' + Math.round((Date.now() - t00) / 1000) + 's');
    }
  }
  globalThis.__dtScanDone = false;
  const workers = Array.from({ length: CONC }, worker);

  let scannedFrom = cur0, animeScanned = 0;
  for (let ai = cur0; ai < list.length; ai++) {
    if (queued >= TARGET) break;
    const a = list[ai];
    const meta = await getJson('/anime/' + encodeURIComponent(a.slug), 9000);
    animeScanned++;
    scannedFrom = ai + 1;
    if (!meta) continue;
    const seasons = (meta.seasons || []).filter(s2 => (s2.episode_count || 0) > 0);
    const push = (c, sn, e) => {
      if (have.has(String(c.id))) return;
      have.add(String(c.id));
      q.push(Object.assign(c, { slug: a.slug, s: sn, e }));
      queued++;
    };
    if (!seasons.length) { for (const c of idsOf(meta.links)) push(c, 0, 0); continue; }
    if (MODE === 'breadth') {
      // ★ v1.34.142: কভারেজ-প্রথম — প্রতি শো-এ মাত্র **একটি** এপিসোড (পাস p ⇒ E(p)), সব সিজনে।
      //   ফলে এক রানেই ১৪৩৩ শো-র প্রথম-এপিসোড ইনডেক্স হয় ⇒ `idxReady` > 0 ⇒ DT কার্ড প্রথম-ট্যাপেই।
      const want = Math.max(1, Number(idx.pass || 0) + 1);
      const qBefore = queued;
      for (const s2 of seasons) {
        if (queued >= TARGET || (queued - qBefore) >= PER_SHOW) break;
        const sn = Number(s2.season_number || 1), cnt = Math.min(Number(s2.episode_count || 0), 80);
        if (want > cnt) continue;
        const d = await getJson('/anime/' + encodeURIComponent(a.slug) + '/season/' + sn + '/episode/' + want, 9000);
        for (const c of idsOf((d && d.links) || [])) { if ((queued - qBefore) >= PER_SHOW) break; push(c, sn, want); }
      }
      if (queued >= TARGET) break;
      continue;
    }
    for (const s2 of seasons) {
      const sn = Number(s2.season_number || 1), cnt = Math.min(Number(s2.episode_count || 0), 80);
      for (let e = 1; e <= cnt; e++) {
        if (queued >= TARGET) break;
        const d = await getJson('/anime/' + encodeURIComponent(a.slug) + '/season/' + sn + '/episode/' + e, 9000);
        for (const c of idsOf((d && d.links) || [])) push(c, sn, e);
      }
      if (queued >= TARGET) break;
    }
  }
  globalThis.__dtScanDone = true;
  await Promise.all(workers);

  idx.ver = 1; idx.ts = Date.now(); idx.n = Object.keys(idx.links).length;
  idx.cursor = scannedFrom >= list.length ? 0 : scannedFrom;
  if (scannedFrom >= list.length) idx.pass = Number(idx.pass || 0) + 1;
  fs.writeFileSync(OUT, JSON.stringify(idx));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('[idx] ✅ স্ক্যান=' + animeScanned + ' অ্যানিমে | unlock ok=' + ok + ' fail=' + fail + ' | মোট-এন্ট্রি ' + before + ' → ' + idx.n + ' | cursor ' + cur0 + '→' + idx.cursor + ' | ' + kb + 'KB | ' + Math.round((Date.now() - t00) / 1000) + 's');

  // (৫) GitHub-এ প্রকাশ (contents API — git-push নয়, তাই হালকা ও নির্ভরযোগ্য)
  if (PUBLISH) {
    const tok = process.env.GH_TOKEN || '';
    const repo = process.env.GH_REPO || 'xre000001-ai/vidy-addon';
    const p2 = process.env.GH_PATH || 'dt_index.json';
    if (!tok) { console.error('[idx] GH_TOKEN নেই — প্রকাশ বাদ'); process.exit(0); }
    const api = 'https://api.github.com/repos/' + repo + '/contents/' + p2;
    const cur = await fetch(api + '?ref=' + (process.env.GH_BRANCH || 'main'), { headers: { Authorization: 'Bearer ' + tok, 'User-Agent': UA } }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const body = { message: 'dt index: ' + idx.n + ' links (cursor ' + idx.cursor + ', pass ' + (idx.pass || 0) + ') ' + new Date().toISOString().slice(0, 16), content: Buffer.from(fs.readFileSync(OUT)).toString('base64'), branch: process.env.GH_BRANCH || 'main' };
    if (cur && cur.sha) body.sha = cur.sha;
    const r2 = await fetch(api, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j2 = await r2.json().catch(() => ({}));
    console.log('[idx] GitHub publish:', r2.status, j2 && j2.commit ? j2.commit.sha.slice(0, 10) : JSON.stringify(j2).slice(0, 140));
  }
})();
