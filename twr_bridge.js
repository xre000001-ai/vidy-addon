// twr_bridge.js — রেজলভার-ব্রিভ v1.0 (ইউজারের-চূড়ান্ত-ম্যাপ: রেজলভার-অ্যাডন [toonworld4all+raretoons]
// নিজ-নিজ-API-কী-দিয়ে-হাব-সাব-স্পেস-থেকে-প্রক্সি-সংগ্রহ+নিজের-এখানে-জমা+ব্যবহার)
// · /find?source=toonworld|raretoons&title=… → আসল-রেজলভার-কল-নিজ-স্পেসে-bench-হওয়া-px-দিয়ে (স্টিকি×২ → হাব-রেস → সরাসরি-ফলব্যাক)
// · মিরর: প্রতি-৬০সে-নিজ-কী-দিয়ে-হাব-/pick → twr_bridge_mirror.json (জমার-প্রমাণ)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const VERSION = '1.0.0';
const PORT = Number(process.env.PORT || 8290);
const HUB = String(process.env.POOLHUB || 'http://127.0.0.1:8399').replace(/\/$/, '');
const UP = String(process.env.UPSTREAM || 'https://3404d3c5dc63-raretoons.baby-beamup.club').replace(/\/$/, '');
const SUBS = ['toonworld4all', 'raretoons'];
const MFILE = path.join(__dirname, 'twr_bridge_mirror.json');
let KEYS = {}; try { KEYS = JSON.parse(fs.readFileSync(String(process.env.POOLHUB_KEYS || path.join(__dirname, 'poolhub_keys.json')), 'utf8')); } catch (e) { }
const MIRROR = {}; for (const k of SUBS) MIRROR[k] = [];
try { const o = JSON.parse(fs.readFileSync(MFILE, 'utf8')); for (const k of SUBS) if (Array.isArray(o[k])) MIRROR[k] = o[k]; } catch (e) { }
let USED = { toonworld4all: 0, raretoons: 0 }, MIRR_B = false;
async function mirror() {
  if (MIRR_B) return; MIRR_B = true;
  try {
    for (const src of SUBS) {
      try {
        const K = KEYS[src] ? '&key=' + encodeURIComponent(KEYS[src]) : '';
        const r = await fetch(HUB + '/pick?src=' + src + '&n=40' + K, { signal: AbortSignal.timeout(6000) });
        const j = await r.json(); if (!j || !Array.isArray(j.pick)) continue;
        const own = j.pick.filter(p => p.own); if (!own.length) continue;
        MIRROR[src] = own.map(p => ({ px: p.px, ms: p.ms || null }));
      } catch (e) { }
    }
    try { fs.writeFileSync(MFILE, JSON.stringify(MIRROR)); } catch (e) { }
    console.log('[bridge-mirror] ' + SUBS.map(s => s + '=' + MIRROR[s].length).join(' '));
  } finally { MIRR_B = false; }
}
function viaHub(src, px, url) {
  return new Promise(res => {
    const K = KEYS[src] ? '&key=' + encodeURIComponent(KEYS[src]) : '';
    fetch(HUB + '/fetch?src=' + src + K + (px ? '&px=' + encodeURIComponent(px) : '') + '&ms=9000&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(11500) })
      .then(r => r.json()).then(j => { if (j && j.ok && String(j.body || '')[0] === '{') return res(String(j.body)); res(null); }).catch(() => res(null));
  });
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const jout = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/health') return jout(200, { ok: 1, version: VERSION, upstream: UP, mirror: Object.fromEntries(SUBS.map(s => [s, MIRROR[s].length])), keys: Object.fromEntries(SUBS.map(s => [s, !!KEYS[s]])), used: USED, up: Math.floor(process.uptime()) });
  if (u.pathname !== '/find') return jout(404, { err: 'route?' });
  const src = u.searchParams.get('source') === 'raretoons' ? 'raretoons' : 'toonworld4all';
  const UURL = UP + '/find?' + u.searchParams.toString();
  const t0 = Date.now(); USED[src] = (USED[src] || 0) + 1;
  for (const c of (MIRROR[src] || []).slice(0, 2)) { const b = await viaHub(src, c.px, UURL); if (b) { console.log('[bridge] ' + src + ' px=' + c.px + ' ✓ ' + (Date.now() - t0) + 'ms'); return jout(200, JSON.parse(b)); } } // নিজ-স্পেস-px-স্টিকি×২
  const b2 = await viaHub(src, '', UURL); if (b2) { console.log('[bridge] ' + src + ' হাব-রেস ✓ ' + (Date.now() - t0) + 'ms'); return jout(200, JSON.parse(b2)); }
  try { const r = await fetch(UURL, { signal: AbortSignal.timeout(25000) }); const t = await r.text(); if (t && t[0] === '{') { console.log('[bridge] ' + src + ' সরাসরি-ফলব্যাক ' + (Date.now() - t0) + 'ms'); return jout(200, JSON.parse(t)); } } catch (e) { }
  return jout(200, { streams: [], err: 'twr-bridge-empty', el: Date.now() - t0 });
});
server.listen(PORT, '0.0.0.0', () => console.log('[twr-bridge] ' + VERSION + ' on :' + PORT + ' | হাব=' + HUB + ' | আপস্ট্রিম=' + UP + ' | কী: ' + SUBS.map(s => s + '=' + (KEYS[s] ? '✓' : '✗')).join(' ')));
setTimeout(mirror, 8000).unref(); setInterval(mirror, 60000).unref();
