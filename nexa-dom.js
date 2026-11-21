#!/usr/bin/env node
/* nexa-dom.js — watch-পেজের DOM জরিপ: সার্ভার-বাটন, audio, প্লে-বাটন (ডেভ টুল) */
'use strict';
const T0 = Date.now();
(async () => {
  const { chromium } = require('playwright');
  try { require('./nexa-browser').ensure(); } catch (e) { }
  try { const nl = require('./nexa-libs'); const st = nl.ensure(); if (st && st.ld && !st.skip) process.env.LD_LIBRARY_PATH = st.ld; } catch (e) { }
  const out = {};
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1'] });
  try {
    const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', viewport: { width: 1000, height: 700 } });
    await ctx.route('**/*', r => { const t = r.request().resourceType(); const u = r.request().url(); if (t === 'image' || t === 'media' || u.includes('tmdb.org')) return r.abort(); return r.continue(); });
    const page = await ctx.newPage();
    const pls = [];
    page.on('response', async (r) => {
      const u = r.url();
      if (u.includes('cdn-m3u8') || u.includes('/v1/playlist')) {
        let code = r.status(); let kind = 'other';
        try { const t = await r.text(); if (t.startsWith('#EXTM3U')) kind = t.includes('STREAM-INF') ? 'master' : 'media'; else kind = t.slice(0, 24).replace(/\s+/g, ' '); } catch (e) { kind = 'unreadable'; }
        pls.push({ host: u.includes('cdn-m3u8') ? 'cdn' : 'api', code, kind });
      }
    });
    await page.goto('https://nexa.mov/watch/tmdb-movie/27205', { waitUntil: 'commit', timeout: 20000 });
    await page.waitForTimeout(6000);
    out.title = await page.title();
    out.url = page.url();
    out.buttons = await page.evaluate(() => [...document.querySelectorAll('button,[role="button"],a')].map(e => (e.getAttribute('aria-label') || e.innerText || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 28)).filter(Boolean).slice(0, 40));
    out.text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600);
    try { await page.locator('[aria-label*="lay" i]').first().click({ timeout: 2000, force: true }); out.clicked = 1; } catch (e) { out.clicked = 0; }
    await page.waitForTimeout(12000);
    out.afterButtons = await page.evaluate(() => [...document.querySelectorAll('button,[role="button"]')].map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 24)).filter(Boolean).slice(0, 40));
    out.responses = pls.slice(0, 12);
    out.ms = Date.now() - T0;
  } finally { try { await b.close(); } catch (e) { } }
  console.log(JSON.stringify(out));
})();
