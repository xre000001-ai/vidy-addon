'use strict';
// Exercise the real formatter/adapter/unifier/sender without booting providers,
// sockets, Chromium, proof pools, or any addon background work.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = () => fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function section(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b <= a) throw new Error('Missing real-server section: ' + from);
  return src.slice(a, b);
}
function harness(src = source(), remoteCards = [], options = {}) {
  const timers = new Set(), calls = [];
  const ctx = {
    console, Buffer, URL, Map, Set, Promise, Date, Math, Object, String, Number, Array,
    process: { env: {} }, DBG: false, UA: 'fixture-user-agent', LR: { sr: [] },
    NEXDBG_LOG: [], NEXS_LOG: [], SRES_RAW: new Map(),
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); timers.add(t); return t; },
    clearTimeout(t) { clearTimeout(t); timers.delete(t); },
    async directGet(url, ms) { calls.push({ url, ms }); if (options.remoteError) throw new Error('remote unavailable'); return JSON.stringify({ streams: plain(remoteCards) }); },
    originOf: () => 'https://addon.example',
    nameForTmdb: async () => options.title || '',
    yearForTmdb: async () => options.year || 0,
    epMetaFor: async () => ({ epT: options.episodeTitle || '' }),
    vhIsVidy: () => false, vhPrewarm: () => {}, vhFixCards: () => {},
    logReq: () => {}, sresKey: () => 'fixture-key', nexdbg: () => {},
    nexStreamsCount: () => [], sresMerge: (key, body) => body, sresPut: () => {},
    gwStamp: body => body, bgStreamFetch: () => {},
  };
  const chunks = [
    section(src, 'const FMT_JUNK =', 'const YEAR_CACHE ='),
    section(src, 'const NEXA_ADDON_DEFAULT =', 'const UNIFY_SRV ='),
    section(src, 'const UNIFY_SRV =', 'const STREAM_RES_CACHE ='),
    section(src, 'function sendStreams(', 'function sendFile2('),
  ];
  vm.createContext(ctx);
  vm.runInContext(chunks.join('\n') + '\nObject.assign(globalThis,{format:fmtCards,strip:stripCards,adapter:nexaAddonStreams,unify:unifyCards,send:sendStreams});', ctx);
  return {
    ctx, calls,
    close() { for (const t of timers) clearTimeout(t); timers.clear(); },
    format(cards) { ctx.format(cards); return cards; },
    async ingest(type = 'movie', id = 'tt0770828', s = 0, e = 0, title = '') {
      return ctx.adapter({ headers: { host: '3404d3c5dc63-vidy.baby-beamup.club' } }, type, id, s, e, title);
    },
    unify(cards, meta) { return ctx.unify(cards, meta); },
    send(cards) {
      let body, status, headers;
      const res = { req: { headers: {}, url: '/stream/movie/fixture.json' }, __t0: Date.now(),
        writeHead(s, h) { status = s; headers = h; }, end(b) { body = String(b); } };
      ctx.send(res, 'fixture', '/stream/movie/fixture.json', 1, cards, 'fixture', {});
      return { status, headers, body, streams: JSON.parse(body).streams };
    },
  };
}
module.exports = { source, plain, section, harness };
