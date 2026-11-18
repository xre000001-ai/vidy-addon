#!/usr/bin/env node
/* nexa-probe.js — chromium লঞ্চ-প্রোব (প্রোড ডায়াগনস্টিক)। mode = shell|full|full-single|raw */
'use strict';
const { spawnSync } = require('child_process');
const mode = process.argv[2] || 'shell';
const out = { mode };
try {
  const b = require('./nexa-browser');
  const exe = b.exePath();
  out.exe = exe;
  try { const nl = require('./nexa-libs'); const st = nl.ensure(); out.libs = { ok: !!st.ok, skip: !!st.skip, ld: st.ld }; if (st.ld && !st.skip) process.env.LD_LIBRARY_PATH = st.ld; } catch (e) { out.libs = 'err'; }
  if (mode === 'raw' && exe) {
    const cp = spawnSync(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--dump-dom', 'data:text/html,<h1>OK</h1>'], { encoding: 'utf8', timeout: 60000, env: process.env });
    out.status = cp.status;
    out.stdout = String(cp.stdout || '').trim().slice(0, 200);
    out.stderr = String(cp.stderr || '').split('\n').filter(l => l && !l.includes('Failed to connect to the bus')).slice(-6).join(' | ').slice(0, 700);
    return console.log(JSON.stringify(out));
  }
  const { chromium } = require('playwright');
  const args = mode === 'full-single'
    ? ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote', '--disable-gpu']
    : ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  const opts = { args, timeout: 30000 };
  if (mode === 'full' || mode === 'full-single') opts.executablePath = exe;
  (async () => {
    try {
      const br = await chromium.launch(opts);
      const p = await br.newPage();
      await p.goto('data:text/html,<h1>OK</h1>', { timeout: 20000 });
      const h = await p.evaluate(() => document.body.innerText);
      out.ok = true; out.version = br.version(); out.dom = h;
      await br.close();
    } catch (e) {
      out.ok = false; out.err = String(e && e.message || e).replace(/\s+/g, ' ').slice(0, 600);
      try { out.log = String(e && e.stack || '').slice(0, 200); } catch (x) { }
    }
    console.log(JSON.stringify(out));
  })();
} catch (e) {
  out.fatal = String(e && e.message || e).slice(0, 200);
  console.log(JSON.stringify(out));
}
