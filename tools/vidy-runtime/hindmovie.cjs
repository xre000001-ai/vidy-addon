'use strict';
// HindMovie-only overlay for the unchanged 87e0192 / v1.34.415 stable tree.
// Resolve 1080p / 2160p only. No media verification, global scheduler changes,
// child processes, pool trainer, or first-card/first-file early return.
const fs = require('fs');
const path = require('path');
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
      if (r.status < 200 || r.status >= 300 || !t || /Just a moment|_cf_chl_opt|Attention Required/i.test(t.slice(0, 1500))) return null;
      return { st: r.status, t, via: proxy || 'direct' };
    }
  } catch (_) {} finally { if (agent) agent.close().catch(() => {}); }
  return null;
}
function get(url, ms, ref, body) {
  const cap = capOf(url), nodes = poolPick(2, cap), controller = new AbortController();
  return new Promise(resolve => {
    let done = false, pending = nodes.length + 1, directTimer;
    const finish = r => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(directTimer); controller.abort();
      resolve(r || { st: 0, t: '' });
    };
    const timer = setTimeout(() => finish(null), Math.max(1, ms || 4000));
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
    // Verified proxies always start first; direct is only a delayed backup.
    for (const proxy of nodes) run(proxy);
    directTimer = setTimeout(() => run(null), nodes.length ? 200 : 0);
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
function parseFiles(text) {
  const html = contentOf(text), names = namesIn(html), out = new Map();
  const add = (name, id) => { if (fileOK(name)) { const old = out.get(name); out.set(name, { name, id: id || old && old.id || '' }); } };
  for (const name of names) add(name, '');
  for (const m of html.matchAll(/(?:hshare\.lol\/?|boldb\.site\/)\?id=([^"'&<>\s]+)/gi)) {
    let id = m[1]; try { id = decodeURIComponent(id); } catch (_) {}
    if (fileOK(id)) add(id, /hshare/i.test(m[0]) ? id : '');
    else if (/hshare/i.test(m[0])) {
      const nearby = namesIn(html.slice(Math.max(0, m.index - 1200), m.index));
      const name = nearby.pop() || (names.length === 1 ? names[0] : '');
      if (name) add(name, id);
    }
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
async function mapLimit(items, concurrency, fn) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const i = index++; await fn(items[i], i); }
  }));
}
function create(options = {}) {
  const httpGet = options.get || get, base = (options.base || process.env.HMBASE || 'https://v5.hindmovie.im').replace(/\/$/, '');
  const searches = new Map(), plans = new Map(), cache = new Map(), inflight = new Map();
  let last = {};
  const memoPut = (map, key, value) => { if (map.size > 120) map.delete(map.keys().next().value); map.set(key, { at: Date.now(), value }); };
  const memoGet = (map, key, ttl) => { const c = map.get(key); return c && Date.now() - c.at < ttl ? c.value : null; };
  async function search(title, ms = 3800) {
    if (!norm(title)) return [];
    const key = norm(title), cached = memoGet(searches, key, 1800000);
    if (cached) return cached;
    const q = encodeURIComponent(title), links = new Set();
    // The HTML search is often already cached (<400ms), while REST can take
    // another second. A positively matched canonical post is enough to start;
    // its entire 1080p/4K file list is still collected before returning cards.
    return new Promise(resolve => {
      let done = false, pending = 2;
      const finish = () => {
        const out = [...links].filter(u => titleScore(title, u) >= 0).sort((a, b) => titleScore(title, b) - titleScore(title, a));
        if (!done && (!pending || out.length && titleScore(title, out[0]) >= 120)) {
          done = true; if (out.length) memoPut(searches, key, out); resolve(out);
        }
      };
      const consume = (r, json) => {
        if (!done) {
          if (json) { try { for (const row of JSON.parse(r.t || '[]')) if (row.url) links.add(row.url); } catch (_) {} }
          else for (const m of contentOf(r.t).matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) links.add(m[1]);
        }
        pending--; finish();
      };
      Promise.resolve(httpGet(base + '/wp-json/wp/v2/search?search=' + q + '&per_page=12', ms)).then(r => consume(r, true), () => consume({t:''}, true));
      Promise.resolve(httpGet(base + '/?s=' + q, ms)).then(r => consume(r, false), () => consume({t:''}, false));
    });
  }
  async function post(url, ms = 4200) {
    const t0 = Date.now(), left = () => Math.max(0, ms - (Date.now() - t0));
    const r = await httpGet(url, Math.min(3000, left())), html = contentOf(r.t), all = new Map();
    const add = text => { for (const f of parseFiles(text)) { const old = all.get(f.name); all.set(f.name, { name: f.name, id: f.id || old && old.id || '' }); } };
    add(html);
    const embeds = embedsOf(html);
    await mapLimit(embeds, 3, async ({ url: embed }) => {
      if (left() < 50) return;
      const jp = embed.match(/links\.joshapp\.blog\/(\d+)/i);
      let rr = await httpGet(jp ? 'https://links.joshapp.blog/wp-json/wp/v2/posts/' + jp[1] : embed, left(), url);
      if (jp && !parseFiles(rr.t).length && left() > 100) rr = await httpGet(embed, left(), url);
      add(rr.t);
    });
    return { url, imdb: (html.match(/imdb\.com\/title\/(tt\d+)/i) || [])[1] || '', files: [...all.values()], embeds };
  }
  async function finalUrls(entry, ms = 6500) {
    const t0 = Date.now(), left = () => Math.max(0, ms - (Date.now() - t0)), out = new Set(), shortJobs = new Map();
    const add = u => { const clean = cleanUrl(u); if (clean) out.add(clean); };
    const fast = short => {
      if (shortJobs.has(short)) return shortJobs.get(short);
      const job = (async () => {
        if (left() < 100) return;
        const a = await httpGet('https://gdshine.org/api/share/' + short, Math.min(2400, left()), 'https://gdshine.org/');
        let id = ''; try { id = JSON.parse(a.t).data.file.id; } catch (_) {}
        if (!id || left() < 100) return;
        const b = await httpGet('https://gdshine.org/api/downloads/' + encodeURIComponent(id) + '/via-worker', Math.min(2600, left()), 'https://gdshine.org/', '{}');
        try { const data = JSON.parse(b.t).data || {}; for (const k of ['copyUrl', 'downloadUrl', 'url']) if (data[k]) add(data[k]); } catch (_) {}
      })().catch(() => {});
      shortJobs.set(short, job); return job;
    };
    const sources = [];
    if (entry.name) sources.push('https://boldb.site/?id=' + encodeURIComponent(entry.name));
    if (entry.id || entry.name) sources.push('https://hshare.lol/?id=' + encodeURIComponent(entry.id || entry.name));
    const work = Promise.all(sources.map(async url => {
      const r = await httpGet(url, Math.min(4500, left()), new URL(url).origin + '/');
      const scan = scanUrls(r.t); scan.urls.forEach(add);
      await Promise.all(scan.shorts.map(fast));
    }));
    await bounded(work, left(), null);
    return [...out];
  }
  function cards(title, type, season, episode, mk, budget = 11000, identity = {}) {
    const key = [norm(title), type || 'movie', season || 0, episode || 0].join('|');
    const hit = memoGet(cache, key, 600000);
    if (hit) return Promise.resolve(hit.slice());
    if (inflight.has(key)) return inflight.get(key);
    const t0 = Date.now(), left = () => Math.max(0, budget - (Date.now() - t0)), sink = [];
    const stat = { title, stage: 'search', files: 0, picked: 0, cards: 0, ms: 0 }; last = stat;
    const work = (async () => {
      let files = memoGet(plans, key, 1800000);
      if (!files) {
        const posts = await search(title, Math.min(3500, left())); stat.posts = posts.length;
        const expected = identity.imdb || (identity.imdbPromise ? await bounded(identity.imdbPromise, Math.min(500, left()), '') : '');
        for (const url of posts.slice(0, 2)) {
          if (left() < 100) break;
          const p = await post(url, Math.min(4200, left()));
          if (expected && p.imdb && expected !== p.imdb) continue;
          files = p.files.filter(f => wanted(f.name) && (type !== 'series' && type !== 'tv' || episodeMatch(f.name, season, episode)));
          if (files.length) break;
        }
        if (files && files.length) memoPut(plans, key, files);
      }
      files = files || []; stat.files = files.length; stat.picked = files.length; stat.stage = 'resolve';
      await mapLimit(files, 3, async f => {
        if (left() < 100) return;
        const urls = await finalUrls(f, Math.min(6500, left()));
        for (const url of urls) {
          if (sink.some(c => c.url === url)) continue;
          const q = qualityOf(f.name), tag = /workers\.dev\/d\//i.test(url) ? 'Fast' : /workers\.dev\/0:\//i.test(url) ? 'Hub' : 'Mirror';
          const card = mk ? mk(url, f.name, q, tag) : { url, filename: f.name, quality: q, tag };
          if (card) sink.push(card);
        }
      });
    })();
    const result = bounded(work, budget, null).then(() => {
      const out = sink.slice(); stat.cards = out.length; stat.ms = Date.now() - t0; stat.stage = out.length ? 'ok' : 'empty';
      if (out.length) memoPut(cache, key, out);
      else plans.delete(key);
      inflight.delete(key); return out;
    });
    inflight.set(key, result); return result;
  }
  return { search, post, finalUrls, cards, cardsCached: cards, last: () => ({ ...last }) };
}
module.exports = { ...create(), create, get, poolLoad, poolPick, poolStats, capOf, qualityOf, titleScore, parseFiles, embedsOf, episodeMatch, cleanUrl, hcloudDecode, scanUrls };
