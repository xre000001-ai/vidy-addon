'use strict';
// Additive CineJoy (cinejoy.pk) source. No child process, shared proxy trust or video relay.
const fs = require('node:fs'), path = require('node:path');
const { Pool } = require('./cinejoy-pk/src/pool.cjs');
const { Engine, wait, DELIVERY } = require('./cinejoy-pk/src/engine.cjs');
const { Refiller } = require('./cinejoy-pk/src/refill.cjs');
const { Session, UA } = require('./cinejoy-pk/src/transport.cjs');
const { SERVERS } = require('./cinejoy-pk/src/protocol.cjs');
const { safeURL } = require('./cinejoy-pk/src/policy.cjs');
const { Metadata, requestIdentity, bounded } = require('./cinejoy-pk/src/metadata.cjs');
const { PKError, classify, publicError } = require('./cinejoy-pk/src/errors.cjs');
const manifests = require('./cinejoy-pk/src/manifests.cjs');
const REVISION = 'cinejoy-pk-integration-1';
const LANGUAGE = {
  en: ['English', 'eng'], eng: ['English', 'eng'], hi: ['Hindi', 'hin'], hin: ['Hindi', 'hin'],
  bn: ['Bengali', 'ben'], ben: ['Bengali', 'ben'], ta: ['Tamil', 'tam'], tam: ['Tamil', 'tam'],
  te: ['Telugu', 'tel'], tel: ['Telugu', 'tel'], ml: ['Malayalam', 'mal'], mal: ['Malayalam', 'mal'],
  kn: ['Kannada', 'kan'], kan: ['Kannada', 'kan'], ja: ['Japanese', 'jpn'], jpn: ['Japanese', 'jpn'],
  ko: ['Korean', 'kor'], kor: ['Korean', 'kor'], zh: ['Chinese', 'zho'], zho: ['Chinese', 'zho'],
  fr: ['French', 'fra'], fra: ['French', 'fra'], es: ['Spanish', 'spa'], spa: ['Spanish', 'spa'],
  de: ['German', 'deu'], deu: ['German', 'deu'], it: ['Italian', 'ita'], ita: ['Italian', 'ita'],
  ar: ['Arabic', 'ara'], ara: ['Arabic', 'ara'], pt: ['Portuguese', 'por'], por: ['Portuguese', 'por'],
  ru: ['Russian', 'rus'], rus: ['Russian', 'rus'], tr: ['Turkish', 'tur'], tur: ['Turkish', 'tur'],
  nl: ['Dutch', 'nld'], pl: ['Polish', 'pol'], uk: ['Ukrainian', 'ukr'], sv: ['Swedish', 'swe'],
  da: ['Danish', 'dan'], no: ['Norwegian', 'nor'], fi: ['Finnish', 'fin'], cs: ['Czech', 'ces'],
  el: ['Greek', 'ell'], hu: ['Hungarian', 'hun'], ro: ['Romanian', 'ron'], id: ['Indonesian', 'ind'],
  vi: ['Vietnamese', 'vie'], th: ['Thai', 'tha'], ur: ['Urdu', 'urd'], fa: ['Persian', 'fas']
};
function cleanConfig(config) {
  const c = config || {}, disabled = c.cj === 0 || c.cj === '0';
  const excluded = Array.isArray(c.cjsrv) ? [...new Set(c.cjsrv.map(s => String(s).toLowerCase()).filter(s => SERVERS.some(x => x.toLowerCase() === s)))] : [];
  const qualities = Array.isArray(c.cjq) ? [...new Set(c.cjq.map(Number).filter(n => [2160, 1080, 720, 480].includes(n)))] : [];
  return { enabled: !disabled, excluded, qualities, servers: disabled ? [] : SERVERS.filter(s => !excluded.includes(s.toLowerCase())) };
}
function subtitles(stream) {
  const out = [], seen = new Set();
  for (const caption of Array.isArray(stream.captions) ? stream.captions : []) {
    try {
      if (!['vtt', 'srt', 'ass', 'ssa'].includes(String(caption.type || '').toLowerCase())) continue;
      const url = safeURL(caption.url), raw = String(caption.language || caption.id || '').toLowerCase().split(/[-_]/)[0];
      const lang = LANGUAGE[raw]?.[1] || (/^[a-z]{3}$/.test(raw) ? raw : 'und');
      if (seen.has(url)) continue;
      seen.add(url); out.push({ id: 'cj-' + String(caption.id || out.length).replace(/[^a-z0-9_-]/ig, '').slice(0, 60), lang, url });
    } catch (_) { /* Ignore invalid caption entries, never alter a signed URL. */ }
  }
  return out;
}
function cardsFor(result, sample, origin, config) {
  const c = cleanConfig(config), out = [], stream = result.streams[0];
  if (!c.servers.includes(result.server)) return out;
  for (const item of manifests.selections(result, origin)) {
    if (c.qualities.length && !c.qualities.includes(item.quality)) continue;
    const langs = [...new Set(item.audio.map(s => {
      const raw = String(s).toLowerCase().split(/[-_]/)[0];
      return LANGUAGE[raw]?.[0] || (Object.values(LANGUAGE).find(v => v[0].toLowerCase() === raw)?.[0]) || '';
    }).filter(Boolean))];
    const audio = langs.length === 1 ? langs[0] : langs.length === 2 ? 'Dual Audio' : langs.length > 2 ? 'Multi Audio' : 'Auto Audio';
    const ep = sample.type === 'tv' ? ' \u23e3 S' + sample.season + 'E' + sample.episode + '\n' : '';
    const title = '\u29c9 ' + sample.title + (sample.year ? ' | ' + sample.year + ' |' : ' |') + '\n' + ep + ' \u2318 CineJoy \u2317 ' + audio + ' \u2022 ' + result.server;
    const headers = { 'User-Agent': UA, Referer: 'https://cinejoy.pk/', Origin: 'https://cinejoy.pk' };
    out.push({
      name: '\u25a5 ' + (item.quality || 'Auto') + ' \u25a5', title, description: title,
      url: item.url, quality: item.quality ? String(item.quality) : '', _hq: item.quality,
      _src: 'CineJoy', _srv: result.server, _lang: langs.length === 1 ? langs[0].toLowerCase() : '',
      bingeGroup: ['cj', result.server, item.quality || 'auto', item.codecs || 'hls', audio].join('|'),
      behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } }, headers,
      subtitles: subtitles(stream)
    });
  }
  return out;
}
class CineJoy {
  constructor({ root = path.resolve(__dirname, '../..'), getMetadataJSON, engine, refiller, env = process.env, log = console.error } = {}) {
    this.root = root; this.env = env; this.log = log; this.engine = engine || null; this.refiller = refiller || null;
    this.metadata = new Metadata(getMetadataJSON); this.active = new Map(); this.controllers = new Set();
    this.started = false; this.closed = false; this.closing = null; this.initialError = null;
    this.refillTimer = null; this.discoveryTimer = null; this.discoveryKick = null; this.discoveryWork = null; this.discoveryController = null;
    this.events = []; this.requests = 0; this.lastDiscovery = null; this.lifecycle = null;
  }
  bindLifecycle(server, owner = process) {
    if (this.lifecycle || this.closed) return;
    // Do not replace the addon's existing signal/child-process handling. Normal HTTP
    // close drains our work; process exit can only synchronously persist our own pool.
    const onClose = () => this.close().catch(e => this.log('[cinejoy] shutdown: ' + (e.code || e.name)));
    const onExit = () => { try { this.engine?.pool.close(); } catch (_) {} };
    this.lifecycle = { server, owner, onClose, onExit };
    server.once('close', onClose); owner.once('exit', onExit);
  }
  event(row) { this.events.push({ ...row, at: Date.now() }); if (this.events.length > 40) this.events.shift(); }
  init() {
    if (this.closed) throw new PKError('LOCAL_CLOSED');
    if (this.env.CINEJOY_OFF === '1') throw new PKError('LOCAL_DISABLED');
    if (this.engine) return;
    const directory = path.resolve(this.env.CINEJOY_STATE_DIR || path.join(this.root, 'cinejoy-data'));
    const pool = new Pool({ file: path.join(directory, 'cinejoy_pk_pool.json') });
    try {
      if (!Object.keys(pool.nodes).length) {
        pool.add(JSON.parse(fs.readFileSync(path.join(__dirname, 'cinejoy-pk/data/candidates.json'), 'utf8')), 'CineJoy address-only seed');
        pool.save();
      }
      this.engine = new Engine({ pool, sessionFactory: proxy => new Session(proxy, { timeout: 4000 }) });
      this.refiller = new Refiller(this.engine, { target: 4, parallel: 2 });
    } catch (e) { pool.close(); throw e; }
  }
  start() {
    if (this.started || this.closed || this.env.CINEJOY_OFF === '1') return;
    try { this.init(); this.started = true; this.initialError = null; }
    catch (e) { this.initialError = publicError(e); this.log('[cinejoy] startup: ' + this.initialError.code); return; }
    if (this.env.CINEJOY_REFILL !== '0') {
      const refill = () => { if (!this.closed && this.requests === 0) this.refiller.run().catch(e => this.event({ type: 'refill-error', code: e.code || e.name })); };
      refill(); this.refillTimer = setInterval(refill, 60000); this.refillTimer.unref?.();
    }
    if (this.env.CINEJOY_DISCOVERY !== '0') {
      const discover = () => this.discover().catch(e => this.event({ type: 'discovery-error', code: e.code || e.name }));
      this.discoveryKick = setTimeout(discover, 20000); this.discoveryKick.unref?.();
      this.discoveryTimer = setInterval(discover, 1800000); this.discoveryTimer.unref?.();
    }
  }
  discover() {
    if (this.discoveryWork) return this.discoveryWork;
    this.discoveryWork = this._discover().finally(() => { this.discoveryWork = null; this.discoveryController = null; });
    return this.discoveryWork;
  }
  async _discover() {
    if (this.closed || this.requests) return null;
    this.init(); const pool = this.engine.pool, ctrl = new AbortController(); this.discoveryController = ctrl;
    const timer = setTimeout(() => ctrl.abort(new PKError('LOCAL_DEADLINE')), 20000); timer.unref?.();
    const session = new Session(null, { discovery: true, timeout: 6000 }), addresses = [], feeds = [];
    try {
      for (const url of ['https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt', 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt']) {
        try {
          const r = await session.get(url, { signal: ctrl.signal, maxBytes: 2 * 1024 * 1024, expectedStatus: [200] });
          const found = r.body.toString().match(/\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b/g) || [];
          addresses.push(...found); feeds.push({ ok: true, count: found.length });
        } catch (e) { feeds.push({ ok: false, code: e.code || e.name }); }
      }
      ctrl.signal.throwIfAborted();
      if (addresses.length) {
        // Rotate only old, never-proven candidates in OUR pool. Existing source proofs survive.
        const disposable = Object.values(pool.nodes).filter(n => !pool.busy.has(n.id) && !Object.values(n.servers).some(b => b.proof)).slice(-1000);
        for (const node of disposable) delete pool.nodes[node.id];
        const added = pool.add(addresses, 'fresh public candidate feed'); pool.save();
        this.lastDiscovery = { at: Date.now(), added, feeds };
      }
      return this.lastDiscovery;
    } finally { clearTimeout(timer); await session.close(); }
  }
  async resolveOne(server, sample, signal, deadline) {
    let last, attempts = 0;
    const tried = new Set(), firstBudget = Math.min(4000, Math.max(20, Math.floor((deadline - Date.now()) / 2)));
    while (!signal.aborted && Date.now() < deadline && attempts < 2) {
      if (!this.engine.pool.ready(server).some(n => !tried.has(n.id))) {
        // Another CineJoy server/trainer may hold a fresh endpoint. Wait only for that lease;
        // never serve a raw candidate, expired proof, foreign pool or direct extraction fallback.
        const now = this.engine.pool.clock();
        const busyFresh = Object.values(this.engine.pool.nodes).some(n => {
          const b = n.servers[server], p = b?.proof;
          return !tried.has(n.id) && this.engine.pool.busy.has(n.id) && p && now - p.at < this.engine.pool.freshMs && p.at <= now && !(b.coolUntil > now) && !(n.globalCoolUntil > now);
        });
        if (!busyFresh) throw last || new PKError('NO_READY_PROXY');
        await wait(Math.min(100, Math.max(1, deadline - Date.now())), signal); continue;
      }
      attempts++;
      try {
        // Reserve part of our existing budget for a distinct verified backup. A slow
        // primary must not consume all 7.8 seconds and silently prevent failover.
        const remaining = Math.max(20, deadline - Date.now());
        const result = await this.engine.resolve(server, sample, { signal, budgetMs: attempts === 1 ? Math.min(firstBudget, remaining) : Math.min(30000, remaining), maxLanes: 1, excludeProxyIds: [...tried] });
        if (attempts > 1) this.engine.pool.metrics.failovers++;
        return result;
      } catch (e) {
        last = e;
        for (const row of e.attempts || []) if (row.proxyId) tried.add(row.proxyId);
        // Readiness can change between this wrapper and Engine.track's microtask.
        // A sibling taking the last lease is not an extraction failure or a spent attempt.
        if (e.code === 'NO_READY_PROXY') { attempts--; await wait(Math.min(100, Math.max(1, deadline - Date.now())), signal); continue; }
        if (e.code === 'LOCAL_DEADLINE' && !signal.aborted) continue;
        if (!['transport', 'source-block', 'rate-limit', 'upstream'].includes(classify(e))) throw e;
      }
    }
    throw last || signal.reason || new PKError('LOCAL_DEADLINE');
  }
  streams(options) {
    const { type, id, season, episode, origin, config } = options;
    const c = cleanConfig(config);
    if (!c.servers.length || this.env.CINEJOY_OFF === '1') return Promise.resolve([]);
    let identity;
    try { identity = requestIdentity(type, id, season, episode); this.init(); }
    catch (e) { this.event({ type: 'request-error', code: e.code || e.name }); return Promise.resolve([]); }
    const key = identity.key + '|' + origin + '|' + c.excluded.join(',') + '|' + c.qualities.join(',');
    if (this.active.has(key)) return this.active.get(key);
    const work = this._streams(identity, origin, config, c).finally(() => this.active.delete(key));
    this.active.set(key, work); return work;
  }
  async _streams(identity, origin, config, c) {
    const configured = Number(this.env.CINEJOY_BUDGET_MS), budget = Number.isFinite(configured) && configured >= 100 && configured <= 8000 ? configured : 7800;
    const began = Date.now(), deadline = began + budget, ctrl = new AbortController(); this.controllers.add(ctrl); this.requests++;
    const timer = setTimeout(() => ctrl.abort(new PKError('LOCAL_DEADLINE')), budget); timer.unref?.();
    // A background refresh must not occupy the scarce verified endpoints while
    // a first-tap request is waiting. Cancellation is local, never a proxy ban.
    if (this.refiller?.controller && !this.refiller.controller.signal.aborted) {
      this.refiller.controller.abort(new PKError('LOCAL_FOREGROUND', 'Yield CineJoy refill to foreground'));
      this.event({ type: 'refill-yield' });
    }
    try {
      const sample = await this.metadata.load(identity, ctrl.signal);
      // Lease the scarcest server's endpoints first, then restore public card order.
      const order = c.servers.slice().sort((a, b) => this.engine.pool.ready(a).length - this.engine.pool.ready(b).length);
      const lists = await Promise.all(order.map(async server => {
        try {
          const result = await bounded(this.resolveOne(server, sample, ctrl.signal, deadline), ctrl.signal);
          const cards = cardsFor(result, sample, origin, config);
          this.event({ type: 'served', server, cards: cards.length, ms: Date.now() - began, proxyId: result.proxyId });
          return cards;
        } catch (e) { this.event({ type: 'source-error', server, code: e.code || e.name, ms: Date.now() - began }); return []; }
      }));
      return c.servers.flatMap(server => lists[order.indexOf(server)]);
    } catch (e) { this.event({ type: 'metadata-error', code: e.code || e.name, ms: Date.now() - began }); return []; }
    finally { clearTimeout(timer); this.controllers.delete(ctrl); this.requests--; }
  }
  handle(req, res, pathname) {
    if (manifests.serve(req, res, pathname)) return true;
    if (pathname !== '/_cinejoy') return false;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { res.writeHead(405); res.end(); return true; }
    const body = JSON.stringify(this.status());
    res.writeHead(req.method === 'OPTIONS' ? 204 : 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : body); return true;
  }
  status() {
    const refill = this.refiller?.status();
    return { source: 'CineJoy', domain: 'cinejoy.pk', revision: REVISION, enabled: this.env.CINEJOY_OFF !== '1', servers: SERVERS.slice(), started: this.started, delivery: DELIVERY, videoProxy: false, requests: this.requests, pool: this.engine?.pool.summary() || null, refill: refill ? { ...refill, enabled: !!this.refillTimer, intervalMs: 60000 } : null, discovery: this.lastDiscovery, initialError: this.initialError, events: this.events.slice(-12) };
  }
  close() {
    if (this.closing) return this.closing;
    this.closed = true; clearInterval(this.refillTimer); clearInterval(this.discoveryTimer); clearTimeout(this.discoveryKick); this.refillTimer = null;
    if (this.lifecycle) {
      const { server, owner, onClose, onExit } = this.lifecycle;
      server.removeListener('close', onClose); owner.removeListener('exit', onExit); this.lifecycle = null;
    }
    this.closing = (async () => {
      for (const ctrl of this.controllers) ctrl.abort(new PKError('ABORTED'));
      this.discoveryController?.abort(new PKError('ABORTED'));
      await this.discoveryWork?.catch(() => {});
      await this.refiller?.close(); await Promise.allSettled([...this.active.values()]);
      await this.engine?.close();
    })();
    return this.closing;
  }
}
module.exports = { create: options => new CineJoy(options), CineJoy, cleanConfig, cardsFor, subtitles, SERVERS, REVISION };
