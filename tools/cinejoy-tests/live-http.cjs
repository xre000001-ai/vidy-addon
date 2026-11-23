'use strict';
// Optional live acceptance check; not part of the deterministic *.test.cjs suite.
// This Node-only localhost default is never used by browser-facing addon code.
const fs = require('node:fs'), path = require('node:path');
const BASE = (process.env.CJ_ADDON_BASE || 'http://127.0.0.1:7050').replace(/\/$/, '');
const DIR = path.resolve(process.env.CJ_TEST_OUTPUT || 'cinejoy-data/http-test-evidence');
const SERVERS = ['Light', 'Nebula', 'Sirius', 'Polaris'];
const cfg = Object.fromEntries(['v','nx','tw','rt','mm','m4u','sky','hm','hd','bf','vsp','ott','az','mlb','mls','dt','nex'].map(k => [k, 0]));
Object.assign(cfg, { cj: 1, cjq: [1080], sub: 0 });
const routes = [
  ['movie-tmdb', '/stream/movie/tmdb27205.json'],
  ['tv-tmdb', '/stream/series/tmdb1396:1:1.json'],
  ['movie-imdb', '/stream/movie/tt1375666.json'],
  ['tv-imdb', '/stream/series/tt0903747:1:1.json'],
  ['tv-imdb-default', '/stream/series/tt0903747.json']
];
async function request(config, route) {
  const url = BASE + '/cfg/' + Buffer.from(JSON.stringify(config)).toString('base64url') + route;
  const began = Date.now(), response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return { status: response.status, ms: Date.now() - began, body: await response.json() };
}
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const healthBefore = await (await fetch(BASE + '/_cinejoy')).json(), rows = [];
  for (const [name, route] of routes) {
    let row;
    try {
      const r = await request(cfg, route), streams = r.body.streams || [], servers = streams.map(c => String(c.bingeGroup || '').split('|')[1]);
      row = { name, status: r.status, ms: r.ms, total: streams.length, servers,
        success: r.status === 200 && streams.length === 4 && SERVERS.every(s => servers.includes(s)) && streams.every(c => c.bingeGroup.startsWith('cj|') && c.name === '▥ 1080 ▥') };
      const health = await (await fetch(BASE + '/_cinejoy')).json();
      // Raw files contain expiring signed URLs. Keep local; do not publish them as ready proofs.
      fs.writeFileSync(path.join(DIR, name + '.json'), JSON.stringify({ ...row, streams, events: health.events }, null, 2));
    } catch (e) { row = { name, success: false, error: e.code || e.name }; }
    rows.push(row); console.log(JSON.stringify(row));
  }
  const controls = [];
  for (const [name, extra] of [['master-off', { cj: 0 }], ['all-servers-off', { cjsrv: SERVERS.map(s => s.toLowerCase()) }]]) {
    const r = await request({ ...cfg, ...extra }, routes[0][1]);
    controls.push({ name, status: r.status, ms: r.ms, total: r.body.streams?.length || 0, success: r.status === 200 && Array.isArray(r.body.streams) && r.body.streams.length === 0 });
  }
  const healthAfter = await (await fetch(BASE + '/_cinejoy')).json();
  const result = { mode: 'All four CineJoy servers in each actual addon route; live upstream and own proof TTL, not fixtures', rows, controls, healthBefore, healthAfter };
  fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(result, null, 2));
  if (rows.some(r => !r.success) || controls.some(r => !r.success)) process.exitCode = 1;
  return result;
}
module.exports = { main };
if (require.main === module) main().catch(e => { console.error(e.code || e.name); process.exitCode = 1; });
