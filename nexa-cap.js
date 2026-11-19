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
    /* ★ v1.34.367: nexa-র প্লেলিস্ট মাঝে মাঝে আসে না (সার্ভার-ফ্ল্যকি) ⇒ একই warm ব্রাউজারে
       ২–৩ বার রিলোড করে চেষ্টা (প্রতিটা সস্তা; নতুন ব্রাউজার লঞ্চ নয়)। */
    /* ★ v1.34.378: সাইটে ৫টি সোর্স (Nova/Onyx/Flux/Sylver/Orion) — সবগুলো সব টাইটেলে স্ট্রিম দেয় না।
       więc: অপেক্ষা করি সোর্স-স্টেটাসের জন্য → Play চাপি → না এলে "Try another source" চেপে আবার Play।
       মোট সময় `timeout`-এর ভিতরেই থাকি (গেটওয়ে/worker বাজেট)। */
    const clickPlay = async () => {
      for (const sel of ['[aria-label="Play"]', 'button[aria-label*="play" i]', '[aria-label*="lay" i]']) {
        try { const l = page.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 900, force: true }); return true; } } catch (e) { }
      }
      return false;
    };
    const clickNext = async () => {
      for (const sel of ['button[aria-label^="Try another source" i]', 'button:has-text("Try another source")', 'button[aria-label*="another source" i]']) {
        try { const l = page.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 1200, force: true }); return true; } } catch (e) { }
      }
      return false;
    };
    const statusOf = async () => {
      try {
        const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
        const m = t.match(/(Nova|Onyx|Flux|Sylver|Orion)[^A-Za-z]{0,6}(No stream|Checking|Queued|Ready|Stream\w*)/gi);
        return m ? m.slice(0, 8) : [];
      } catch (e) { return []; }
    };
    out.tries = [];
    /* ★ v1.34.403: প্রমাণ — প্লেয়ার সত্যিই প্লেলিস্ট চায় কি না, JS মরে কি না */
    try {
      page.on('pageerror', e2 => { out._pageErr = out._pageErr || []; if (out._pageErr.length < 5) out._pageErr.push(String((e2 && e2.message) || e2).slice(0, 100)); });
      page.on('request', r2 => { try { if (/\.m3u8|cdn-m3u8|playlist/i.test(r2.url())) out._plReq = (out._plReq || 0) + 1; } catch (e3) { } });
    } catch (e4) { }
    try { await page.goto(url, { waitUntil: 'commit', timeout: 15000 }); } catch (e) { }
    out.navMs = Date.now() - t0;
    let hops = 0, stale = 0;
    /* ধাপ ১: সোর্স-ফেচিং শেষ হওয়া পর্যন্ত অপেক্ষা (সর্বোচ্চ ~৭সে) */
    const w1 = Date.now();
    while (Date.now() - t0 < timeout && !got.master && !got.single && Date.now() - w1 < 7000) {
      await page.waitForTimeout(400);
      const st = await statusOf();
      if (st.length) out.statuses = st;
      if (st.some(x => /No stream/i.test(x)) || st.length >= 3) break;   /* উত্তর এসে গেছে */
    }
    /* ধাপ ২: Play + দরকারে "Try another source" (মোট ৪টি সোর্স-হপ) */
    while (Date.now() - t0 < timeout && !got.master && !got.single) {
      const tA = Date.now();
      await clickPlay();
      let waited = 0;
      while (Date.now() - t0 < timeout && !got.master && !got.single && waited < 4500) {
        await page.waitForTimeout(300); waited += 300;
      }
      out.tries.push(Date.now() - tA);
      out.hops = hops;
      if (got.master || got.single) {
        /* ★ v1.34.379: এক সোর্স পাওয়া গেল — সময় থাকলে পরের সোর্সও দেখি (সব সোর্সের কার্ড) */
        if (!out.sources) out.sources = [];
        out.sources.push({ idx: hops, src: got.master ? got.master.body : got.single.body, url: (got.master || got.single).url });
        got.master = null; got.single = null;
        const more = Number(args.sources || 3);
        if (hops + 1 >= more || Date.now() - t0 > timeout - 4000) { out.done = 1; break; }
        if (await clickNext()) { hops++; await page.waitForTimeout(900); continue; }
        break;
      }
      const st = await statusOf();
      if (st.length) out.statuses = st;
      if (hops >= 4) { stale++; if (stale >= 2) break; }
      if (!(await clickNext())) {
        if (++stale >= 2) break;
        try { await page.reload({ waitUntil: 'commit', timeout: 12000 }); } catch (e) { }
      } else hops++;
      await page.waitForTimeout(700);
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
  const col = (out.sources && out.sources.length) ? out.sources : ((got.master || got.single) ? [{ idx: out.hops || 0, src: (got.master || got.single).body, url: (got.master || got.single).url }] : []);
  if (!col.length) {
    out.err = 'no-playlist';
    /* ★ v1.34.400: সাইট আসলে কী দেখাচ্ছিল — প্রোডে (১GB কনটেইনার) ক্যাপচার কেন ব্যর্থ, তার প্রমাণ */
    try {
      out.statuses = out.statuses || [];
      out.dbg = { url: out.url || url, navMs: out.navMs, hops: out.hops, tries: out.tries,
        m3u8Req: (typeof out._plReq === 'number' ? out._plReq : -1),
        pageErr: (out._pageErr || []).slice(0, 3),
        lastStatuses: (out.statuses || []).slice(-4), timeout };
    } catch (e) { }
    return out;
  }
  const NAMES = ['nova', 'onyx', 'flux', 'sylver', 'orion'];
  const parseOne = (bodyObj) => {
    const body = bodyObj.src, u0 = bodyObj.url;
    const isMaster = body.includes('EXT-X-STREAM-INF');
    const o1 = { server: NAMES[Math.min(NAMES.length - 1, Math.max(0, bodyObj.idx || 0))] || 'nexa', master: u0 };
    if (isMaster) {
      const lines = body.split('\n'); const vs = []; let audio = null, audioName = '';
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if (ln.startsWith('#EXT-X-STREAM-INF')) {
          const mRes = ln.match(/RESOLUTION=(\d+)x(\d+)/);
          const mBw = ln.match(/BANDWIDTH=(\d+)/);
          let u3 = null;
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) { const t2 = lines[j].trim(); if (t2 && !t2.startsWith('#')) { u3 = t2; break; } }
          if (u3) { const h = mRes ? Math.min(Number(mRes[1]), Number(mRes[2])) : null; vs.push({ res: mRes ? mRes[1] + 'x' + mRes[2] : null, h, bw: mBw ? Number(mBw[1]) : 0, url: u3 }); }
        }
        const mA = ln.match(/^#EXT-X-MEDIA[^\n]*TYPE=AUDIO[^\n]*/);
        if (mA && !audio) {
          const mu = mA[0].match(/URI="([^"]+)"/); if (mu) audio = mu[1];
          const mn = mA[0].match(/NAME="([^"]+)"/); if (mn) audioName = mn[1];
        }
      }
      vs.sort((a, b) => ((b.h || 0) - (a.h || 0)) || ((b.bw || 0) - (a.bw || 0)));
      o1.variants = vs; o1.audio = audio; o1.audioName = audioName;
      o1.codecs = (body.match(/CODECS="([^"]+)"/) || [])[1] || '';
    } else {
      const segs = (body.match(/#EXTINF/g) || []).length;
      o1.variants = [{ res: null, h: null, bw: 0, url: u0 }]; o1.segs = segs;
    }
    return o1;
  };
  const perSource = col.map(parseOne).filter(o2 => (o2.variants || []).length);
  if (!perSource.length) { out.err = 'master-empty'; return out; }
  /* সামঞ্জস্যের জন্য প্রথম সোর্সের ফলাফল শীর্ষস্তরে রাখি (পুরনো কোড-পথ অপরিবর্তিত থাকে) */
  const first = perSource[0];
  out.sources2 = perSource;
  out.server = first.server;
  out.variants = first.variants; out.audio = first.audio; out.audioName = first.audioName;
  out.codecs = first.codecs || ''; out.master = first.master;
  out.ok = true;
  out.ms = Date.now() - t0;
  return out;
}

/* ---- পুরনো একক-সোর্স পার্সিং (আর ব্যবহার হয় না, রেফারেন্সের জন্য রাখা) ---- */
function __legacyParse(body, src) {
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
    /* master-এর কাঁচা লাইন রেখে দিই — CODECS/AUDIO/FRAME-RATE দেখানোর জন্য */
    try {
      out.masterTxt = body.split('\n').filter(l => l.startsWith('#EXT-X-STREAM-INF') || l.startsWith('#EXT-X-MEDIA')).slice(0, 8).map(l => l.slice(0, 300));
      const cod = (body.match(/CODECS="([^"]+)"/) || [])[1] || '';
      const fm = (body.match(/FRAME-RATE=([\d.]+)/) || [])[1] || '';
      out.codecs = cod; out.fps = fm;
    } catch (e) { }
    Object.assign(out, { variants, audio, master: src.url });
    /* কোন সোর্স থেকে এল (DOM-এর সোর্স-তালিকা থেকে অনুমান; সাইট দেখায় Nova/Onyx/Flux/Sylver/Orion) */
    try {
      const nm = (body.match(/# Brand:\s*([^\n]+)/) || [])[1] || '';
      out.brand = nm.trim().slice(0, 40);
      out.server = ['nova', 'onyx', 'flux', 'sylver', 'orion'][Math.min(4, Math.max(0, (out.hops || 0)))] || 'nexa';
    } catch (e) { }
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
  if (args.dom) {   /* DOM জরিপ: সার্ভার-বাটন/সোর্স/প্লে-রেসপন্স */
    const { chromium } = require('playwright');
    (async () => {
      try { require('./nexa-browser').ensure(); } catch (e) { }
      try { const nl = require('./nexa-libs'); const st = nl.ensure(); if (st && st.ld && !st.skip) process.env.LD_LIBRARY_PATH = st.ld; } catch (e) { }
      const out = { t0: Date.now() };
      let b = null;
      try {
        b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1'] });
        const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', viewport: { width: 1000, height: 700 } });
        await ctx.route('**/*', r => { const t = r.request().resourceType(); const u = r.request().url(); if (t === 'image' || t === 'media' || u.includes('tmdb.org')) return r.abort(); return r.continue(); });
        const page = await ctx.newPage();
        const resp = [];
        page.on('response', async (r) => {
          const u = r.url();
          if (u.includes('cdn-m3u8') || u.includes('/v1/playlist')) {
            let kind = '?';
            try { const t = await r.text(); kind = t.startsWith('#EXTM3U') ? (t.includes('STREAM-INF') ? 'master' : 'media') : t.slice(0, 20).replace(/\s+/g, ' '); } catch (e) { kind = 'unreadable'; }
            resp.push({ h: u.includes('cdn-m3u8') ? 'cdn' : 'api', c: r.status(), k: kind });
          }
        });
        const id = String(args.id || '27205');
        const p2 = args.e ? ('tmdb-tv/' + id + '/s' + (args.s || 1) + '-e' + args.e) : ('tmdb-movie/' + id);
        try { await page.goto('https://nexa.mov/watch/' + p2, { waitUntil: 'commit', timeout: 20000 }); } catch (e) { }
        await page.waitForTimeout(7000);
        const sel = 'button,[role="button"],[role="tab"],[role="option"]';
        out.title = await page.title();
        out.btns = await page.evaluate((s2) => [...document.querySelectorAll(s2)].map(e => (e.getAttribute('aria-label') || e.innerText || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 26)).filter(Boolean).slice(0, 40), sel);
        out.txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400);
        try { await page.locator('[aria-label*="lay" i]').first().click({ timeout: 2500, force: true }); out.click = 1; } catch (e) { out.click = 0; }
        await page.waitForTimeout(Number(args.wait || 14000));
        out.btns2 = await page.evaluate((s2) => [...document.querySelectorAll(s2)].map(e => (e.getAttribute('aria-label') || e.innerText || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 26)).filter(Boolean).slice(0, 40), sel);
        out.resp = resp.slice(0, 14);
      } catch (e) { out.err = String(e && e.message || e).slice(0, 200); }
      try { if (b) await b.close(); } catch (e) { }
      out.ms = Date.now() - out.t0;
      console.log(JSON.stringify(out));
    })();
    return;
  }
  if (args.serve) {
    let browserP = null, chain = Promise.resolve();
    setTimeout(() => { try { browserP = getBrowser(); } catch (e) { } }, 50);   /* ★ আগেই গরম */
    const getBrowser = async () => {
      /* ★ v1.34.358: ওয়ার্কারেও chromium-এর libs/executable ঠিক করতে হবে (এক-শট পথে হয়, এখানে হচ্ছিল না) */
      try { require('./nexa-browser').ensure(); } catch (e) { }
      try {
        const nl = require('./nexa-libs'); const st = nl.ensure();
        if (st && st.ld && !st.skip) process.env.LD_LIBRARY_PATH = st.ld + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');
      } catch (e) { }
      const { chromium } = require('playwright');
      const launch = { args: launchArgs() };   /* ★ v1.34.403: worker-ও একই ফ্ল্যাগ পায় */
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
