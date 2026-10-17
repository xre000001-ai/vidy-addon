// twr_bridge — resolver bridge for the toonworld4all + raretoons families.
// v1.1.1 · clean revision: consts first, single hub path, no local state.
//
//   GET /find?source=toonworld4all|raretoons&<resolver params>
//     → one PoolHub /fetch call (the hub races its own benched exits
//       and returns the upstream resolver's JSON).
//   GET /health → hub target, key presence, usage counters.
//
// There is deliberately no mirror file, no sticky pool and no direct
// upstream fallback: the hub is the only proxy authority. When the hub
// has no working exit for a space, the bridge answers with an honest
// empty result.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const VERSION = '1.2.0';
const PORT = Number(process.env.PORT || 8290);
const HUB = String(process.env.POOLHUB || 'https://293c2a7d7dd6-poolhub.baby-beamup.club').replace(/\/$/, '');
const UPSTREAM = String(process.env.UPSTREAM || 'https://3404d3c5dc63-raretoons.baby-beamup.club').replace(/\/$/, '');
const SPACES = ['toonworld4all', 'raretoons'];

const KEYS = (() => {
  try { return JSON.parse(fs.readFileSync(String(process.env.POOLHUB_KEYS || path.join(__dirname, '..', 'config', 'poolhub_keys.json')), 'utf8')); }
  catch { return {}; }
})();

const USED = { toonworld4all: 0, raretoons: 0 };

const spaceOf = (u) => (u.searchParams.get('source') === 'raretoons' ? 'raretoons' : 'toonworld4all');
const upstreamUrl = (u) => `${UPSTREAM}/find?${u.searchParams.toString()}`;

/** One hub-backed resolve. Returns the upstream JSON string, or null. */
function viaHub(space, url) {
  const key = KEYS[space] ? `&key=${encodeURIComponent(KEYS[space])}` : '';
  return fetch(`${HUB}/fetch?src=${space}${key}&ms=9000&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(11500) })
    .then((r) => r.json())
    .then((j) => (j && j.ok && String(j.body || '')[0] === '{' ? String(j.body) : null))
    .catch(() => null);
}

/** v1.2.0: the upstream is OUR OWN beamup app — reachable in ~0.5-1s plain.
 *  Raced alongside the hub: uncached /find answers take 3-6.5s upstream-side,
 *  and hub exits often blew the 9s race window -> sources randomly vanished
 *  ("কিছু টাইটেলে tw/rt আসে না"). First non-null wins; the hub stays in the
 *  race as the resilient path, the direct call is plain fetch of our own
 *  service (no proxy picking, no scanning — r136 rule intact). */
function viaDirect(url) {
  return fetch(url, { signal: AbortSignal.timeout(11000), headers: { 'user-agent': 'twr-bridge/1.2' } })
    .then((r) => r.text())
    .then((t) => (t && t[0] === '{' ? t : null))
    .catch(() => null);
}

function raceHubDirect(space, url) {
  return new Promise((res) => {
    let hubV = null, dirV = null, done = false;
    const fin = () => { if (!done) { const v = dirV || hubV; if (v) { done = true; res(v); } } };
    viaHub(space, url).then((v) => { hubV = v; fin(); });
    viaDirect(url).then((v) => { dirV = v; fin(); });
    setTimeout(() => { if (!done) { done = true; res(hubV || dirV); } }, 11500);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };

  if (u.pathname === '/health') {
    return json(200, { ok: 1, version: VERSION, mode: 'hub-only', hub: HUB, keys: Object.fromEntries(SPACES.map((s) => [s, !!KEYS[s]])), used: USED, up: Math.floor(process.uptime()) });
  }
  if (u.pathname !== '/find') return json(404, { err: 'route?' });

  const space = spaceOf(u);
  const t0 = Date.now();
  USED[space] = (USED[space] || 0) + 1;

  const body = await raceHubDirect(space, upstreamUrl(u)); // v1.2.0: hub+direct raced — first answer wins
  if (body) {
    console.log(`[bridge] ${space} hub ✓ ${Date.now() - t0}ms`);
    return json(200, JSON.parse(body));
  }
  return json(200, { streams: [], err: 'twr-bridge: hub proxy empty', el: Date.now() - t0 });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[twr-bridge] ${VERSION} on :${PORT} | hub=${HUB} | mode=hub-only | keys: ${SPACES.map((s) => `${s}=${KEYS[s] ? '✓' : '✗'}`).join(' ')}`);
});
