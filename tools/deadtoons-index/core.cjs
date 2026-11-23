'use strict';
// DeadToons-only generated-data contracts. No provider/player/media requests.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const SHARDS = 16, DATA_BRANCH = 'deadtoons-index', DAY = 86400000;
const validSlug = s => typeof s === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(s) && s.length <= 500;
const hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
const shard = (slug, n = SHARDS) => hash(slug) % n;
const owner = (slug, slices, n = SHARDS) => shard(slug, n) % slices;
const filename = n => 's' + String(n).padStart(2, '0') + '.json';
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const json = x => JSON.stringify(x) + '\n';
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function write(file, value) {
 fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.tmp';
 fs.writeFileSync(temp, json(value)); fs.renameSync(temp, file);
}
function row(r) {
 if (!Array.isArray(r) || r.length !== 5) return null;
 const [s, e, h, q] = r.map(Number), id = String(r[4] || '');
 if (![s, e, q].every(Number.isFinite) || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 0 || ![0, 1].includes(h) || !id || id.length > 2048) return null;
 if (/^https?:/i.test(id)) {
  let u; try { u = new URL(id); } catch { return null; }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !(h === 0 ? /^(?:www\.)?pixeldrain\.(?:com|dev)$/i : /^(?:[a-z0-9-]+\.)?hubcloud\.[a-z]+$/i).test(u.hostname)) return null;
 } else if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
 return [s, e, h, Math.max(0, q), id];
}
function normalize(input) {
 const out = {};
 for (const slug of Object.keys(input || {}).sort()) {
  if (!validSlug(slug) || !Array.isArray(input[slug])) continue;
  const seen = new Set(), rr = [];
  for (const raw of input[slug]) { const r = row(raw); if (!r) continue; const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); rr.push(r); } }
  rr.sort((a, b) => a[0] - b[0] || a[1] - b[1] || b[2] - a[2] || b[3] - a[3] || a[4].localeCompare(b[4]));
  if (rr.length) out[slug] = rr;
 }
 return out;
}
function split(input, n = SHARDS) {
 const out = Array.from({ length: n }, () => ({}));
 for (const [slug, rr] of Object.entries(normalize(input))) out[shard(slug, n)][slug] = rr;
 return out;
}
function load(root, n = SHARDS, { strict = false } = {}) {
 const out = {};
 for (let i = 0; i < n; i++) {
  const file = path.join(root, 'dti', filename(i)); let data;
  if (strict) {
   const raw = fs.readFileSync(file, 'utf8'); data = JSON.parse(raw);
   if (json(normalize(data)) !== raw) throw Error('Noncanonical data shard: ' + filename(i));
   for (const slug of Object.keys(data)) if (shard(slug, n) !== i) throw Error('Wrong shard ownership: ' + slug);
  } else data = read(file, {});
  Object.assign(out, data);
 }
 return normalize(out);
}
const unitKey = u => [u.slug, Number(u.s) || 0, Number(u.e) || 0].join('|');
function units(cat) {
 const out = [], seen = new Set();
 for (const c of Array.isArray(cat?.shows) ? cat.shows : []) {
  if (!validSlug(c?.slug)) continue;
  if (Array.isArray(c.seasons) && c.seasons.length) {
   for (const se of c.seasons) {
    const s = Number(se.s); if (!Number.isInteger(s) || s < 0) continue;
    // v4 catalogs enumerate real upstream episode IDs, not 1..episode_count.
    // Optional counts-only fixtures/older catalogs remain readable but are
    // never produced as a complete inventory by the automatic catalog builder.
    const eps = Array.isArray(se.episodes) ? se.episodes : Array.from({ length: Math.max(0, Math.min(10000, Number(se.n) || 0)) }, (_, i) => i + 1);
    const offset = Number.isInteger(se.episodeOffset) && se.episodeOffset >= 0 ? se.episodeOffset : 0;
    for (const raw of eps) {
     const sourceEpisode = Number(raw), e = sourceEpisode - offset;
     if (!Number.isInteger(sourceEpisode) || !Number.isInteger(e) || e < 1) continue;
     const u = { slug: c.slug, s, e, sourceEpisode }, k = unitKey(u);
     if (!seen.has(k)) { seen.add(k); out.push(u); }
    }
   }
  } else if (c.complete !== false && c.root !== false) {
   const u = { slug: c.slug, s: 0, e: 0 }, k = unitKey(u); if (!seen.has(k)) { seen.add(k); out.push(u); }
  }
 }
 return out;
}
function hosts(rows, u) { return new Set((rows[u.slug] || []).filter(r => r[0] === u.s && r[1] === u.e).map(r => r[2])); }
function metrics(input, cat, want = 2) {
 const rows = normalize(input), all = units(cat), present = new Map(); let n = 0;
 for (const [slug, rr] of Object.entries(rows)) for (const r of rr) {
  n++; const k = unitKey({ slug, s: r[0], e: r[1] }); if (!present.has(k)) present.set(k, new Set()); present.get(k).add(r[2]);
 }
 const covered = all.filter(u => present.has(unitKey(u))).length, done = all.filter(u => (present.get(unitKey(u))?.size || 0) >= want).length;
 return { n, units: { done, covered, total: cat?.complete === true ? all.length : null, known: all.length, indexed: present.size, want }, hosts: { hubcloud: Object.values(rows).flat().filter(r => r[2] === 1).length, pixeldrain: Object.values(rows).flat().filter(r => r[2] === 0).length }, slugs: Object.keys(rows).sort() };
}
function titles(rows, cat) {
 const indexed = new Set(Object.keys(rows));
 return (cat?.shows || []).filter(c => indexed.has(c.slug) && typeof c.name === 'string' && c.name.trim()).map(c => ({ slug: c.slug, name: c.name.trim().slice(0, 500), type: c.type === 'movie' ? 'movie' : 'tv', year: Number(c.year) || 0 })).sort((a, b) => a.slug.localeCompare(b.slug));
}
const generation = (files, titleRows) => digest(json({ files, titles: titleRows }));
function manifest(input, cat, { now = Date.now(), want = 2, ref = '', run = {} } = {}) {
 const rows = normalize(input), files = {};
 split(rows).forEach((p, i) => { files[filename(i)] = digest(json(p)); }); const titleRows = titles(rows, cat);
 // Status-only retries do not invalidate DT cards; changed rows/title identity do.
 return { ver: 4, ts: now, generation: generation(files, titleRows), ref, shards: SHARDS, files, titles: titleRows, ...metrics(rows, cat, want), catalog: { complete: !!cat?.complete, at: cat?.at || 0, shows: cat?.shows?.length || 0 }, run };
}
function plan(rows, cat, state, { now = Date.now(), slice = 0, slices = 1, want = 2, refreshMs = DAY, missingMs = 6 * 3600000 } = {}) {
 return units(cat).filter(u => owner(u.slug, slices) === slice).map(u => {
  const key = unitKey(u), st = state[key] || {}, have = hosts(rows, u), missing = have.size < want, checked = Number(st.checkedAt) || 0;
  const due = Number(st.nextAt) || (checked ? checked + (missing ? missingMs : refreshMs) : 0);
  return { ...u, key, checked, missing, due, attempt: Number(st.attemptAt) || 0, priority: have.size === 0 ? 0 : missing ? 1 : 2 };
 }).filter(u => u.due <= now).sort((a, b) => a.attempt - b.attempt || a.priority - b.priority || a.checked - b.checked || a.key.localeCompare(b.key));
}
function mergeResults(base, results, slices = 4) {
 if (!Number.isInteger(slices) || slices < 1 || slices > SHARDS) throw Error('Invalid slice count');
 const out = { ...base }, seen = new Set();
 for (const r of results) {
  if (!r || !Number.isInteger(r.slice) || r.slice < 0 || r.slice >= slices || r.slices !== slices || seen.has(r.slice) || !r.rows || typeof r.rows !== 'object' || Array.isArray(r.rows)) throw Error('Invalid/duplicate slice result');
  seen.add(r.slice);
  if (json(normalize(r.rows)) !== json(r.rows)) throw Error('Noncanonical slice rows');
  for (const [slug, rr] of Object.entries(r.rows)) { if (owner(slug, slices) !== r.slice) throw Error('Foreign shard owner: ' + slug); out[slug] = [...(out[slug] || []), ...rr]; }
 }
 if (seen.size !== slices) throw Error('Missing slice artifact'); return normalize(out);
}
module.exports = { SHARDS, DATA_BRANCH, DAY, validSlug, hash, shard, owner, filename, digest, json, read, write, row, normalize, split, load, unitKey, units, hosts, metrics, titles, generation, manifest, plan, mergeResults };
