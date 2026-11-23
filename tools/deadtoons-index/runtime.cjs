'use strict';
// Index reads only. Never contacts Deadbase, gate/unlock, player or media URLs.
const C = require('./core.cjs');
const titleKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const linkKey = (h, id) => 'dti:' + Number(h) + ':' + String(id);
function immutable(base, ref, file) {
 const u = new URL(base.replace(/\/$/, '') + '/');
 if (u.hostname === 'raw.githubusercontent.com') {
  const p = u.pathname.split('/').filter(Boolean); if (p.length < 4) throw Error('Invalid raw index base'); u.pathname = '/' + p[0] + '/' + p[1] + '/' + ref + '/dti/' + file;
 } else if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/gh/')) {
  const before = u.pathname; u.pathname = before.replace(/^(\/gh\/[^/]+\/[^/@]+)@[^/]+\/dti\/$/, '$1@' + ref + '/dti/');
  if (u.pathname === before) throw Error('Invalid CDN index base'); u.pathname += file;
 } else { u.pathname += file; u.searchParams.set('generation', ref); }
 return u.href;
}
async function text(response, max) {
 if (response.body?.getReader) {
  const reader = response.body.getReader(), pieces = []; let size = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > max) throw Error('Oversized index response'); pieces.push(Buffer.from(r.value)); } return Buffer.concat(pieces).toString('utf8'); }
  finally { await reader.cancel().catch(() => {}); }
 }
 const s = await response.text(); if (Buffer.byteLength(s) > max) throw Error('Oversized index response'); return s;
}
function create({ seedDir, mirrors, fetch: fetcher = fetch, clock = Date.now, state = {}, shardState = {}, cache = new Map(), timeout = 12000 } = {}) {
 let active = null, closed = false, currentFiles = {}, man = null, aliases = new Map(); const controllers = new Set();
 Object.assign(state, { on: true, n: 0, ts: 0, at: 0, err: '', src: 'none', generation: '', legacy: { n: 0, ts: 0, at: 0, err: '' } });
 Object.assign(shardState, { on: false, shards: C.SHARDS, man: null, at: 0, err: '', loaded: 0, hits: 0, miss: 0, pre: 0, src: 'none' });
 function adopt(next, pieces, src) {
  const nextAliases = new Map(), titles = new Map((next.titles || []).map(x => [x.slug, x]));
  const add = (key, entry) => { if (!key) return; if (!nextAliases.has(key)) nextAliases.set(key, new Map()); nextAliases.get(key).set(entry.slug, entry); };
  for (const piece of pieces) for (const [slug, rr] of Object.entries(piece)) {
   const entry = titles.get(slug) || { slug, name: slug, type: rr.some(r => r[0] || r[1]) ? 'tv' : 'movie', year: 0 };
   add(titleKey(slug), entry); add(titleKey(entry.name), entry);
  }
  // One synchronous commit: readers see either the whole prior generation or
  // the whole validated new one, including exact title aliases and counters.
  cache.clear(); pieces.forEach((r, i) => cache.set(i, new Map(Object.entries(r)))); aliases = nextAliases; currentFiles = { ...next.files }; man = next;
  Object.assign(state, { n: next.n, ts: next.ts || 0, at: clock(), err: '', src, generation: next.generation, units: next.units, catalog: next.catalog, ref: next.ref || '' });
  Object.assign(shardState, { on: true, shards: next.shards, man: next, at: clock(), err: '', pre: pieces.length, src });
 }
 try {
  const rows = C.load(seedDir), seed = C.manifest(rows, { complete: false, shows: [] }, { now: 0 });
  if (seed.n) adopt(seed, C.split(rows), 'bundled');
 } catch (e) { state.err = 'bundled: ' + String(e.message).slice(0, 100); }
 async function get(url, max) {
  if (closed) throw Error('Index closed'); const controller = new AbortController(); controllers.add(controller);
  try { const r = await fetcher(url, { headers: { 'User-Agent': 'Vidy-DeadToons-Index/4', Accept: 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]) }); if (!r.ok) throw Error('Index HTTP ' + r.status); return await text(r, max); }
  finally { controllers.delete(controller); }
 }
 function validate(j) {
  if (j?.ver !== 4 || j.shards !== C.SHARDS || !Array.isArray(j.slugs) || !Number.isInteger(j.n) || j.n < 0 || !Number.isFinite(j.ts) || j.ts < 0 || !/^[a-f0-9]{40}$/.test(j.ref || '') || !/^[a-f0-9]{64}$/.test(j.generation || '') || !Array.isArray(j.titles)) throw Error('Invalid v4 index manifest');
  if (!j.files || Object.keys(j.files).length !== C.SHARDS) throw Error('Invalid shard digest inventory');
  for (let i = 0; i < C.SHARDS; i++) if (!/^[a-f0-9]{64}$/.test(j.files[C.filename(i)] || '')) throw Error('Invalid shard digest');
  if (C.generation(j.files, j.titles) !== j.generation) throw Error('Invalid manifest generation digest');
  if (C.json([...new Set(j.slugs)].sort()) !== C.json(j.slugs) || j.slugs.some(s => !C.validSlug(s))) throw Error('Invalid slug inventory');
  const seen = new Set();
  for (const t of j.titles) { if (!t || !j.slugs.includes(t.slug) || seen.has(t.slug) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 500 || !['tv', 'movie'].includes(t.type) || !Number.isFinite(t.year)) throw Error('Invalid title alias inventory'); seen.add(t.slug); }
 }
 async function load() {
  let last;
  for (const base of [...new Set(mirrors || [])]) {
   try {
    const url = new URL(base.replace(/\/$/, '') + '/manifest.json'); url.searchParams.set('cb', String(Math.floor(clock() / 60000)));
    const j = JSON.parse(await get(url.href, 2 * 1024 * 1024)); validate(j);
    if (j.n === 0 && state.n > 0) throw Error('Refusing empty replacement of a usable index');
    if (man?.ts && j.ts < man.ts) throw Error('Refusing older generation');
    if (j.generation === state.generation) {
     if (j.n !== state.n || C.json(j.slugs) !== C.json(man.slugs)) throw Error('Manifest coverage mismatch');
     man = j; Object.assign(state, { ts: j.ts, at: clock(), err: '', src: base.includes('jsdelivr') ? 'jsdelivr' : 'raw', ref: j.ref, units: j.units, catalog: j.catalog }); Object.assign(shardState, { man: j, at: clock(), err: '', src: state.src }); return true;
    }
    const pieces = new Array(C.SHARDS); let next = 0, downloaded = 0;
    // allSettled drains all lanes even when one fails; no orphaned reads.
    const workers = await Promise.allSettled(Array.from({ length: 3 }, async () => {
     while (next < C.SHARDS) {
      const i = next++, file = C.filename(i);
      if (currentFiles[file] === j.files[file] && cache.has(i)) { pieces[i] = Object.fromEntries(cache.get(i)); continue; }
      const raw = await get(immutable(base, j.ref, file), 4 * 1024 * 1024); if (C.digest(raw) !== j.files[file]) throw Error('Shard digest mismatch: ' + file);
      const data = JSON.parse(raw); if (C.json(C.normalize(data)) !== raw) throw Error('Noncanonical shard');
      for (const slug of Object.keys(data)) if (C.shard(slug) !== i) throw Error('Wrong shard ownership'); pieces[i] = data; downloaded++;
     }
    }));
    const failure = workers.find(w => w.status === 'rejected'); if (failure) throw failure.reason;
    if (pieces.filter(Boolean).length !== C.SHARDS) throw Error('Incomplete generation');
    const actual = C.metrics(Object.assign({}, ...pieces), { shows: [] });
    if (actual.n !== j.n || C.json(actual.slugs) !== C.json(j.slugs) || C.json(actual.hosts) !== C.json(j.hosts) || actual.units.indexed !== j.units?.indexed) throw Error('Manifest coverage does not match actual shards');
    if (closed) return false; adopt(j, pieces, base.includes('jsdelivr') ? 'jsdelivr' : 'raw'); shardState.loaded += downloaded; return true;
   } catch (e) { last = e; }
  }
  const message = String(last?.message || 'No index mirrors').slice(0, 160); state.err = message; shardState.err = message; return false;
 }
 const lookup = slug => { const found = cache.get(C.shard(slug))?.get(slug); if (found) { shardState.hits++; return found; } shardState.miss++; return null; };
 return {
  refresh() { if (closed) return Promise.resolve(false); if (!active) active = load().finally(() => { active = null; }); return active; }, lookup, linkKey,
  resolve(names, { type, year, s = 0, e = 0 } = {}) {
   const candidates = new Map();
   for (const name of names || []) for (const entry of aliases.get(titleKey(name))?.values() || []) {
    if (type && entry.type !== (type === 'series' ? 'tv' : 'movie') || year && entry.year && Math.abs(year - entry.year) > 1) continue;
    const rr = cache.get(C.shard(entry.slug))?.get(entry.slug) || [];
    if (rr.some(r => type === 'series' ? r[0] === Number(s) && r[1] === Number(e) : !r[0] && !r[1])) candidates.set(entry.slug, entry);
   }
   if (candidates.size !== 1) return null; const entry = [...candidates.values()][0]; return { ...entry, rows: lookup(entry.slug) };
  },
  noteLegacy(info) { state.legacy = { ...state.legacy, ...info }; },
  get generation() { return state.generation; }, state, shardState, cache,
  async close() { closed = true; for (const c of controllers) c.abort(); if (active) await active; }
 };
}
module.exports = { create, immutable, text, titleKey, linkKey };
