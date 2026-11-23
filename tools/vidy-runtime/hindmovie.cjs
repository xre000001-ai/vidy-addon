'use strict';
// HindMovie-only overlay for the unchanged 87e0192 / v1.34.415 stable tree.
// Resolve 1080p / 2160p only. No media verification, global scheduler changes,
// child processes, pool trainer, or first-card/first-file early return.
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage, AsyncResource } = require('node:async_hooks');
const POOL_FILE = path.join(__dirname, '../../hm_proxy_pool.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const POOL = new Map(), COOKIES = new Map(), CURSOR = new Map();

function capOf(url) {
  const h = new URL(url).hostname;
  return /joshapp\./i.test(h) ? 'jp' : /mvlink\./i.test(h) ? 'pl'
    : /hshare\./i.test(h) ? 'hs' : /gdshine\./i.test(h) ? 'gd'
    : /boldb\.|hcloud\./i.test(h) ? 'bb' : 'site';
}
function poolLoad() {
  try {
    const raw = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) if (v && v.ok > 0) POOL.set(k, { ...v });
  } catch (_) {}
  return POOL.size;
}
function poolPick(n, cap) {
  const rows = [...POOL].filter(([, v]) => v.ok > 0 && Date.now() - v.ts < 7 * 86400000 && ((v.bad || {})[cap] || 0) < 3);
  rows.sort((a, b) => Number(!!(b[1].cap || {})[cap]) - Number(!!(a[1].cap || {})[cap]) || (a[1].ms || 99999) - (b[1].ms || 99999));
  const proven = rows.filter(([, v]) => (v.cap || {})[cap]);
  const best = (proven.length ? proven : rows).slice(0, 12);
  const offset = (CURSOR.get(cap) || 0) % Math.max(1, best.length);
  CURSOR.set(cap, offset + n);
  return Array.from({ length: Math.min(n, best.length) }, (_, i) => best[(offset + i) % best.length][0]);
}
function poolStats() {
  const cap = {};
  for (const v of POOL.values()) for (const k of Object.keys(v.cap || {})) cap[k] = (cap[k] || 0) + 1;
  return { total: POOL.size, cap };
}
// A gdshine JSON extraction error is a completed upstream answer, not an IP
// block. Do not throw it away and wait for two silent proxies until timeout.
function extractionError(url, status, text) {
  if (![400, 404, 409, 410, 413, 422].includes(status) || !/^https:\/\/gdshine\.org\/api\/(?:share|downloads)\//i.test(url)) return false;
  try { const j = JSON.parse(text); return j.success === false && typeof j.error === 'string' && !!j.error; } catch (_) { return false; }
}
async function request(url, ref, body, proxy, signal) {
  let agent;
  try {
    const { fetch, ProxyAgent } = require('undici');
    if (proxy) agent = new ProxyAgent(/:\/\//.test(proxy) ? proxy : 'http://' + proxy);
    for (let hop = 0; hop < 5; hop++) {
      const host = new URL(url).hostname, cookies = COOKIES.get(host) || {};
      const r = await fetch(url, {
        dispatcher: agent, signal, redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
        headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', ...(ref ? { referer: ref } : {}),
          ...(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; ') } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body })
      });
      for (const sc of r.headers.getSetCookie()) {
        const kv = sc.split(';')[0], i = kv.indexOf('=');
        if (i > 0) cookies[kv.slice(0, i)] = kv.slice(i + 1);
      }
      COOKIES.set(host, cookies);
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        url = new URL(r.headers.get('location'), url).href;
        if (r.status === 303) body = undefined;
        await r.body.cancel();
        continue;
      }
      const t = await r.text();
      if (!t || /Just a moment|_cf_chl_opt|Attention Required/i.test(t.slice(0, 1500))) return null;
      if ((r.status < 200 || r.status >= 300) && !extractionError(url, r.status, t)) return null;
      return { st: r.status, t, via: proxy || 'direct' };
    }
  } catch (_) {} finally { if (agent) agent.destroy().catch(() => {}); }
  return null;
}
function get(url, ms, ref, body, signal) {
  if (signal && signal.aborted) return Promise.resolve({ st: 0, t: '' });
  const cap = capOf(url), nodes = poolPick(2, cap), controller = new AbortController();
  return new Promise(resolve => {
    let done = false, pending = nodes.length + 1, directTimer;
    const finish = r => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(directTimer); controller.abort();
      if (signal) signal.removeEventListener('abort', cancel);
      resolve(r || { st: 0, t: '' });
    };
    const timer = setTimeout(() => finish(null), Math.max(1, ms || 4000));
    const cancel = () => finish(null);
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    const run = async proxy => {
      const t0 = Date.now(), r = await request(url, ref, body, proxy, controller.signal);
      if (done) return;
      if (proxy) {
        const v = POOL.get(proxy);
        if (r) { v.ms = Date.now() - t0; v.ok++; }
        else { v.bad = v.bad || {}; v.bad[cap] = (v.bad[cap] || 0) + 1; }
      }
      if (r) finish(r); else if (--pending === 0) finish(null);
    };
    // Verified proxies always start first. Queue the direct hedge afterwards,
    // without accumulating 200ms of idle wait at each of the six HM hops.
    // Request/source budgets and full mirror collection are unchanged.
    for (const proxy of nodes) run(proxy);
    directTimer = setTimeout(() => run(null), nodes.length ? 25 : 0);
  });
}
function bounded(p, ms, fallback) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), Math.max(0, ms));
    Promise.resolve(p).then(v => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}
const unhtml = s => String(s || '').replace(/\\\//g, '/').replace(/&amp;|&#0*38;/gi, '&').replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
const norm = s => unhtml(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const fileOK = n => /\.(?:mkv|mp4|avi|webm)$/i.test(n);
function qualityOf(s) {
  const n = String(s || '');
  return /(?:^|\D)(?:2160p?|4k)(?:\b|[._ -])/i.test(n) ? '2160'
    : /(?:^|\D)1080p?(?:\b|[._ -])/i.test(n) ? '1080'
    : /(?:^|\D)720p?(?:\b|[._ -])/i.test(n) ? '720'
    : /(?:^|\D)480p?(?:\b|[._ -])/i.test(n) ? '480' : '';
}
const wanted = n => ['1080', '2160'].includes(qualityOf(n));
function titleScore(title, url) {
  let u;
  try { u = new URL(url); } catch (_) { return -1; }
  if (!/^(?:[a-z0-9-]+\.)?hindmovie\.[a-z]{2,8}$/i.test(u.hostname) || !/^\/[a-z0-9-]+\/?$/i.test(u.pathname)) return -1;
  const slug = norm(u.pathname), q = norm(title), q2 = q.replace(/^the /, '');
  if (!q || !q2) return -1;
  const padded = ' ' + slug + ' ';
  if (!padded.includes(' ' + q + ' ') && !padded.includes(' ' + q2 + ' ')) return -1;
  const lead = slug.split(/\b(?:19|20)\d{2}\b|\bseason\b/)[0].trim();
  return lead === q || lead.replace(/^the /, '') === q2 ? 200 : slug.startsWith(q + ' ') ? 120 : 50;
}
function contentOf(text) {
  try { const j = JSON.parse(text); return unhtml(j.content && j.content.rendered || text); } catch (_) { return unhtml(text); }
}
function namesIn(text) {
  return [...new Set([...unhtml(text).matchAll(/([A-Za-z0-9][A-Za-z0-9._()\-\[\] ]{6,220}\.(?:mkv|mp4|avi|webm))/gi)].map(m => m[1].trim()))];
}
function mergeFile(old, entry) {
  return { name: entry.name, id: entry.id || old && old.id || '',
    sources: [...new Set([...(old && old.sources || []), ...(entry.sources || [])])] };
}
function parseFiles(text) {
  const html = contentOf(text), names = namesIn(html), out = new Map();
  const add = (name, id, source) => {
    if (fileOK(name)) out.set(name, mergeFile(out.get(name), { name, id, sources: source ? [source] : [] }));
  };
  for (const name of names) add(name, '');
  // Preserve link provenance. A boldb-only file must not acquire a guessed,
  // usually dead hshare path (and vice versa). Keep BOTH when both are posted.
  for (const m of html.matchAll(/https?:\/\/(?:hshare\.(?:lol|ink)|boldb\.site)\/?\?id=([^"'&<>\s]+)/gi)) {
    let id = m[1]; try { id = decodeURIComponent(id); } catch (_) {}
    const hs = /hshare\./i.test(m[0]);
    const nearby = fileOK(id) ? [] : namesIn(html.slice(Math.max(0, m.index - 1200), m.index));
    const name = fileOK(id) ? id : nearby.pop() || (names.length === 1 ? names[0] : '');
    if (name) add(name, hs ? id : '', new URL(m[0]).href);
  }
  return [...out.values()];
}
function embedsOf(text) {
  const html = contentOf(text), out = new Map();
  for (const m of html.matchAll(/https?:\/\/(?:mvlink\.blog|links\.joshapp\.blog)\/(?:web\/)?[a-z0-9]+\/?/gi)) {
    const before = html.slice(0, m.index), headings = [...before.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const label = (headings.length ? headings[headings.length - 1][1] : '').replace(/<[^>]+>/g, ' ');
    const q = qualityOf(label);
    if (!q || wanted(label)) out.set(m[0].replace(/\/$/, ''), { url: m[0], quality: q, label });
  }
  return [...out.values()];
}
function episodeMatch(name, season, episode) {
  const m = String(name).match(/(?:^|[._ \-])S(\d{1,2})[._ -]*E(\d{1,3})(?:\D|$)/i)
    || String(name).match(/(?:^|[._ \-])(\d{1,2})x(\d{1,3})(?:\D|$)/i);
  return !!m && Number(m[1]) === Number(season) && Number(m[2]) === Number(episode);
}
function cleanUrl(text) {
  const s = unhtml(text).trim().replace(/ /g, '%20');
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return '';
    return /\.(mkv|mp4|avi|webm)$/i.test(u.pathname) || /\.workers\.dev$/i.test(u.hostname) && /^\/(?:d\/|0:\/)/i.test(u.pathname) ? u.href : '';
  } catch (_) { return ''; }
}
function hcloudDecode(input) {
  let cur = unhtml(input);
  for (let i = 0; i < 5 && cur; i++) {
    const direct = cur.match(/https?:\/\/[^"'<>\r\n]*?workers\.dev\/[^"'<>\r\n]+/i);
    if (direct) { const u = cleanUrl(direct[0]); if (u) return u; }
    const p = cur.match(/[?&]url=([^&"'<>\s]+)/i);
    let encoded = p ? p[1] : cur;
    try { encoded = decodeURIComponent(encoded); } catch (_) {}
    const next = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (!next || next === cur) break;
    cur = next;
  }
  return '';
}
function scanUrls(text) {
  const html = contentOf(text), urls = new Set(), shorts = new Set();
  for (const m of html.matchAll(/https?:\/\/[^"'<>\\\r\n]+/gi)) {
    const raw = m[0].trim();
    if (/hcloud\.(?:shop|ink)\/redirect\.php\?url=/i.test(raw)) { const u = hcloudDecode(raw); if (u) urls.add(u); }
    else if (/workers\.dev/i.test(raw)) { const u = cleanUrl(raw); if (u) urls.add(u); }
  }
  for (const m of html.matchAll(/gdshine\.org\/(?:s|api\/share)\/([A-Za-z0-9_-]{6,})/g)) shorts.add(m[1]);
  return { urls: [...urls], shorts: [...shorts] };
}
function limit(concurrency) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < concurrency && queue.length) {
      const { fn, resolve, reject } = queue.shift(); active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; drain(); });
    }
  };
  // Queued work must keep its own request's deadline, not the context of the
  // unrelated request that happened to release the previous limiter slot.
  return fn => new Promise((resolve, reject) => { queue.push({ fn: AsyncResource.bind(fn), resolve, reject }); drain(); });
}
// mvlink has returned another title's page under load in the legacy provider.
// Exact title words (or a title-less SxxExx file under the matched season post)
// are a cheap parsing guard, NOT a request to verify the media URL.
function fileTitleMatch(title, filename) {
  const q = norm(title).replace(/^the /, ''), n = norm(filename).replace(/^the /, '');
  return !q || (' ' + n + ' ').includes(' ' + q + ' ') || /^(?:s\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3})\b/i.test(n);
}
function create(options = {}) {
  const networkGet = options.get || get, base = (options.base || process.env.HMBASE || 'https://v5.hindmovie.im').replace(/\/$/, '');
  const context = new AsyncLocalStorage();
  const httpGet = (url, ms, ref, body, signal) => {
    const scope = context.getStore(), remaining = scope ? scope.deadline - Date.now() : Infinity;
    if (remaining <= 0 || scope?.signal.aborted || signal?.aborted) return Promise.resolve({ st: 0, t: '' });
    const combined = scope ? (signal ? AbortSignal.any([scope.signal, signal]) : scope.signal) : signal;
    return networkGet(url, Math.max(1, Math.min(ms || 4000, remaining)), ref, body, combined);
  };
  const searches = new Map(), plans = new Map(), cache = new Map(), inflight = new Map();
  // Limit actual mvlink/joshapp page requests, not complete multi-hop files.
  // Independent hshare/boldb/gdshine chains can proceed while embeds arrive.
  const embedLimit = limit(3), fileLimit = limit(8);
  let last = {};
  const memoPut = (map, key, value) => { if (map.size > 120) map.delete(map.keys().next().value); map.set(key, { at: Date.now(), value }); };
  const memoGet = (map, key, ttl) => { const c = map.get(key); return c && Date.now() - c.at < ttl ? c.value : null; };
  async function search(title, ms = 3800) {
    if (!norm(title)) return [];
    const key = norm(title), cached = memoGet(searches, key, 1800000);
    if (cached) return cached;
    const q = encodeURIComponent(title), links = new Set(), controller = new AbortController();
    // The HTML search is often already cached (<400ms), while REST can take
    // another second. A positively matched canonical post is enough to start;
    // its entire 1080p/4K file list is still collected before returning cards.
    return new Promise(resolve => {
      let done = false, pending = 2, failed = false;
      const finish = () => {
        const out = [...links].filter(u => titleScore(title, u) >= 0).sort((a, b) => titleScore(title, b) - titleScore(title, a));
        if (!done && (!pending || out.length && titleScore(title, out[0]) >= 120)) {
          done = true; controller.abort();
          if (!out.length && failed) out.$pend = true;
          if (out.length) memoPut(searches, key, out); resolve(out);
        }
      };
      const consume = (r, json) => {
        if (!done) {
          if (!r.st || r.st === 429 || r.st >= 500) failed = true;
          if (json) { try { for (const row of JSON.parse(r.t || '[]')) if (row.url) links.add(row.url); } catch (_) {} }
          else for (const m of contentOf(r.t).matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) links.add(m[1]);
        }
        pending--; finish();
      };
      Promise.resolve(httpGet(base + '/wp-json/wp/v2/search?search=' + q + '&per_page=12', ms, undefined, undefined, controller.signal)).then(r => consume(r, true), () => consume({t:''}, true));
      Promise.resolve(httpGet(base + '/?s=' + q, ms, undefined, undefined, controller.signal)).then(r => consume(r, false), () => consume({t:''}, false));
    });
  }
  async function loadPost(url, ms) {
    const t0 = Date.now();
    const r = await httpGet(url, Math.min(3000, ms));
    const html = contentOf(r.t);
    return { url, html, ms: Date.now() - t0, complete: !!r.st, imdb: (html.match(/imdb\.com\/title\/(tt\d+)/i) || [])[1] || '', embeds: embedsOf(html) };
  }
  async function readEmbed(embed, ms, ref, accept, incomplete = () => {}, onFiles = () => {}) {
    const t0 = Date.now(), left = () => Math.max(0, ms - (Date.now() - t0));
    const jp = embed.match(/links\.joshapp\.blog\/(\d+)/i), mv = embed.match(/mvlink\.blog\/(\d+)\/?$/i);
    if (!jp && !mv) {
      return embedLimit(async () => {
        if (left() < 50) { incomplete(); return ''; }
        const r = await httpGet(embed, left(), ref);
        if (parseFiles(r.t).some(f => accept(f) && f.sources.length)) return r.t;
        if (!r.st || left() <= 100) incomplete();
        return '';
      });
    }
    // Both representations name the exact advertised post ID. A 50ms HTML
    // head start avoids extra traffic on an already-fast mvlink page. If REST
    // wins, start its validated file work NOW but keep the canonical HTML alive:
    // it may advertise additional files/provenance. This is not first-file/card
    // early return and cannot pin a partial REST-only plan as complete.
    const controller = new AbortController(), rest = jp
      ? 'https://links.joshapp.blog/wp-json/wp/v2/posts/' + jp[1]
      : 'https://mvlink.blog/wp-json/wp/v2/posts/' + mv[1];
    return new Promise(resolve => {
      let done = false, pending = 2, failed = false, restStarted = false, restTimer, htmlDone = false, restText = '';
      const finish = text => { done = true; clearTimeout(restTimer); controller.abort(); resolve(text); };
      const consume = (result, isRest) => {
        if (done) return;
        const text = result.t || '';
        if (!result.st) failed = true;
        if (!isRest) htmlDone = true;
        if (parseFiles(text).some(f => accept(f) && f.sources.length)) {
          if (mv) onFiles(text);
          // Preserve Joshapp's equivalent-response race and mvlink's original
          // canonical-HTML authority. Only a REST-first mvlink keeps collecting.
          if (!mv || !isRest || htmlDone) { finish(text); return; }
          restText = text;
        }
        if (--pending === 0) { if (failed) incomplete(); finish(restText); }
        else startRest();
      };
      const run = (target, isRest) => embedLimit(async () => {
        if (controller.signal.aborted || left() < 50) return { st: 0, t: '' };
        return httpGet(target, left(), ref, undefined, controller.signal);
      }).then(r => consume(r, isRest), () => consume({ st: 0, t: '' }, isRest));
      const startRest = () => {
        if (done || restStarted) return;
        restStarted = true; clearTimeout(restTimer); run(rest, true);
      };
      run(embed, false);
      if (mv) restTimer = setTimeout(startRest, Math.min(50, left()));
      else startRest();
    });
  }
  async function post(url, ms = 4200, onFile, loaded, accept = () => true) {
    const t0 = Date.now(), left = () => Math.max(0, ms - (Date.now() - t0));
    const p = loaded || await loadPost(url, left()), all = new Map();
    const add = text => {
      for (const f of parseFiles(text).filter(f => accept(f) && f.sources.length)) {
        const old = all.get(f.name), merged = mergeFile(old, f);
        all.set(f.name, merged);
        const delta = merged.sources.filter(u => !old || !old.sources.includes(u));
        if (onFile && delta.length) onFile({ ...merged, sources: delta });
      }
    };
    let complete = p.complete !== false;
    const incomplete = () => { complete = false; };
    add(p.html);
    await Promise.all(p.embeds.map(async ({ url: embed }) => {
      if (left() < 50) { incomplete(); return; }
      try { add(await readEmbed(embed, left(), url, accept, incomplete, add)); } catch (_) { incomplete(); }
    }));
    return { url, imdb: p.imdb, files: [...all.values()], embeds: p.embeds, complete };
  }
  async function finalUrls(entry, ms = 6500, shared) {
    const t0 = Date.now(), left = () => Math.max(0, ms - (Date.now() - t0));
    const state = shared || { urls: new Set(), shorts: new Map(), sources: new Map() };
    const out = state.urls, shortJobs = state.shorts;
    const add = u => {
      const clean = cleanUrl(u);
      if (clean && !out.has(clean)) { out.add(clean); state.onURL?.(clean); }
    };
    const fast = short => {
      if (shortJobs.has(short)) return shortJobs.get(short);
      const job = (async () => {
        if (left() < 100) { state.pending = true; return; }
        const a = await httpGet('https://gdshine.org/api/share/' + short, Math.min(2400, left()), 'https://gdshine.org/');
        if (!a.st || a.st === 429 || a.st >= 500) state.pending = true;
        let id = ''; try { id = JSON.parse(a.t).data.file.id; } catch (_) {}
        if (!id) return;
        if (left() < 100) { state.pending = true; return; }
        const b = await httpGet('https://gdshine.org/api/downloads/' + encodeURIComponent(id) + '/via-worker', Math.min(2600, left()), 'https://gdshine.org/', '{}');
        if (!b.st || b.st === 429 || b.st >= 500) state.pending = true;
        try { const data = JSON.parse(b.t).data || {}; for (const k of ['copyUrl', 'downloadUrl', 'url']) if (data[k]) add(data[k]); } catch (_) {}
      })().catch(() => {});
      shortJobs.set(short, job); return job;
    };
    // Old direct callers without provenance retain their legacy fallback.
    // Discovered plans always carry the exact source URLs from the website.
    const sources = Array.isArray(entry.sources) ? entry.sources : [
      ...(entry.name ? ['https://boldb.site/?id=' + encodeURIComponent(entry.name)] : []),
      ...(entry.id || entry.name ? ['https://hshare.lol/?id=' + encodeURIComponent(entry.id || entry.name)] : [])
    ];
    const jobs = sources.map(url => {
      if (!state.sources.has(url)) state.sources.set(url, (async () => {
        if (left() < 100) { state.pending = true; return; }
        const r = await httpGet(url, Math.min(4500, left()), new URL(url).origin + '/');
        if (!r.st || r.st === 429 || r.st >= 500) state.pending = true;
        const scan = scanUrls(r.t); scan.urls.forEach(add);
        await Promise.all(scan.shorts.map(fast));
      })().catch(() => {}));
      return state.sources.get(url);
    });
    const complete = await bounded(Promise.all(jobs).then(() => true), left(), false);
    if (!complete) state.pending = true;
    return [...out];
  }
  function cards(title, type, season, episode, mk, budget = 11000, identity = {}) {
    // The caller may have spent part of the route budget on metadata already.
    const absolute = Number(identity.deadline);
    if (Number.isFinite(absolute) && absolute > 0) budget = Math.min(budget, Math.max(0, absolute - Date.now()));
    if (!(budget > 0)) return Promise.resolve([]);
    const key = [norm(title), type || 'movie', season || 0, episode || 0, identity.key || identity.imdb || ''].join('|');
    const hit = memoGet(cache, key, 600000);
    if (hit) return Promise.resolve(hit.slice());
    if (inflight.has(key)) return inflight.get(key);
    const t0 = Date.now(), deadline = t0 + budget, left = () => Math.max(0, deadline - Date.now()), sink = [], controller = new AbortController();
    let finished = false, unresolved = false;
    const stat = { title, stage: 'search', files: 0, picked: 0, cards: 0, ms: 0 }; last = stat;
    // Start the identity allowance NOW, not after search. Post HTML, identity,
    // embeds and already-discovered files overlap without skipping the guard.
    let expected = identity.imdb || '';
    const identityWork = identity.imdbPromise ? Promise.resolve(identity.imdbPromise).then(v => { expected = expected || v || ''; return expected; }, () => expected) : Promise.resolve(expected);
    const identityGate = bounded(identityWork, Math.min(500, budget), '');
    const accept = f => wanted(f.name) && fileTitleMatch(title, f.name)
      && (type !== 'series' && type !== 'tv' || episodeMatch(f.name, season, episode));
    const emit = (f, imdb, url) => {
      if (finished || controller.signal.aborted || left() <= 0 || expected && imdb && expected !== imdb || sink.some(c => c.url === url)) return;
      const q = qualityOf(f.name), tag = /workers\.dev\/d\//i.test(url) ? 'Fast' : /workers\.dev\/0:\//i.test(url) ? 'Hub' : 'Mirror';
      const card = mk ? mk(url, f.name, q, tag) : { url, filename: f.name, quality: q, tag };
      if (card) { sink.push(card); if (stat.firstCardMs === undefined) stat.firstCardMs = Date.now() - t0; }
    };
    const work = context.run({ signal: controller.signal, deadline }, () => (async () => {
      let files = memoGet(plans, key, 1800000);
      const states = new Map();
      const schedule = (f, imdb, jobs) => {
        if (!accept(f)) return;
        if (stat.firstFileMs === undefined) stat.firstFileMs = Date.now() - t0;
        const job = (async () => {
          await identityGate;
          if (expected && imdb && expected !== imdb) return;
          if (left() < 100) { unresolved = true; return; }
          if (!states.has(f.name)) states.set(f.name, { urls: new Set(), shorts: new Map(), sources: new Map(), onURL: url => emit(f, imdb, url) });
          const state = states.get(f.name);
          const urls = await fileLimit(() => {
            if (left() < 100) { state.pending = true; return []; }
            return finalUrls(f, Math.min(6500, left()), state);
          });
          if (state.pending) unresolved = true;
          for (const url of urls) emit(f, imdb, url);
        })();
        jobs.push(job.catch(() => {}));
      };
      if (files) {
        const jobs = []; files.forEach(f => schedule(f, '', jobs)); await Promise.all(jobs);
      } else {
        let posts = await search(title, Math.min(3500, left())); stat.searchAttempts = 1;
        // A transient cold-site failure is not a conclusive empty title. Use
        // otherwise-unused room for ONE retry, inside the SAME route deadline.
        // A successful empty search is final and causes no additional traffic.
        if (!posts.length && posts.$pend && !controller.signal.aborted && left() > 100) {
          stat.searchAttempts++; posts = await search(title, Math.min(3500, left()));
        }
        if (posts.$pend) unresolved = true;
        stat.posts = posts.length; stat.searchMs = Date.now() - t0;
        // Prefetch candidate metadata together; only drill into a fallback if
        // the preferred post is mismatched or has no requested files.
        const heads = posts.slice(0, 2).map(url => loadPost(url, Math.min(3000, left())).catch(() => null));
        for (let i = 0; i < heads.length; i++) {
          const head = await heads[i];
          if (!head || left() < 100) { unresolved = true; continue; }
          if (expected && head.imdb && expected !== head.imdb) continue;
          const jobs = [];
          stat.stage = 'discover+resolve';
          const p = await post(head.url, Math.min(Math.max(0, 4200 - head.ms), left()), f => schedule(f, head.imdb, jobs), head, accept);
          await identityGate;
          if (finished || controller.signal.aborted) return;
          if (expected && p.imdb && expected !== p.imdb) continue;
          if (!p.complete) unresolved = true;
          if (p.files.length) {
            files = p.files;
            if (p.complete) memoPut(plans, key, files); else unresolved = true;
            stat.files = files.length; stat.picked = files.length; stat.discoveryMs = Date.now() - t0;
            await Promise.all(jobs); break;
          }
        }
      }
      if (!finished) { files = files || []; stat.files = files.length; stat.picked = files.length; }
    })());
    const result = bounded(work.then(() => true, () => false), budget, null).then(complete => {
      finished = true; controller.abort();
      const out = sink.slice(), pending = complete !== true || unresolved;
      // Keep ready mirrors in THIS response, but never freeze an incomplete
      // result in a ten-minute positive cache or silently label it complete.
      if (pending) out.$pend = true;
      stat.cards = out.length; stat.ms = Date.now() - t0; stat.pending = pending; stat.stage = out.length ? 'ok' : 'empty';
      if (out.length && !pending) memoPut(cache, key, out);
      else if (!out.length) plans.delete(key);
      inflight.delete(key); return out;
    });
    inflight.set(key, result); return result;
  }
  return { search, post, finalUrls, cards, cardsCached: cards, last: () => ({ ...last }) };
}
module.exports = { ...create(), create, get, poolLoad, poolPick, poolStats, capOf, extractionError, qualityOf, titleScore, fileTitleMatch, parseFiles, embedsOf, episodeMatch, cleanUrl, hcloudDecode, scanUrls };
