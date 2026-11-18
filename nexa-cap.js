#!/usr/bin/env node
/* nexa-cap.js — এক-শট ক্যাপচার (Node + playwright; BeamUp কনটেইনারে python নেই, তাই JS)।
   ব্যবহার: node nexa-cap.js --id 27205 [--platform tmdb] [--s 1 --e 2] [--proxy host:port] [--timeout 20]
   আউটপুট: এক লাইন JSON {ok,variants:[{res,h,bw,url}],audio,headers,ms,err} */
'use strict';
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });
const T0 = Date.now();
const OUT = (o) => { process.stdout.write(JSON.stringify(o) + '\n'); };
(async () => {
  const out = { ok: false, variants: [], headers: { referer: 'https://nexa.mov/', origin: 'https://nexa.mov' }, err: '' };
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { out.err = 'no-playwright'; return OUT(out); }
  /* ★ v1.34.333: BeamUp ইমেজে chromium বাইনারি থাকে না — দরকারে নামিয়ে নিই */
  try { require('./nexa-browser').ensure(); } catch (e) { }
  const id = String(args.id || '');
  if (!/^\d+$/.test(id)) { out.err = 'bad-id'; return OUT(out); }
  const platform = args.platform || 'tmdb';
  const timeout = Math.max(8000, Math.min(40000, Number(args.timeout || 20) * 1000));
  let path;
  if (platform === 'anilist') path = 'anilist/' + id + '/e' + (args.e || 1);
  else if (args.e) path = 'tmdb-tv/' + id + '/s' + (args.s || 1) + '-e' + args.e;
  else path = 'tmdb-movie/' + id;
  const launch = { args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-software-rasterizer', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=96',
    '--disable-blink-features=AutomationControlled'] };
  if (args.proxy && args.proxy.includes(':')) {
    const [h, p] = args.proxy.split(':');
    launch.proxy = { server: 'http://' + h + ':' + p };
  }
  let browser = null;
  const got = {};
  try {
    browser = await chromium.launch(launch);
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', viewport: { width: 1000, height: 700 }, locale: 'en-US' });
    await ctx.route('**/*', (route) => {
      const t = route.request().resourceType(); const u = route.request().url();
      if (t === 'image' || t === 'media' || u.includes('.ts') || u.includes('tmdb.org') || u.includes('anilist.co')) return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();
    page.on('response', async (r) => {
      const u = r.url();
      if (!u.includes('cdn-m3u8') || got.master || got.single) return;
      try {
        const buf = await r.body();
        if (!buf || buf.slice(0, 4).toString('latin1') !== '#EXT') return;
        const txt = buf.toString('latin1');
        if (txt.includes('EXT-X-STREAM-INF')) got.master = { url: u, body: txt };
        else if (txt.includes('EXTINF')) got.single = { url: u, body: txt };
      } catch (e) { }
    });
    try { await page.goto('https://nexa.mov/watch/' + path, { waitUntil: 'commit', timeout: 16000 }); } catch (e) { }
    let clicked = false;
    while (Date.now() - T0 < timeout && !got.master && !got.single) {
      if (!clicked) {
        try {
          const loc = page.locator('[aria-label*="lay" i]').first();
          if (await loc.count()) { await loc.click({ timeout: 700, force: true }); clicked = true; }
        } catch (e) { }
      }
      await page.waitForTimeout(250);
    }
  } catch (e) {
    out.err = ('launch:' + String(e && e.message || e)).slice(0, 120);
    out.ms = Date.now() - T0;
    try { if (browser) await browser.close(); } catch (e2) { }
    return OUT(out);
  }
  try { await browser.close(); } catch (e) { }
  out.ms = Date.now() - T0;
  const src = got.master || got.single;
  if (!src) { out.err = 'no-playlist'; return OUT(out); }
  const body = src.body;
  if (got.master) {
    const lines = body.split('\n'); const variants = []; let audio = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (ln.startsWith('#EXT-X-STREAM-INF')) {
        const mRes = ln.match(/RESOLUTION=(\d+)x(\d+)/);
        const mBw = ln.match(/BANDWIDTH=(\d+)/);
        let url = null;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const s = lines[j].trim(); if (s && !s.startsWith('#')) { url = s; break; }
        }
        if (url) {
          const h = mRes ? Math.min(Number(mRes[1]), Number(mRes[2])) : null;
          variants.push({ res: mRes ? mRes[1] + 'x' + mRes[2] : null, h, bw: mBw ? Number(mBw[1]) : 0, url });
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
  return OUT(out);
})();
