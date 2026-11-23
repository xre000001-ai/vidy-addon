#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const C = require('./core.cjs'), B = require('./build.cjs'), N = require('./network.cjs');
const args = process.argv.slice(2), command = args.shift(), arg = (k, d) => { const x = args.find(a => a.startsWith('--' + k + '=')); return x ? x.slice(k.length + 3) : d; };
const number = (k, d, min, max) => { const n = Number(arg(k, process.env['DT_' + k.toUpperCase()] || d)); if (!Number.isInteger(n) || n < min || n > max) throw Error('Invalid ' + k); return n; };
const data = path.resolve(arg('data', '.dt-data')), out = path.resolve(arg('out', '.dt-output')), plan = path.resolve(arg('plan', '.dt-plan'));
const head = dir => cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
function states(dir) {
 const out = {};
 for (let i = 0; i < C.SHARDS; i++) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'state', C.filename(i)), 'utf8'));
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw Error('Invalid state shard');
  for (const [key, state] of Object.entries(j)) {
   const [slug, s, e, extra] = key.split('|');
   if (!C.validSlug(slug) || extra !== undefined || !/^\d+$/.test(s || '') || !/^\d+$/.test(e || '') || C.shard(slug) !== i || !state || typeof state !== 'object' || Array.isArray(state)) throw Error('Invalid state/owner: ' + key);
   out[key] = state;
  }
 }
 return out;
}
function materialize(dir, rows, cat, state, status) {
 C.split(rows).forEach((r, i) => C.write(path.join(dir, 'dti', C.filename(i)), r));
 for (let i = 0; i < C.SHARDS; i++) {
  const mine = {}; for (const key of Object.keys(state).sort()) if (C.shard(key.split('|')[0]) === i) mine[key] = state[key];
  C.write(path.join(dir, 'state', C.filename(i)), mine);
 }
 C.write(path.join(dir, 'catalog.json'), cat); C.write(path.join(dir, 'status.json'), status);
 C.write(path.join(dir, 'dti/manifest.json'), C.manifest(rows, cat, { want: 2, run: status }));
}
function prepared() {
 const cat = C.read(path.join(plan, 'catalog.json'), null), base = C.read(path.join(plan, 'base.json'), null);
 if (cat?.ver !== 4 || !Array.isArray(cat.shows) || !/^[a-f0-9]{40}$/.test(base?.commit || '')) throw Error('Missing/invalid preparation artifacts');
 if (head(data) !== base.commit) throw Error('Data checkout differs from shared preparation');
 return { cat, base, catalogDigest: C.digest(C.json(cat)) };
}
async function main() {
 if (command === 'seed') {
  const rows = C.load(data), cat = { ver: 4, at: 0, complete: false, shows: [], stats: { seedOnly: true } };
  materialize(out, rows, cat, {}, { kind: 'bootstrap-existing-index', sourceCommit: arg('source', ''), upstreamRequested: false, mediaVerified: false });
  console.log(JSON.stringify(C.metrics(rows, cat, 2))); return;
 }
 if (command === 'catalog') {
  C.load(data, C.SHARDS, { strict: true }); states(data);
  const base = head(data), budget = number('budget', 780, 60, 1200), controller = new AbortController(), timer = setTimeout(() => controller.abort(), budget * 1000); timer.unref();
  const client = N.create({ deadline: Date.now() + budget * 1000, signal: controller.signal });
  try {
   const cat = await B.catalog(client, C.read(path.join(data, 'catalog.json'), {})); C.write(path.join(out, 'catalog.json'), cat);
   C.write(path.join(out, 'base.json'), { commit: base, code: process.env.GITHUB_SHA || '', catalogStats: cat.stats });
   console.log(JSON.stringify({ catalogComplete: cat.complete, shows: cat.shows.length, stats: cat.stats, network: client.stats }));
   if (!cat.shows.length) throw Error('No catalog available; refusing empty rebuild');
  } finally { clearTimeout(timer); controller.abort(); } return;
 }
 if (command === 'slice') {
  const { cat, base, catalogDigest } = prepared();
  const budget = number('budget', 2100, 90, 2400), slice = number('slice', 0, 0, 15), slices = number('slices', 4, 1, 16), want = number('want', 2, 1, 2), concurrency = number('concurrency', 6, 1, 8);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), budget * 1000); timer.unref();
  const client = N.create({ deadline: Date.now() + budget * 1000, signal: controller.signal }); let last = 0;
  const save = r => C.write(path.join(out, 'result.json'), { ...r, base: base.commit, catalogDigest, code: process.env.GITHUB_SHA || base.code });
  try {
   const result = await B.slice(client, C.load(data, C.SHARDS, { strict: true }), cat, states(data), { slice, slices, want, concurrency, onCheckpoint: r => { if (Date.now() - last > 30000) { save(r); last = Date.now(); } } });
   save(result); console.log(JSON.stringify({ slice, slices, stats: result.stats, network: result.network }));
  } finally { clearTimeout(timer); controller.abort(); } return;
 }
 if (command === 'merge') {
  const { cat, base, catalogDigest } = prepared(), slices = number('slices', 4, 1, 16), dir = path.resolve(arg('results', '.dt-results')), results = [];
  for (let i = 0; i < slices; i++) {
   const r = C.read(path.join(dir, 'dt-slice-' + i, 'result.json'), null);
   if (!r || r.ver !== 4 || r.slice !== i || r.base !== base.commit || r.catalogDigest !== catalogDigest || r.code !== (process.env.GITHUB_SHA || base.code)) throw Error('Missing/foreign result slice ' + i);
   results.push(r);
  }
  const rows = C.mergeResults(C.load(data, C.SHARDS, { strict: true }), results, slices), state = states(data);
  for (const r of results) for (const [k, v] of Object.entries(r.state || {})) { if (C.owner(k.split('|')[0], slices) !== r.slice) throw Error('Foreign state owner'); state[k] = v; }
  const status = { kind: 'automatic-incremental', code: process.env.GITHUB_SHA || base.code, runId: process.env.GITHUB_RUN_ID || '', base: base.commit, at: Date.now(), catalogComplete: cat.complete, catalogStats: cat.stats, slices: results.map(r => ({ slice: r.slice, stats: r.stats, network: r.network })), mediaVerified: false };
  materialize(out, rows, cat, state, status); C.write(path.join(out, 'base.json'), base); console.log(JSON.stringify({ metrics: C.metrics(rows, cat, 2), status })); return;
 }
 if (command === 'publish') {
  const result = await require('./publish.cjs').publish({ repo: data, source: out, expected: arg('expected', C.read(path.join(out, 'base.json'), {}).commit || ''), push: arg('push', '0') === '1' });
  C.write(path.join(out, 'publication.json'), result);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## DeadToons validated publication\n\nData commit: `' + result.commit + '`\n\nSupported unique links: **' + result.n + '**. Units with both hosts: **' + result.units.done + '/' + (result.units.total ?? 'unknown (catalog incomplete)') + '**; known catalog units: ' + result.units.known + '.\n\nThis is incremental background indexing, not full-site/playback certification. Inspect `status.json` on the data branch for pending/error/backoff counters.\n');
  return;
 }
 throw Error('Use catalog, slice, merge, seed or publish. The unsafe direct-main publisher has been retired.');
}
if (require.main === module) main().catch(e => { console.error('[deadtoons-index] ' + String(e.message || e).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')); process.exitCode = 1; });
module.exports = { materialize, states, prepared, main };
