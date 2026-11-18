#!/usr/bin/env node
/* nexa-browser.js — chromium বাইনারি নিশ্চিত করে (BeamUp ইমেজে থাকে না)।
   "node nexa-browser.js install"  → postinstall-এ চলে (ব্যর্থ হলেও npm install ভাঙে না)
   require('./nexa-browser').ensure() → রানটাইমে দরকার হলে নামায় */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');

function exePath() {
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    return p && fs.existsSync(p) ? p : null;
  } catch (e) { return null; }
}

function install(timeoutMs) {
  const cp = spawnSync(process.execPath, [require.resolve('playwright/cli.js'), 'install', 'chromium'], {
    stdio: 'inherit', timeout: timeoutMs || 600000, env: Object.assign({}, process.env, { PLAYWRIGHT_BROWSERS_PATH: undefined }),
  });
  return cp.status === 0;
}

function ensure() {
  if (exePath()) return true;
  try { install(600000); } catch (e) { }
  return !!exePath();
}

if (require.main === module) {
  const arg = process.argv[2] || 'install';
  if (arg === 'check') { console.log(exePath() ? 'OK ' + exePath() : 'MISSING'); process.exit(0); }
  const ok = install(600000);
  console.log(ok ? 'chromium ready' : 'chromium install failed');
  process.exit(0);   /* ★ কখনো নন-জিরো নয়: postinstall ব্যর্থ হলেও অ্যাডঅন চলবে */
}
module.exports = { ensure, exePath, install };
