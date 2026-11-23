'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, source, plain } = require('./card-helpers.cjs');
const { beforeCardText } = require('./preservation.cjs');
const fixture = require('./fixtures/remote-cards.json');
function open(t, cards = [], opts = {}, src = source()) {
  const h = harness(src, cards, opts); t.after(() => h.close()); return h;
}
const nonText = cards => cards.map(({ name, title, description, ...other }) => other);
const oldWithoutGeneratedLines = cards => cards.map(c => ({ ...c, description: String(c.description || '').split('\n').filter(l => !/^◦ (?:file \d+|Fixture\.\d+\.1080p\.mkv) · (?:v\d+|x26[45])$/.test(l)).join('\n') }));
async function parent(h, type, title, s = 0, e = 0, year = 0) {
  const cards = await h.ingest(type, type === 'movie' ? 'tt0770828' : 'tt0944947', s, e, title);
  await h.unify(cards, { title, type, s, e, year });
  return h.send(cards).streams;
}

test('card text: live child movie retains title, year, real source and server in the Vidy layout', async t => {
  const h = open(t, fixture.movie), cards = await parent(h, 'movie', 'Man of Steel');
  assert.equal(cards.length, 3, 'the existing 720 floor still removes only the 360 card');
  for (const c of cards) {
    assert.equal(c.title, '⧉ Man of Steel | 2013 |\n ⌘ Play4u ⌗ Multi • Furiosa');
    assert.equal(c.description, c.title);
    assert(!c.title.includes('⧠ Movie'));
  }
  assert.deepEqual(cards.map(c => c.name), ['▥ 1080 ▥', '▥ 1080 ▥', '▥ 720 ▥']);
});

test('card text: live child series retains the source year and episode title without another lookup', async t => {
  const h = open(t, fixture.series), cards = await parent(h, 'series', 'Game of Thrones', 5, 10);
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.equal(c.title, "⧉ Game of Thrones | 2011 |\n ⏣ S5E10 • Mother's Mercy\n ⌘ Play4u ⌗ Multi • Furiosa");
    assert.equal(c.description, c.title);
  }
});

test('card text: both 1080 alternatives and all playable fields stay byte-for-byte equivalent to the deployed adapter', async t => {
  for (const [kind, title, s, e] of [['movie', 'Man of Steel', 0, 0], ['series', 'Game of Thrones', 5, 10]]) {
    const now = open(t, fixture[kind]), old = open(t, fixture[kind], {}, beforeCardText('server.js').toString('utf8'));
    const a = await parent(now, kind, title, s, e), b = await parent(old, kind, title, s, e);
    assert.deepEqual(nonText(a), nonText(b));
    assert.deepEqual(a.map(c => c.url), fixture[kind].filter(c => !c.name.includes('360')).map(c => c.url));
    assert.equal(a.filter(c => c.name.includes('1080')).length, b.filter(c => c.name.includes('1080')).length);
    assert.deepEqual(now.calls, old.calls);
    assert(a.every(c => !Object.keys(c).some(k => k.startsWith('_'))));
  }
});

test('card text: remote offloading, path encoding, timeout and disabled-remote semantics are unchanged', async t => {
  const h = open(t, fixture.series);
  await h.ingest('series', 'tt0944947', 5, 10, 'Game of Thrones');
  assert.deepEqual(h.calls, [{ url: 'https://3404d3c5dc63-nexa.baby-beamup.club/stream/series/tt0944947:5:10.json', ms: 9000 }]);
  h.ctx.process.env.NEXA_ADDON = 'off';
  assert.deepEqual(plain(await h.ingest()), []); assert.equal(h.calls.length, 1);
  h.ctx.process.env.NEXA_ADDON = 'https://child.example/custom///';
  await h.ingest('movie', 'id with / slash');
  assert.equal(h.calls[1].url, 'https://child.example/custom/stream/movie/id%20with%20%2F%20slash.json');
});

test('card text: an empty or failed child never invents a card or falls back to a local extractor', async t => {
  for (const options of [{}, { remoteError: true }]) {
    const h = open(t, [], options); assert.deepEqual(plain(await h.ingest()), []); assert.equal(h.calls.length, 1);
  }
});

test('card text: fields that clients use for playback are not consumed or mutated as labels', async t => {
  const child = plain(fixture.movie[0]);
  child.behaviorHints = { notWebReady: true, isBingeable: true, filename: 'Keep.This.1080p.mkv', videoHash: 'abc123', videoSize: 123456, proxyHeaders: { request: { Referer: 'https://play4u.org/', Cookie: 'fixture=only', 'User-Agent': 'player-ua' }, response: { 'Access-Control-Allow-Origin': '*' } } };
  child.bingeGroup = 'nex|original|separate-mirror';
  const snapshot = plain(child), h = open(t, [child]), cards = await parent(h, 'movie', 'Man of Steel');
  assert.deepEqual(child, snapshot); assert.equal(cards[0].url, snapshot.url);
  assert.equal(cards[0].bingeGroup, snapshot.bingeGroup);
  assert.deepEqual(cards[0].behaviorHints, snapshot.behaviorHints);
  assert.equal(cards[0].headers.Cookie, 'fixture=only');
});

test('card text: repeated formatting is idempotent and does not erase or duplicate the Nexa server', t => {
  const h = open(t), c = { _src: 'nex', _srv: 'Furiosa', quality: '1080', bingeGroup: 'nex|addon', url: 'https://remote.example/t/a', title: fixture.movie[0].title, description: fixture.movie[0].title };
  h.format([c]); const once = plain(c); h.format([c]); h.format([c]);
  assert.deepEqual(c, once); assert.equal(c.title, fixture.movie[0].title);
});

test('card text: a formatted child without private server metadata can retain its declared server label', t => {
  const h = open(t), c = { _src: 'nex', quality: '1080', bingeGroup: 'nex|addon', url: 'https://remote.example/t/a', title: fixture.movie[0].title, description: fixture.movie[0].title };
  h.format([c]); assert.equal(c.title, fixture.movie[0].title);
});

test('card text: old Nexa quality lines are skipped, but real Nexa source lines are not discarded', t => {
  const h = open(t), c = { _src: 'nex', quality: '1080', bingeGroup: 'nex|old', url: 'https://remote.example/play.m3u8', description: '⧉ Inception | 2010 |\n⧠ Movie\n⊞ nexa ⌗ English' };
  h.format([c]); assert.equal(c.title, '⧉ Inception | 2010 |\n ⌘ nexa ⌗ English');
  const legacy = { _src: 'nex', quality: '1080', bingeGroup: 'nex|old', url: c.url, description: '▤ Inception (2010)\n▦ nova · 1920x1080 ♫ English\n⊞ nexa ◇ 1080p' };
  h.format([legacy]); assert.equal(legacy.title, '⧉ Inception | 2010 |\n ⌘ Nova ⌗ English');
});

test('card text: incomplete or wrong-episode child cards still use the existing main-addon metadata fallback', async t => {
  for (const txt of ['unstructured text', '⧉ Game of Thrones | 2011 |\n ⌘ Play4u ⌗ English', '⧉ Game of Thrones | 2011 |\n ⏣ S1E1 • Wrong episode\n ⌘ Play4u ⌗ English']) {
    const c = { ...plain(fixture.series[0]), title: txt, description: txt }, h = open(t, [c]);
    const cards = await parent(h, 'series', 'Game of Thrones', 5, 10, 2011);
    assert.match(cards[0].title, /^⧉ Game of Thrones \| 2011 \|\n ⏣ S5E10\n ⌘ /);
    assert(!cards[0].title.includes('Wrong episode'));
  }
});

test('card text: missing year can be filled by existing metadata without replacing a real child year', async t => {
  for (const [input, expected] of [['⧉ Man of Steel |', '2013'], ['⧉ Man of Steel | 2012 |', '2012']]) {
    const c = { ...plain(fixture.movie[0]), title: input + '\n ⌘ Play4u ⌗ Multi • Furiosa', description: input + '\n ⌘ Play4u ⌗ Multi • Furiosa' };
    const h = open(t, [c]), cards = await parent(h, 'movie', 'Man of Steel', 0, 0, 2013);
    assert.match(cards[0].title, new RegExp('^⧉ Man of Steel \\| ' + expected + ' \\|'));
  }
});

test('card text: only an actual placeholder title is filled; real Nexa-prefixed titles and literal dollar signs are safe', async t => {
  const known = { ...plain(fixture.movie[0]), title: '⧉ Nexa: A Story | 2013 |\n ⌘ Play4u ⌗ English • Furiosa' };
  const h = open(t, [known]); const a = await h.ingest('movie', 'tt0770828', 0, 0, 'Other metadata');
  assert.match(a[0].title, /^⧉ Nexa: A Story \|/);
  const placeholder = { ...known, title: '⧉ nexa |\n ⌘ Play4u ⌗ English • Furiosa' };
  const h2 = open(t, [placeholder]); const b = await h2.ingest('movie', 'tt0770828', 0, 0, 'The $& Story');
  assert.equal(b[0].title, '⧉ The $& Story |\n ⌘ Play4u ⌗ English • Furiosa');
});

function alternatives() {
  const groups = ['vidy', 'nx', 'tw', 'rt', 'mm', 'm4u', 'sky', 'hm', 'hd', 'bf', 'vsp', 'ott', 'az', 'mlb', 'mls', 'dt', 'nex', 'cj'];
  return groups.flatMap((g, groupIndex) => [0, 1, 2].map(i => ({
    name: '▥ 1080 ▥', quality: '1080',
    title: '⧉ V1 Murder Case | 2019 |\n ⌘ ' + (g === 'nex' ? 'Play4u' : g) + ' ⌗ English',
    description: '⧉ V1 Murder Case | 2019 |\n ⌘ ' + (g === 'nex' ? 'Play4u' : g) + ' ⌗ English',
    bingeGroup: g + '|fixture-' + i, url: 'https://media.example/' + groupIndex + '/' + i + '.mkv?sig=a%2Fb&mirror=' + i,
    behaviorHints: { filename: i === 2 ? 'Fixture.' + i + '.1080p.mkv' : 'Fixture.' + i + '.1080p.mkv', videoSize: 1000 + i, notWebReady: true, proxyHeaders: { request: { Referer: 'https://source.example/' } } },
  })));
}
test('card text: filename and generated v1/v2 clutter disappear for every source without deleting alternatives', t => {
  const cards = alternatives(), h = open(t), original = plain(cards), out = h.send(cards).streams;
  assert.equal(out.length, 54);
  for (let i = 0; i < out.length; i++) {
    assert.equal(out[i].url, original[i].url); assert.equal(out[i].bingeGroup, original[i].bingeGroup);
    assert.deepEqual(out[i].behaviorHints, original[i].behaviorHints);
    assert(!/◦ |\bfile \d+|· v\d+/.test(out[i].description));
    assert(!out[i].description.includes('.mkv'));
    assert(out[i].title.includes('V1 Murder Case'), 'do not strip genuine title words');
  }
});

test('card text: unrelated cards differ only by removing the old generated description line, with no reordering or new field changes', t => {
  const now = open(t), old = open(t, [], {}, beforeCardText('server.js').toString('utf8'));
  const a = now.send(alternatives()).streams, b = old.send(alternatives()).streams;
  const expected = oldWithoutGeneratedLines(b);
  // This later source review separately authorizes only the full HM/HD labels.
  // Keep the complete card/order comparison, plus the independent non-text one.
  for (const c of expected) for (const field of ['title', 'description']) {
    if (/^hm\|/.test(c.bingeGroup)) c[field] = c[field].replace(/⌘ Hm(?= ⌗| •|$)/g, '⌘ HindMovie');
    if (/^hd\|/.test(c.bingeGroup)) c[field] = c[field].replace(/⌘ Hd(?= ⌗| •|$)/g, '⌘ HDHub4u');
  }
  assert.deepEqual(a, expected);
  assert.deepEqual(nonText(a), nonText(b));
});

test('card text: genuine notes, season-pack warnings, and behaviorHints filenames are not blanket-stripped', t => {
  const h = open(t), cs = alternatives().slice(0, 3);
  for (const c of cs) c.description += '\nⓘ Full season in one file — starts at Ep 1\n◦ Manual playback note';
  const out = h.send(cs).streams;
  for (const c of out) {
    assert(c.title.includes('ⓘ Full season in one file — starts at Ep 1'));
    assert(c.title.includes('◦ Manual playback note'));
    assert(c.description.includes('◦ Manual playback note'));
    assert.equal((c.description.match(/◦ Manual playback note/g) || []).length, 1);
    assert(c.behaviorHints.filename.endsWith('.mkv'));
    assert(!/◦ Fixture\./.test(c.description));
  }
});

test('card text: the existing numeric sub-720 floor, unknown/Auto quality and all high-quality mirrors retain their old behavior', t => {
  const now = open(t), old = open(t, [], {}, beforeCardText('server.js').toString('utf8'));
  const cs = [240, 360, 480, 720, 1080, 2160, 0].map(q => ({ name: '▥ ' + (q || 'Auto') + ' ▥', quality: String(q || ''), title: '⧉ Example | 2020 |\n ⌘ Example ⌗ English', description: '⧉ Example | 2020 |\n ⌘ Example ⌗ English', bingeGroup: 'example|' + q, url: 'https://media.example/' + q + '.m3u8', behaviorHints: { notWebReady: false } }));
  const a = now.send(plain(cs)).streams, b = old.send(plain(cs)).streams;
  assert.deepEqual(a, b); assert.deepEqual(a.map(c => c.name), ['▥ 720 ▥', '▥ 1080 ▥', '▥ 2160 ▥', '▥ Auto ▥']);
});
