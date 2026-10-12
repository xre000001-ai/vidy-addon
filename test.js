#!/usr/bin/env node
// Vidy addon — smoke + card-schema + speed test
// usage: node test.js [baseURL]   (default http://127.0.0.1:7300)
//        every stream tap is timed; every card is schema-checked:
//          name  : "▥ Q ▥" (Q = 360|480|720|1080|2160|Auto)
//          descr : "⧉ Title | YYYY |" / "⧠ SsEe[ • EpTitle]" / "⊞ Slot ⌗ Audio"
//                  (no resolution inside the description, no "Subs" text)
const BASE = process.argv[2] || 'http://127.0.0.1:' + (process.env.PORT || 7300);

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : fail++; console.log('   ' + (cond ? '\u2713' : '\u2717 FAIL') + ' ' + label); };
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const cfgUrl = (c, path) => BASE + (Object.keys(c || {}).length ? '/cfg/' + b64u(c) : '') + path;
const NAME_RE = /^\u25a5 (Auto|\d{3,4}) \u25a5$/; // যেকোনো-বাস্তব-উচ্চতা-সংখ্যা (800-ও-বৈধ) অথবা Auto
const SERVER_WORDS = ['miami', 'boise', 'atlanta', 'phoenix', 'dallas', 'austin', 'seattle', 'delhi', 'munich', 'paris', 'orlando', 'reno', 'oakland', 'vegas', 'cancun', 'tampa'];
const rows = [];

async function tap(label, url, extra) {
  const t0 = Date.now();
  let j = null, err = null;
  try { j = await (await fetch(url, { signal: AbortSignal.timeout(35000) })).json(); } catch (e) { err = e; }
  const ms = Date.now() - t0;
  const s = (j && j.streams) || [];
  const mb = s.filter(c => String(c.description || '').includes('MovieBox'));
  console.log('\n\u00b7 ' + label + '  \u2014  ' + ms + 'ms, ' + s.length + ' cards (vidy ' + (s.length - mb.length) + ' / moviebox ' + mb.length + ')');
  rows.push([label, ms, s.length]);
  ok(!err, 'http ok' + (err ? ' (' + err.message + ')' : ''));
  if (!s.length) return { s, mb };
  ok(s.every(c => NAME_RE.test(String(c.name || ''))), 'name = "\u25a5 Q \u25a5" on every card');
  ok(s.every(c => !String(c.description || '').includes('\u25a5')), 'description has NO resolution');
  ok(s.every(c => !/subs/i.test(String(c.description || ''))), 'description has NO "Subs" text');
  ok(s.every(c => /^(\u29c9 .+ (\| \d{4} \| )?)?/.test('') || String(c.description || '').startsWith('\u29c9 ')), 'description starts with \u29c9 title');
  ok(s.every(c => String(c.description || '').includes('\u29e0 ')), 'description has \u29e0 episode line');
  ok(s.every(c => /\u229e .+ \u2317 /.test(String(c.description || '').split('\n').pop())), 'last line = "\u229e slot \u2317 audio"');
  if (extra) extra(s, mb);
  return { s, mb };
}

(async () => {
  console.log('VIDY ADDON TEST \u2014 ' + BASE);

  // 0) health + manifest
  let h = null, m = null;
  try { h = await (await fetch(BASE + '/_health')).json(); } catch (e) {}
  try { m = await (await fetch(BASE + '/manifest.json')).json(); } catch (e) {}
  ok(h && h.ok === 1, 'health ok' + (h ? ' (v' + h.version + ', pool ' + h.pool + ')' : ''));
  ok(h && h.version === '1.11.7', 'version = 1.11.7');
  ok(m && m.id === 'community.xre.vidy', 'manifest id');

  // 1) movie (tt)
  await tap('movie tt0468569 (Dark Knight)', BASE + '/stream/movie/tt0468569.json', (s, mb) => {
    const slots = s.filter(c => !mb.includes(c)).map(c => String(c.description).split('\n').pop().split(' ')[1].toLowerCase());
    ok(slots.every(w => SERVER_WORDS.includes(w)), 'vidy slot = server names only (no "Vidy" text)');
    ok(mb.length > 0, 'MovieBox cards present');
  });

  // 2) series (tt) — episode title expected
  await tap('series tt1553656:1:1', BASE + '/stream/series/tt1553656%3A1%3A1.json', (s) => {
    ok(s.some(c => /\u29e0 S1E1 \u2022 /.test(c.description || '')), 'episode title after "S1E1 \u2022"');
    ok(s.some(c => /\| \d{4} \|/.test(c.description || '')), 'year on the title line');
  });

  // 3) movie (tmdb-native id)
  await tap('movie tmdb27205 (native id)', BASE + '/stream/movie/tmdb27205.json');

  // 4) per-source masters
  await tap('cfg nx=0 (vidy only)', cfgUrl({ nx: 0 }, '/stream/movie/tt0468569.json'), (s, mb) => ok(mb.length === 0, 'zero MovieBox cards'));
  await tap('cfg v=0 (MovieBox only)', cfgUrl({ v: 0 }, '/stream/movie/tt0114369.json'), (s, mb) => {
    ok(mb.length > 0 && mb.length === s.length, 'every card is MovieBox');
  });

  // 5) per-source filters
  await tap('cfg nxq=[1080] (moviebox 1080 only)', cfgUrl({ nxq: [1080] }, '/stream/movie/tt0468569.json'), (s, mb) => {
    ok(mb.length > 0 && mb.every(c => /^▥ 1080 ▥$/.test(c.name)), 'all MovieBox cards 1080');
    ok(mb.length < 4 || mb.length <= 6, 'filter narrowed the list');
  });
  await tap('cfg nxl=[russian] (moviebox audio filter)', cfgUrl({ nxl: ['russian'] }, '/stream/movie/tt0110912.json'), (s, mb) => {
    ok(mb.length >= 1, 'russian card present');
    ok(mb.every(c => /Russian/i.test(String(c.description).split('\n').pop())), 'audio line says Russian');
  });

  // summary
  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  for (const [l, ms, n] of rows) console.log('  ' + String(ms).padStart(6) + 'ms  ' + String(n).padStart(3) + ' cards  ' + l);
  console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('test crash:', e); process.exit(1); });
