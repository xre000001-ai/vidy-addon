#!/usr/bin/env node
/* nexa-cap.js — এক-শট ক্যাপচার (Node + playwright; BeamUp কনটেইনারে python নেই, তাই JS)।
   ব্যবহার: node nexa-cap.js --id 27205 [--platform tmdb] [--s 1 --e 2] [--proxy host:port] [--timeout 20]
   আউটপুট: এক লাইন JSON {ok,variants:[{res,h,bw,url}],audio,headers,ms,err} */
'use strict';
const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (!a.startsWith('--')) return;
  const k = a.slice(2), v = arr[i + 1];
  args[k] = (v && !String(v).startsWith('--')) ? v : 1;   /* ★ ফ্ল্যাগ-ওয়ান-কী (--serve) */
});
const T0 = Date.now();
const OUT = (o) => { process.stdout.write(JSON.stringify(o) + '\n'); };
async function capture(args, shared) {
  const t0 = Date.now();
  const out = { ok: false, variants: [], headers: { referer: 'https://nexa.mov/', origin: 'https://nexa.mov' }, err: '' };
  let chromium = null;
  try { ({ chromium } = require('playwright')); } catch (e) { out.err = 'no-playwright'; return out; }
  try { require('./nexa-browser').ensure(); } catch (e) { }
  try {
    const nl = require('./nexa-libs'); const st = nl.ensure();
    if (st && st.ld && !st.skip) process.env.LD_LIBRARY_PATH = st.ld + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');
  } catch (e) { }
  const id = String(args.id || '');
  if (!/^\d+$/.test(id)) { out.err = 'bad-id'; return out; }
  const platform = args.platform || 'tmdb';
  const timeout = Math.max(8000, Math.min(40000, Number(args.timeout || 20) * 1000));
  let url;
  if (platform === 'anilist') url = 'https://nexa.mov/watch/anilist/' + id + '/e' + (args.e || 1);
  else if (args.e) url = 'https://nexa.mov/watch/tmdb-tv/' + id + '/s' + (args.s || 1) + '-e' + args.e;
  else url = 'https://nexa.mov/watch/tmdb-movie/' + id;
  const launch = { args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-software-rasterizer', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=96',
    '--disable-blink-features=AutomationControlled'] };
  if (args.proxy && String(args.proxy).includes(':')) {
    const [h, p] = String(args.proxy).split(':');
    launch.proxy = { server: 'http://' + h + ':' + p };
  }
  const own = !(shared && shared.browser);
  let browser = own ? null : shared.browser;
  let ctx = null, page = null;
  const got = {};
  const watch = (p) => {
    p.on('response', async (r) => {
      const u = r.url();
      if (!u.includes('cdn-m3u8') || got.master || got.single) return;
      try {
        const buf = await r.body();
        if (!buf || buf.slice(0, 4).toString('latin1') !== '#EXT') return;
        const txt = buf.toString('latin1');
        if (txt.includes('EXT-X-STREAM-INF')) got.master = { url: u, body: txt };
        else if (txt.includes('EXTINF')) got.single = { url: u, body: txt };
        if (!out.firstAt) out.firstAt = Date.now() - t0;
      } catch (e) { }
    });
  };
  try {
    if (own) { browser = await chromium.launch(launch); out.launchMs = Date.now() - t0; }
    ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      viewport: { width: 1000, height: 700 }, locale: 'en-US',
    });   /* ★ v1.34.363: রিরাইটে UA স্পুফ হারিয়ে গিয়েছিল — nexa headless UA-তে playlist দেয় না */
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType(); const u2 = route.request().url();
      if (t === 'image' || t === 'media' || u2.includes('.ts') || u2.includes('tmdb.org') || u2.includes('anilist.co')) return route.abort();
      return route.continue();
    });
    page = await ctx.newPage();
    out.navMs = Date.now() - t0;
    watch(page);
    try { await page.goto(url, { waitUntil: 'commit', timeout: 20000 }); } catch (e) { }
    while (Date.now() - t0 < timeout && !got.master && !got.single) {
      const clicked = !!(shared && shared.clicked);
      if (!clicked) {
        try {
          const loc = page.locator('[aria-label*="lay" i]').first();
          if (await loc.count()) { await loc.click({ timeout: 800, force: true }); if (shared) shared.clicked = 1; }
        } catch (e) { }
      }
      await page.waitForTimeout(400);
    }
  } catch (e) {
    out.err = ('launch:' + String(e && e.message || e)).replace(/\s+/g, ' ').slice(0, 140);
    out.ms = Date.now() - t0;
    try { if (ctx) await ctx.close(); } catch (e2) { }
    try { if (own && browser) await browser.close(); } catch (e2) { }
    return out;
  }
  try { if (ctx) await ctx.close(); } catch (e) { }
  try { if (own && browser) await browser.close(); } catch (e) { }
  out.ms = Date.now() - t0;
  const src = got.master || got.single;
  if (!src) { out.err = 'no-playlist'; return out; }
  const body = src.body;
  if (got.master) {
    const lines = body.split('\n'); const variants = []; let audio = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (ln.startsWith('#EXT-X-STREAM-INF')) {
        const mRes = ln.match(/RESOLUTION=(\d+)x(\d+)/);
        const mBw = ln.match(/BANDWIDTH=(\d+)/);
        let u3 = null;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const s = lines[j].trim(); if (s && !s.startsWith('#')) { u3 = s; break; }
        }
        if (u3) {
          const h = mRes ? Math.min(Number(mRes[1]), Number(mRes[2])) : null;
          variants.push({ res: mRes ? mRes[1] + 'x' + mRes[2] : null, h, bw: mBw ? Number(mBw[1]) : 0, url: u3 });
        }
      }
      const mA = ln.match(/^#EXT-X-MEDIA.*URI="([^"]+)"/);
      if (mA && !audio) audio = mA[1];
    }
    variants.sort((a, b) => ((b.h || 0) - (a.h || 0)) || ((b.bw || 0) - (a.bw || 0)));
    out.ok = variants.length > 0;
    Object.assign(out, { variants, audio, master: src.url });
    if (!out.ok) out.err = 'master-empty';
  } else {
    const segs = (body.match(/#EXTINF/g) || []).length;
    out.ok = segs > 20;
    Object.assign(out, { variants: [{ res: null, h: null, bw: 0, url: src.url }], segs });
    if (!out.ok) out.err = 'decoy-short';
  }
  return out;
}

/* ───────── CLI / persistent worker ─────────
   node nexa-cap.js --id 27205 [...]            → এক-শট, এক লাইন JSON
   node nexa-cap.js --serve                     → stdin থেকে {"args":{...}} নিয়ে লাইভ ব্রাউজার পুনর্ব্যবহার
   ★ v1.34.351: কোল্ড লঞ্চ ৯–১৪সে (গেটওয়ের ১২s সীমা ভাঙে); warm ব্রাউজারে ৩–৫সে। */
if (require.main === module) {
  if (args.serve) {
    let browserP = null, chain = Promise.resolve();
    const getBrowser = async () => {
      /* ★ v1.34.358: ওয়ার্কারেও chromium-এর libs/executable ঠিক করতে হবে (এক-শট পথে হয়, এখানে হচ্ছিল না) */
      try { require('./nexa-browser').ensure(); } catch (e) { }
      try {
        const nl = require('./nexa-libs'); const st = nl.ensure();
        if (st && st.ld && !st.skip) process.env.LD_LIBRARY_PATH = st.ld + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');
      } catch (e) { }
      const { chromium } = require('playwright');
      const launch = { args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-software-rasterizer', '--renderer-process-limit=1', '--disable-blink-features=AutomationControlled'] };
      const b = await chromium.launch(launch);
      b.on('disconnected', () => { browserP = null; });
      return b;
    };
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        chain = chain.then(async () => {
          let req = {};
          try { req = JSON.parse(line); } catch (e) { process.stdout.write(JSON.stringify({ ok: false, err: 'bad-json' }) + '\n'); return; }
          const t0 = Date.now();
          try {
            if (!browserP) browserP = getBrowser();
            const br = await browserP;
            const out = await capture(req.args || {}, { browser: br });
            out.warm = 1; out.total = Date.now() - t0;
            process.stdout.write(JSON.stringify(out) + '\n');
          } catch (e) {
            browserP = null;
            process.stdout.write(JSON.stringify({ ok: false, err: 'worker:' + String(e && e.message || e).slice(0, 100), total: Date.now() - t0 }) + '\n');
          }
        });
      }
    });
    process.stdin.on('end', () => process.exit(0));
    return;
  }
  capture(args, null).then(o => process.stdout.write(JSON.stringify(o) + '\n')).catch(e => process.stdout.write(JSON.stringify({ ok: false, err: String(e && e.message || e).slice(0, 120) }) + '\n'));
}
module.exports = { capture };
