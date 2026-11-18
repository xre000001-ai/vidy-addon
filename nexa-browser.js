#!/usr/bin/env node
/* nexa-browser.js — chromium বাইনারি নিশ্চিত করে (BeamUp/Heroku-ish ইমেজে থাকে না)।
   ★ কখনো নন-জিরো এক্সিট নয়: postinstall ব্যর্থ হলেও অ্যাডঅনের build ভাঙবে না। */
'use strict';
/* ★ v1.34.339: দরকার হলে প্রথমে .nexalibs → LD_LIBRARY_PATH (chromium লঞ্চের আগেই) */
try {
  let exe0 = null; try { const b = require('./nexa-browser'); exe0 = b.exePath(); } catch (e) { }
  const path = require('path');
  const dirs = [path.join(__dirname, '.nexalibs/root/usr/lib/x86_64-linux-gnu'), path.join(__dirname, '.nexalibs/root/usr/lib')];
  if (exe0) {
    const cp0 = spawnSync('ldd', [exe0], { encoding: 'utf8', timeout: 30000 });
    if (String(cp0.stdout || '').includes('not found')) {
      const ok = dirs.filter(d => fs.existsSync(d));
      if (ok.length) process.env.LD_LIBRARY_PATH = ok.join(':') + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');
    }
  }
} catch (e) { }
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

function exePath() {
  return safe(() => {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    return p && fs.existsSync(p) ? p : null;
  }, null);
}

function cliCandidates() {
  const out = [];
  const r = safe(() => require.resolve('playwright/cli.js'), null);
  if (r) out.push(r);
  out.push(path.join(__dirname, 'node_modules', 'playwright', 'cli.js'));
  out.push(path.join(__dirname, 'node_modules', 'playwright-core', 'cli.js'));
  return out.filter(p => safe(() => fs.existsSync(p), false));
}

function install(timeoutMs) {
  const t = timeoutMs || 480000;
  for (const cli of cliCandidates()) {
    const cp = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', timeout: t });
    if (cp.status === 0) return true;
  }
  /* শেষ চেষ্টা: npx */
  const cp2 = spawnSync('npx', ['--yes', 'playwright', 'install', 'chromium'], { stdio: 'inherit', timeout: t, shell: true });
  return cp2.status === 0;
}

function ensure() {
  if (exePath()) return true;
  safe(() => install(480000), false);
  return !!exePath();
}

if (require.main === module) {
  try {
    const arg = process.argv[2] || 'install';
    if (arg === 'check') { console.log(exePath() ? 'OK ' + exePath() : 'MISSING'); }
    else { const ok = install(480000); console.log(ok ? 'chromium ready' : 'chromium install failed (non-fatal)'); }
  } catch (e) {
    console.log('nexa-browser: non-fatal error ' + String(e && e.message || e).slice(0, 120));
  }
  process.exit(0);      /* ★ সবসময় ০ */
}
module.exports = { ensure, exePath, install };
