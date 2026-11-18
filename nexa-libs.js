#!/usr/bin/env node
/* nexa-libs.js — root ছাড়াই chromium-এর শেয়ার্ড লাইব্রেরি (Ubuntu 22.04/jammy)।
   libs/chromium-libs-ubuntu22.04.tgz (রেপোতে, ৪৭ MB) → .nexalibs/root → LD_LIBRARY_PATH
   সব ব্যর্থ হলেও exit 0 — build কখনো ভাঙবে না। */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '.nexalibs');
const EXT = path.join(ROOT, 'root');
const TAR = path.join(__dirname, 'libs', 'chromium-libs-ubuntu22.04.tgz');

function ldPath() {
  const dirs = [path.join(EXT, 'usr/lib/x86_64-linux-gnu'), path.join(EXT, 'usr/lib'), path.join(EXT, 'lib/x86_64-linux-gnu'), path.join(EXT, 'lib')];
  return dirs.filter(d => fs.existsSync(d)).join(':');
}

function install() {
  if (ldPath().split(':').length >= 2) return { ok: true, cached: true, ld: ldPath() };
  if (!fs.existsSync(TAR)) return { ok: false, why: 'tar missing' };
  fs.mkdirSync(EXT, { recursive: true });
  const cp = spawnSync('tar', ['xzf', TAR, '-C', EXT], { encoding: 'utf8', timeout: 240000 });
  return { ok: ldPath().split(':').length >= 2, why: ((cp.stderr || '') + (cp.stdout || '')).slice(-120), ld: ldPath() };
}

function ensure() {
  /* ★ শুধু দরকার হলে: এই সিস্টেমে chromium-এর লাইব্রেরি মিসিং থাকলে তবেই .nexalibs ব্যবহার */
  try {
    let exe = null;
    try { exe = require('./nexa-browser').exePath(); } catch (e) { }
    if (!exe) return { ok: false, why: 'no-exe' };
    const miss = missingLibs(exe, false);   /* ★ LD_LIBRARY_PATH ছাড়া */
    if (!miss.length) return { ok: true, skip: true, why: 'libs-ok' };
    const st = install();
    return Object.assign({}, st, { missing: miss.slice(0, 6) });
  } catch (e) { return { ok: false, why: String(e && e.message || e).slice(0, 120) }; }
}

function missingLibs(exe, useOurLibs) {
  try {
    const env = Object.assign({}, process.env);
    if (useOurLibs) env.LD_LIBRARY_PATH = ldPath();
    else delete env.LD_LIBRARY_PATH;      /* ★ সিস্টেমে সত্যিই আছে কি না — নিরপেক্ষ চেক */
    const cp = spawnSync('ldd', [exe], { encoding: 'utf8', timeout: 60000, env: env });
    return String(cp.stdout || '').split('\n').filter(l => l.includes('not found')).map(l => l.trim().slice(0, 60));
  } catch (e) { return ['ldd-fail']; }
}

if (require.main === module) {
  try {
    const a = process.argv[2] || 'install';
    if (a === 'status') {
      const out = { ld: ldPath(), dirs: ldPath().split(':').filter(Boolean).length };
      try { out.exe = require('./nexa-browser').exePath(); } catch (e) { }
      if (out.exe) out.missing = missingLibs(out.exe).slice(0, 10);
      console.log(JSON.stringify(out, null, 1));
    } else console.log(JSON.stringify(install(), null, 1));
  } catch (e) { console.log('nexa-libs: non-fatal ' + String(e && e.message || e).slice(0, 120)); }
  process.exit(0);
}
module.exports = { ensure, ldPath, install, missingLibs, EXT };
