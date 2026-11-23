'use strict';
const C = require('./core.cjs'), { UpstreamError } = require('./network.cjs');
const backoff = failures => Math.min(C.DAY, 15 * 60000 * 2 ** Math.min(7, Math.max(0, failures - 1)));
const errorInfo = e => ({ status: e.status || 0, message: String(e.message || e).slice(0, 140) });
async function catalog(client, previous = {}, { now = Date.now, concurrency = 4, maxPages = 200, ttl = 45 * 60000 } = {}) {
 if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Invalid catalog concurrency');
 const prior = new Map((previous.shows || []).map(s => [s.slug, s])), listed = new Map(), counts = new Set();
 let listComplete = false, errors = 0, metadataRequests = 0, seasonRequests = 0;
 for (let page = 1; page <= maxPages; page++) {
  if (client.left() < 20000) { errors++; break; }
  let j; try { j = await client.request('/anime?page=' + page + '&limit=50'); } catch { errors++; break; }
  if (!Array.isArray(j?.data)) { errors++; break; }
  if (Number.isInteger(j.count) && j.count >= 0) counts.add(j.count);
  if (!j.data.length) { listComplete = true; break; }
  let added = 0;
  for (const x of j.data) if (C.validSlug(x?.slug) && !listed.has(x.slug)) { listed.set(x.slug, x); added++; }
  if (!added) { errors++; break; }
  if (j.data.length < 50) { listComplete = true; break; }
 }
 if (counts.size > 1 || counts.size && !counts.has(listed.size)) { errors++; listComplete = false; }
 const shows = new Map(), showQueue = [], seasonQueue = [], queuedSeasons = new Set(), inflightSeasons = new Set(); let turn = false;
 for (const a of listed.values()) {
  const old = prior.get(a.slug);
  const show = old ? structuredClone(old) : { slug: a.slug, type: a.type || 'tv', name: a.anime_name || a.slug, seasons: [], root: false, complete: false, metaComplete: false, checkedAt: 0 };
  shows.set(a.slug, show);
  if (!(show.metaComplete !== false && show.checkedAt > 0 && now() - show.checkedAt < ttl) && !(show.nextAt > now())) showQueue.push(a.slug);
 }
 if (!listComplete) for (const old of prior.values()) if (!shows.has(old.slug)) shows.set(old.slug, structuredClone(old));
 function enqueueSeasons(show) {
  for (const se of show.seasons || []) {
   if (!se.n) { se.episodes = []; se.complete = true; continue; }
   const key = show.slug + '|' + se.s;
   if (queuedSeasons.has(key) || inflightSeasons.has(key) || se.nextAt > now() || se.complete === true && Array.isArray(se.episodes) && se.checkedAt > 0 && now() - se.checkedAt < ttl) continue;
   queuedSeasons.add(key); seasonQueue.push({ slug: show.slug, s: se.s, key });
  }
 }
 for (const show of shows.values()) enqueueSeasons(show);
 const attempt = x => x?.attemptAt || x?.checkedAt || 0;
 function take() {
  turn = !turn;
  if (showQueue.length && (!seasonQueue.length || turn)) {
   showQueue.sort((a, b) => attempt(shows.get(a)) - attempt(shows.get(b)) || a.localeCompare(b)); return { kind: 'show', slug: showQueue.shift() };
  }
  if (seasonQueue.length) {
   const state = x => shows.get(x.slug)?.seasons?.find(se => se.s === x.s);
   seasonQueue.sort((a, b) => attempt(state(a)) - attempt(state(b)) || a.key.localeCompare(b.key));
   const task = seasonQueue.shift(); queuedSeasons.delete(task.key); return { kind: 'season', ...task };
  }
  return null;
 }
 await Promise.all(Array.from({ length: concurrency }, async () => {
  while (client.left() >= 20000) {
   const task = take(); if (!task) return; const show = shows.get(task.slug);
   if (task.kind === 'show') {
    show.attemptAt = now(); metadataRequests++;
    try {
     const a = listed.get(task.slug) || {}, j = await client.request('/anime/' + encodeURIComponent(task.slug));
     if (!j || !Array.isArray(j.seasons) || j.links != null && !Array.isArray(j.links)) throw Error('Invalid show metadata');
     const oldSeasons = new Map((show.seasons || []).map(s => [s.s, s])), seasons = [], seasonNumbers = new Set();
     for (const raw of j.seasons) {
      const s = Number(raw.season_number), n = Number(raw.episode_count);
      if (!Number.isInteger(s) || s < 0 || !Number.isInteger(n) || n < 0 || n > 10000 || seasonNumbers.has(s)) throw Error('Invalid/duplicate season inventory');
      seasonNumbers.add(s); const old = oldSeasons.get(s), same = old?.n === n;
      seasons.push({ ...(old || {}), s, n, status: String(raw.status || ''), episodes: old?.episodes || [], complete: same && old?.complete === true, ...(same ? {} : { nextAt: 0, episodeOffset: 0 }) });
     }
     Object.assign(show, { type: j.type || a.type || show.type || 'tv', name: j.anime_name || a.anime_name || show.name || task.slug, year: parseInt(j.release_date, 10) || 0, seasons, root: (j.links || []).length > 0 || (j.type || a.type) === 'movie', checkedAt: now(), metaComplete: true, failures: 0, nextAt: now() + ttl });
     delete show.lastError; enqueueSeasons(show);
    } catch (e) {
     errors++; show.failures = (show.failures || 0) + 1; show.nextAt = Math.max(now() + backoff(show.failures), e.retryAt || 0); show.lastError = errorInfo(e);
    }
   } else {
    let se = show.seasons.find(s => s.s === task.s); if (!se || !se.n) continue;
    const sourceCount = se.n; inflightSeasons.add(task.key); se.attemptAt = now(); seasonRequests++;
    try {
     const j = await client.request('/anime/' + encodeURIComponent(task.slug) + '/season/' + task.s);
     se = show.seasons.find(s => s.s === task.s);
     if (!se || se.n !== sourceCount) continue;
     if (!j || !Array.isArray(j.episodes)) throw Error('Missing explicit episode inventory');
     const episodes = [...new Set(j.episodes.map(e => Number(e.episode_number)))].sort((a, b) => a - b);
     if (episodes.some(e => !Number.isInteger(e) || e < 1)) throw Error('Invalid episode inventory');
     // Keep the real IDs even for a temporarily incomplete inventory. Never
     // fabricate 1..count or infer missing episode links from a timeout/404.
     Object.assign(se, { episodes, checkedAt: now(), complete: episodes.length === se.n, failures: 0, nextAt: now() + ttl });
     if (!se.complete) { errors++; se.nextAt = now() + 15 * 60000; se.lastError = { status: 0, message: 'Episode inventory/count mismatch' }; } else delete se.lastError;
    } catch (e) {
     errors++; se = show.seasons.find(s => s.s === task.s);
     if (se) { se.complete = false; se.failures = (se.failures || 0) + 1; se.nextAt = Math.max(now() + backoff(se.failures), e.retryAt || 0); se.lastError = errorInfo(e); }
    } finally { inflightSeasons.delete(task.key); enqueueSeasons(show); }
   }
  }
 }));
 for (const show of shows.values()) {
  // Only prove a season-relative offset for a full, contiguous, absolute-number
  // inventory following every earlier numbered season. Gaps are not guessed.
  let count = 0, contiguous = true, lastSeason = 0;
  for (const se of [...(show.seasons || [])].sort((a, b) => a.s - b.s)) {
   se.episodeOffset = 0; if (se.s === 0) continue;
   if (se.s !== lastSeason + 1) contiguous = false;
   if (contiguous && se.complete && se.episodes.length === se.n && se.episodes.every((e, i) => e === count + i + 1)) se.episodeOffset = count;
   if (!se.complete) contiguous = false;
   count += se.n; lastSeason = se.s;
  }
  show.complete = show.metaComplete === true && !show.lastError && (show.seasons || []).every(se => se.complete === true && !se.lastError);
 }
 const values = [...shows.values()].sort((a, b) => a.slug.localeCompare(b.slug)), pending = values.filter(s => !s.complete).length;
 return { ver: 4, at: now(), complete: listComplete && errors === 0 && pending === 0, shows: values, stats: { listed: listed.size, declared: counts.size === 1 ? [...counts][0] : null, errors, pending, listComplete, metadataRequests, seasonRequests, queued: showQueue.length + seasonQueue.length } };
}
const quality = q => /\b4k\b/i.test(q) ? 2160 : Number((String(q || '').match(/(\d{3,4})\s*p/i) || [])[1] || 0);
function candidates(links) {
 const byHost = new Map();
 for (const l of Array.isArray(links) ? links : []) for (const s of Array.isArray(l?.servers) ? l.servers : []) {
  if (!s?.link_server_id || !/pixeldrain|hubcloud/i.test(s.name || '')) continue;
  const h = /pixeldrain/i.test(s.name) ? 0 : 1, q = quality(l.quality), old = byHost.get(h);
  if (!old || q > old.q) byHost.set(h, { h, q, id: String(s.link_server_id) });
 }
 return [...byHost.values()].sort((a, b) => b.h - a.h);
}
function fromURL(url, u, q) {
 let x; try { x = new URL(url); } catch { return null; }
 let h = -1, id = '';
 if (/^(?:www\.)?pixeldrain\.(?:com|dev)$/i.test(x.hostname)) { h = 0; id = (x.pathname.match(/^\/(?:u|api\/file)\/([A-Za-z0-9_-]+)/) || [])[1] || ''; }
 if (/^(?:[a-z0-9-]+\.)?hubcloud\.[a-z]+$/i.test(x.hostname)) { h = 1; id = (x.pathname.match(/^\/drive\/([A-Za-z0-9_-]+)/) || [])[1] || ''; }
 if (h < 0 || !id || x.username || x.password || !['http:', 'https:'].includes(x.protocol)) return null;
 const canonical = h === 0 && x.hostname === 'pixeldrain.com' && /^\/u\/[A-Za-z0-9_-]+\/?$/.test(x.pathname) || h === 1 && x.hostname === 'hubcloud.pw' && /^\/drive\/[A-Za-z0-9_-]+\/?$/.test(x.pathname);
 if (x.search || x.hash || !canonical || x.protocol !== 'https:') id = x.href;
 return C.row([u.s, u.e, h, q, id]);
}
async function slice(client, rows, cat, state = {}, { slice = 0, slices = 4, want = 2, concurrency = 6, now = Date.now, onCheckpoint = () => {} } = {}) {
 if (!Number.isInteger(slice) || !Number.isInteger(slices) || slice < 0 || slice >= slices || slices > 16 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Invalid slice/concurrency');
 rows = C.normalize(rows); const own = {}, states = {};
 for (const [slug, rr] of Object.entries(rows)) if (C.owner(slug, slices) === slice) own[slug] = rr;
 for (const [k, v] of Object.entries(state)) if (C.owner(k.split('|')[0], slices) === slice) states[k] = structuredClone(v);
 const todo = C.plan(rows, cat, states, { now: now(), slice, slices, want });
 const stats = { queued: todo.length, attempted: 0, metadataOK: 0, added: 0, errors: 0, unchanged: 0 }; let qi = 0;
 const output = () => ({ ver: 4, slice, slices, rows: C.normalize(own), state: states, stats: { ...stats, remaining: Math.max(0, todo.length - stats.attempted) }, network: { ...client.stats } });
 await Promise.all(Array.from({ length: concurrency }, async () => {
  for (;;) {
   if (client.left() < 75000) return; const u = todo[qi++]; if (!u) return;
   const old = states[u.key] || {}, st = { ...old, hosts: { ...(old.hosts || {}) }, attemptAt: now() }; states[u.key] = st; stats.attempted++;
   try {
    const p = u.e > 0 ? '/anime/' + encodeURIComponent(u.slug) + '/season/' + u.s + '/episode/' + (u.sourceEpisode || u.e) : '/anime/' + encodeURIComponent(u.slug);
    const detail = await client.request(p);
    if (!detail || detail.links != null && !Array.isArray(detail.links) || detail.links === undefined) throw new UpstreamError('Invalid unit metadata');
    stats.metadataOK++; const cands = candidates(detail.links || []); let failed = false, gateErrors = 0, retryAt = 0;
    st.sourceEpisode = u.sourceEpisode || 0;
    for (const h of [0, 1]) if (!cands.some(c => c.h === h)) st.hosts[h] = { ...(st.hosts[h] || {}), available: false, checkedAt: now() };
    for (const c of cands) {
     const cached = st.hosts[c.h] || {}, host = { ...cached, linkId: c.id, checkedAt: now(), available: true }; st.hosts[c.h] = host;
     if (cached.linkId !== c.id) { delete host.row; delete host.unlockedAt; delete host.nextAt; delete host.lastError; host.failures = 0; }
     const validCached = cached.linkId === c.id && now() - (cached.unlockedAt || 0) < 7 * C.DAY && C.row(cached.row) && cached.row[0] === u.s && cached.row[1] === u.e;
     if (validCached) {
      const r = [...cached.row]; r[3] = c.q; if (!own[u.slug]) own[u.slug] = []; own[u.slug].push(r); host.row = r; stats.unchanged++; continue;
     }
     if (cached.linkId === c.id && cached.nextAt > now()) { failed = true; retryAt = Math.max(retryAt, cached.nextAt); continue; }
     if (client.left() < 75000) { failed = true; break; }
     host.attemptAt = now();
     try {
      const url = await client.unlock(c.id), r = fromURL(url, u, c.q);
      if (!r) throw new UpstreamError('Unsupported advertised final host');
      if (!own[u.slug]) own[u.slug] = []; own[u.slug].push(r); Object.assign(host, { row: r, unlockedAt: now(), failures: 0, nextAt: now() + 7 * C.DAY }); delete host.lastError; stats.added++;
     } catch (e) {
      failed = true; gateErrors++; host.failures = (cached.linkId === c.id ? cached.failures || 0 : 0) + 1; host.nextAt = Math.max(now() + backoff(host.failures), e.retryAt || 0); host.lastError = errorInfo(e); retryAt = Math.max(retryAt, host.nextAt); st.lastError = host.lastError;
     }
    }
    st.checkedAt = now(); st.failures = failed ? (old.failures || 0) + 1 : 0;
    st.nextAt = failed ? Math.max(now() + backoff(st.failures), retryAt) : now() + (cands.length < want || C.hosts(own, u).size < want ? 6 * 3600000 : C.DAY);
    st.status = failed ? 'partial-retry' : cands.length ? 'checked' : 'no-supported-host';
    st.noSupportedHost = cands.length === 0; if (st.noSupportedHost) st.lastNoHostAt = now(); if (!failed) delete st.lastError; stats.errors += gateErrors;
   } catch (e) {
    stats.errors++; st.status = 'transient-retry'; delete st.noSupportedHost; st.failures = (old.failures || 0) + 1; st.nextAt = Math.max(now() + backoff(st.failures), e.retryAt || 0); st.lastError = errorInfo(e);
    // Request failure is not a confirmed empty unit; retain all successful rows.
   }
   onCheckpoint(output());
  }
 }));
 return output();
}
module.exports = { catalog, quality, candidates, fromURL, slice };
