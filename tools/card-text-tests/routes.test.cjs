'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { harness, source, plain, section } = require('./card-helpers.cjs');
const fixture = require('./fixtures/remote-cards.json');
const off = Object.fromEntries(['v','nx','tw','rt','mm','m4u','sky','hm','hd','bf','vsp','ott','az','mlb','mls','dt','nex','cj'].map(k => [k, 0]));
async function route(t, pathname, kind, s = 0, e = 0, enabled = true) {
  const title = kind === 'movie' ? 'Man of Steel' : 'Game of Thrones';
  const remote = plain(fixture[kind]);
  if (kind === 'series') for (const c of remote) for (const k of ['title', 'description']) c[k] = c[k].replace('S5E10', 'S' + s + 'E' + e);
  const src = source(), h = harness(src, remote, { title, year: kind === 'movie' ? 2013 : 2011 });
  t.after(() => h.close());
  const config = { ...off, nex: enabled ? 1 : 0 };
  Object.assign(h.ctx, {
    config, pathname, RVA: 'test', SDL_MS: 12000, BF_ENABLED: false, TWBASE: '', RTBASE: '', NEX: null,
    suggName: async () => title,
    findTmdbInfo: () => assert.fail('Nexa-only routes must not start another source mapping chain'),
    cjPFor: () => null, kickSubs: () => {}, twRtPrewarm: () => {}, dtPrewarm: () => {}, nxPrewarm: () => {},
    mlbdOn: () => false, mlsOn: () => false, dtOn: () => false,
    withSources: async (base, sources) => {
      assert.deepEqual(Array.from(sources.filter(x => x.p), x => x.key), enabled ? ['nex'] : []);
      return (await Promise.all(sources.filter(x => x.p).map(x => x.p))).flat();
    },
    withDeadline: p => p, raceObjP: async p => p ? await p : null,
    sendJson: (res, status, body) => { res.writeHead(status, {}); res.end(JSON.stringify(body)); },
  });
  const code = section(src, "    if ((m = p.match(/^\\/stream\\/movie\\/tmdb", '    // ── subtitles-রিসোর্স');
  vm.runInContext('async function route(req,res){const cfg=config,p=pathname;let m;\n' + code + '\n}\nglobalThis.route=route;', h.ctx);
  let finish, fail;
  const sent = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const req = { url: pathname, headers: { host: '3404d3c5dc63-vidy.baby-beamup.club' } };
  const res = { req, __t0: Date.now(), writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { finish({ status: this.status, streams: JSON.parse(String(body)).streams }); } };
  h.ctx.setTimeout(() => fail(new Error('Real route failed to send a response')), 2000);
  await h.ctx.route(req, res);
  return { h, remote, response: await sent };
}
const cases = [
  ['/stream/movie/tmdb49521.json', 'movie', 0, 0],
  ['/stream/movie/tt0770828.json', 'movie', 0, 0],
  ['/stream/series/tmdb1399:5:10.json', 'series', 5, 10],
  ['/stream/series/tmdb1399.json', 'series', 1, 1],
  ['/stream/series/tt0944947:5:10.json', 'series', 5, 10],
  ['/stream/series/tt0944947.json', 'series', 1, 1],
];
for (const [pathname, kind, s, e] of cases) test('card text: real Nexa-only route ' + pathname, async t => {
  const { h, remote, response } = await route(t, pathname, kind, s, e);
  assert.equal(response.status, 200);
  assert.equal(response.streams.length, kind === 'movie' ? 3 : 2);
  assert.equal(h.calls.length, 1);
  assert(h.calls[0].url.includes('/stream/' + kind + '/'));
  if (kind === 'series') assert(h.calls[0].url.endsWith(':' + s + ':' + e + '.json'));
  assert.deepEqual(response.streams.map(c => c.url), remote.filter(c => !c.name.includes('360')).map(c => c.url));
  for (const c of response.streams) {
    assert.match(c.title, /^⧉ (?:Man of Steel \| 2013 \||Game of Thrones \| 2011 \|)/);
    assert.match(c.title, /\n ⌘ Play4u ⌗ Multi • Furiosa$/);
    assert.equal(c.description, c.title);
    assert.equal(c.bingeGroup, 'nex|addon');
    if (kind === 'series') assert(c.title.includes('⏣ S' + s + 'E' + e + " • Mother's Mercy"));
  }
});
test('card text: disabling Nexa on the real route does no remote or local source work', async t => {
  const { h, response } = await route(t, '/stream/movie/tt0770828.json', 'movie', 0, 0, false);
  assert.equal(response.status, 200); assert.deepEqual(response.streams, []); assert.equal(h.calls.length, 0);
});
