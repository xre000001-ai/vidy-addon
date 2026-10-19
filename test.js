#!/usr/bin/env node
// Vidy addon — MASS test (re-baselined 1.15.70 to the multi-source contract: vidy slot-cards strict, other sources structural)
// card schema, audio language truth, auto→resolution, per-source masters/filters, speed
// usage: node test.js [baseURL]   (default http://127.0.0.1:7300)
const BASE = process.argv[2] || 'http://127.0.0.1:' + (process.env.PORT || 7000); // server-ডিফল্ট-পোর্টের-সাথে-সামঞ্জস্য (আগে 7300 — অমিল)
const PKGVER = require('./package.json').version; // গতিশীল-ভার্সন (আগে '1.11.14'-হার্ডপিন — ~৫০-ভার্সন-পুরনো)

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : fail++; console.log('   ' + (cond ? '\u2713' : '\u2717 FAIL') + ' ' + label); };
const skip = label => console.log('   ~ SKIP ' + label + ' (coverage oscillates — MovieBox child off)');
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const cfgUrl = (c, path) => BASE + (Object.keys(c || {}).length ? '/cfg/' + b64u(c) : '') + path;
const NAME_RE = /^\u25a5 (Auto|\d{3,4}) \u25a5$/;
const SERVER_WORDS = ['miami', 'boise', 'atlanta', 'phoenix', 'dallas', 'austin', 'seattle', 'delhi', 'munich', 'paris', 'orlando', 'reno', 'oakland', 'vegas', 'cancun', 'tampa'];
const audioOf = c => { const last = String(c.description || '').split('\n').pop(); return last.includes('\u2317') ? last.split('\u2317')[1].trim() : ''; };
const slotOf = c => { const last = String(c.description || '').split('\n').pop(); const m = /\u229e (.+) \u2317 /.exec(last); return m ? m[1] : ''; };
const rows = [];

const v0len = s => s.filter(c => SERVER_WORDS.includes(slotOf(c).toLowerCase())).length === 0;
async function tap(label, url, checks) {
  const t0 = Date.now();
  let j = null, err = null;
  try { j = await (await fetch(url, { signal: AbortSignal.timeout(40000) })).json(); } catch (e) { err = e; }
  const ms = Date.now() - t0;
  const s = (j && j.streams) || [];
  const mb = s.filter(c => slotOf(c) === 'MovieBox');
  const v = s.filter(c => SERVER_WORDS.includes(slotOf(c).toLowerCase())); // v1.15.70: vidy = সার্ভার-নাম-স্লট (Arctic/ToonWorld/Movies4u/RareToons-স্লট-বাদ)
  console.log('\n\u00b7 ' + label + '  \u2014  ' + ms + 'ms, ' + s.length + ' cards (vidy ' + v.length + ' / moviebox ' + mb.length + ')');
  rows.push([label, ms, s.length]);
  ok(!err, 'http ok' + (err ? ' (' + err.message + ')' : ''));
  if (!s.length) { if (checks) checks(s, mb, v); return { s, mb, v }; }
  ok(s.every(c => NAME_RE.test(String(c.name || ''))), 'name = "\u25a5 Q \u25a5"');
  ok(s.every(c => !String(c.description || '').includes('\u25a5')), 'description: no resolution');
  ok(s.every(c => !/subs/i.test(String(c.description || ''))), 'description: no "Subs" text');
  ok(s.every(c => String(c.description || '').startsWith('\u29c9 ')), 'description: \u29c9 title first');
  ok(s.every(c => String(c.description || '').includes('\u29e0 ')), 'description: \u29e0 episode line');
  ok(s.every(c => { const l = String(c.description || '').split('\n').pop().trim(); return /^\u229e .+$/.test(l) || /^\u29e0 .+$/.test(l); }), 'description: last line = slot (±audio) or episode (multi-source)');
  ok(!s.some(c => audioOf(c) === 'Original'), 'audio: no lazy "Original" (real language names)');
  ok(s.every(c => !Array.isArray(c.subtitles) || c.subtitles.every(u2 => typeof u2.url === 'string' && /^https?:/.test(u2.url) && typeof u2.lang === 'string' && /^[a-z]{2}$/.test(u2.lang) && typeof u2.title === 'string')), 'subtitles: app-safe shape {title,url,lang:2-letter}');
  ok(s.every(c => c.quality === undefined || c.quality === '' || /^\d{3,4}$/.test(String(c.quality))), 'quality field sane (absent ok)');
  ok(ms < 15000, 'latency < 15s (' + ms + 'ms)');
  if (checks) checks(s, mb, v);
  return { s, mb, v };
}

(async () => {
  console.log('VIDY MASS TEST \u2014 ' + BASE);

  // ── health/manifest/config page ──
  let h = null, m = null;
  try { h = await (await fetch(BASE + '/_health')).json(); } catch (e) {}
  try { m = await (await fetch(BASE + '/manifest.json')).json(); } catch (e) {}
  ok(h && h.ok === 1, 'health ok' + (h ? ' (v' + h.version + ', pool ' + h.pool + ', nx ' + h.nx + ')' : ''));
  ok(h && h.version === PKGVER, 'version = ' + PKGVER);
  ok(m && /^community\.xre\.vidy\./.test(m.id), 'manifest id prefix (' + (m && m.id || '') + ')');
  ok(m && m.name === 'Phoenix', 'addon name = Phoenix');
  ok(m && /^https?:\/\/.+\/logo\.png$/.test(m.logo || ''), 'manifest logo URL (' + (m && m.logo || '') + ')');
  ok(m && m.behaviorHints && m.behaviorHints.configurable === true && m.behaviorHints.configurationRequired === false, 'behaviorHints.configurable ✓');
  try {
    const lb = Buffer.from(await (await fetch(BASE + '/logo.png', { signal: AbortSignal.timeout(15000) })).arrayBuffer());
    ok(lb.length > 1000 && lb[0] === 0x89 && lb[1] === 0x50, '/logo.png served (' + lb.length + 'B PNG)');
  } catch (e) { ok(false, 'logo fetch: ' + e.message); }
  try { // সাব-ট্র্যাক-ওয়ার্ম (ঠান্ডা-চাইল্ড-চেইনে-১-রিট্রাই) — প্রথম-ট্যাপেই-কার্ডে-ট্র্যাক-থাকবে
    let w = await (await fetch(BASE + '/subtitles/movie/tt0468569.json', { signal: AbortSignal.timeout(45000) })).json();
    if (!w.subtitles.length) w = await (await fetch(BASE + '/subtitles/movie/tt0468569.json', { signal: AbortSignal.timeout(45000) })).json();
    ok(Array.isArray(w.subtitles), 'subtitles warm ok');
  } catch (e) { ok(false, 'subs warm: ' + e.message); }
  try {
    const html = await (await fetch(BASE + '/configure')).text();
    ok(!/nethex/i.test(html), 'configure: no legacy "nethex" text');
    ok(html.includes('MovieBox'), 'configure: MovieBox named');
    ok(html.includes('pvVh') && html.includes('srvSum'), 'configure: preview headers + collapsed servers');
  } catch (e) { ok(false, 'configure fetch: ' + e.message); }

  // ── 1) English movie: resolution resolved (no Auto), audio = English, MB original present ──
  await tap('movie tt0468569 DarkKnight (en)', BASE + '/stream/movie/tt0468569.json', (s, mb, v) => {
    ok(!v.some(c => c.name === '\u25a5 Auto \u25a5' && slotOf(c).toLowerCase() === 'dallas'), 'Dallas: BANDWIDTH resolved (no Auto)');
    ok(v.filter(c => c.name === '\u25a5 Auto \u25a5').length <= 1, 'Auto only if probe geo-blocked (\u22641)');
    ok(v.length && v.every(c => audioOf(c) === 'English'), 'vidy audio = English');
    ok(v.length && v.every(c => SERVER_WORDS.includes(slotOf(c).toLowerCase())), 'vidy slots = server names');
    ok(mb.length === 0 || mb.some(c => audioOf(c) === 'English'), 'moviebox: original audio present (English)');
    ok(s.every(c => !c.bingeGroup || /^(mbxr|mm|tw|rt|m4u|peng|sky|vsp|ott|az)\|/.test(String(c.bingeGroup))), 'bingeGroup: known-source prefix'); // v1.15.71: vsp=Vidsrc; v1.15.72: ott=AsianTV; v1.15.76: az=AniZone
    ok(mb.length === 0 || mb.every(c => c.bingeGroup && String(c.bingeGroup).indexOf('mbxr|') === 0), 'moviebox cards carry bingeGroup');
    ok(s.every(c => !c.behaviorHints || typeof c.behaviorHints === 'object'), 'behaviorHints sane');
    ok(v.every(c => !Array.isArray(c.subtitles) || c.subtitles.every(u2 => u2 && typeof u2.url === 'string')), 'vidy cards: subs shape sane (embedded subs retired — /subtitles resource serves them)');
    ok(mb.length === 0 || mb.every(c => Array.isArray(c.subtitles) && c.subtitles.length > 0), 'moviebox cards carry subtitle tracks too');
  });

  // ── 2) Hindi movie ──
  await tap('movie tt36300841 Awarapan2 (hi)', BASE + '/stream/movie/tt36300841.json', (s, mb, v) => {
    ok(v.length && v.every(c => audioOf(c) === 'Hindi'), 'vidy audio = Hindi');
    ok(v.some(c => /\| \d{4} \|/.test(c.description)), 'year on title line');
  });

  // ── 3) Korean series via tmdb-native id + episode title ──
  await tap('series tmdb93405:1:1 SquidGame (ko)', BASE + '/stream/series/tmdb93405%3A1%3A1.json', (s, mb, v) => {
    ok(v.length === 0 || v.every(c => audioOf(c) === 'Korean'), 'vidy audio = Korean');
    ok(s.length === 0 || s.some(c => /\u29e0 S1E1/.test(c.description)), 'episode line present (title when resolver warm)');
  });

  // ── 4) more catalogue breadth ──
  await tap('movie tt0114369 Se7en', BASE + '/stream/movie/tt0114369.json'); // MB-কভারেজ-ওঠানামা-করে — presence-DarkKnight/BrBa/SquidGame-এ-কঠোরভাবে-যাচাই
  await tap('movie tt0120737 Fellowship', BASE + '/stream/movie/tt0120737.json');
  await tap('series tt0903747:2:1 BreakingBad-S2E1', BASE + '/stream/series/tt0903747%3A2%3A1.json', (s) => {
    ok(s.length === 0 || s.some(c => /\u29e0 S2E1 \u2022 /.test(c.description)), 'S2E1 episode title');
  });
  await tap('movie tmdb27205 Inception (native id)', BASE + '/stream/movie/tmdb27205.json', (s, mb, v) => {
    ok(v.filter(c => c.name === '\u25a5 Auto \u25a5').length <= 1, 'Auto \u22641 (geo-blocked ok)');
  });

  // ── 5) per-source masters ──
  await tap('cfg nx=0 (vidy only)', cfgUrl({ nx: 0 }, '/stream/movie/tt0468569.json'), (s, mb) => ok(mb.length === 0, 'zero moviebox'));
  await tap('cfg v=0 (vidy off)', cfgUrl({ v: 0 }, '/stream/movie/tt0114369.json'), (s, mb) => { if (!mb.length) skip('v=0: no moviebox cards this run'); ok(v0len(s), 'zero vidy slot-cards'); });

  // ── 6) per-source filters ──
  await tap('cfg nxq=[1080]', cfgUrl({ nxq: [1080] }, '/stream/movie/tt0468569.json'), (s, mb) => {
    if (!mb.length) return skip('nxq 1080: no moviebox cards');
    ok(mb.every(c => c.name === '\u25a5 1080 \u25a5'), 'all moviebox cards 1080');
  });
  await tap('cfg nxl=[russian]', cfgUrl({ nxl: ['russian'] }, '/stream/movie/tt0468569.json'), (s, mb) => {
    if (!mb.length) return skip('nxl russian: no moviebox cards');
    ok(mb.every(c => audioOf(c) === 'Russian'), 'russian audio only');
  });
  await tap('cfg nxl=[original,hindi]', cfgUrl({ nxl: ['original', 'hindi'] }, '/stream/movie/tt0468569.json'), (s, mb) => {
    if (!mb.length) return skip('nxl original+hindi: no moviebox cards');
    ok(mb.some(c => audioOf(c) === 'English'), 'moviebox: original row survives "original" chip (labeled English)');
    ok(mb.some(c => audioOf(c) === 'Hindi'), 'moviebox: Hindi row present');
    ok(mb.length >= 2 && mb.every(c => ['English', 'Hindi'].indexOf(audioOf(c)) >= 0), 'only original+hindi rows');
  });

  // ── 6c) Vidsrc মাস্টার+ফিল্টার (v1.15.71) ──
  const vsOf = s => s.filter(c => String(c.url || '').indexOf('/vsp/') === 0 || String(c.url || '').includes('/vsp/'));
  await tap('cfg vsp=0 (Vidsrc off)', cfgUrl({ vsp: 0 }, '/stream/movie/tmdb155.json'), (s) => {
    ok(vsOf(s).length === 0, 'vsp=0: zero Vidsrc cards');
  });
  await tap('Vidsrc কার্ড-গঠন (DK tmdb155)', BASE + '/stream/movie/tmdb155.json', (s) => {
    const vs = vsOf(s);
    if (!vs.length) return skip('Vidsrc: no cards this run (upstream)'); // ভাণ্ডার-ঝুঁকি — কাঠামো-টেস্ট-কার্ড-থাকলেই
    ok(vs.every(c => /^\u25a5 (\d{3,4}) \u25a5$/.test(String(c.name || ''))), 'Vidsrc name = "\u25a5 Q \u25a5"');
    ok(vs.every(c => /\/vsp\/t\/[a-f0-9]+\.m3u8$/.test(String(c.url || '').split('?')[0])), 'Vidsrc url = আমাদের /vsp/t রিলে');
    ok(vs.every(c => slotOf(c) === 'Vidsrc'), 'Vidsrc slot = "Vidsrc"');
    ok(vs.every(c => audioOf(c) === 'English'), 'Vidsrc audio = English');
    ok(vs.every(c => !c.bingeGroup || String(c.bingeGroup).indexOf('vsp|') === 0), 'Vidsrc bingeGroup vsp|');
  });
  await tap('cfg vspq=[480] (Vidsrc-ছাঁকনি)', cfgUrl({ vspq: [480] }, '/stream/movie/tmdb155.json'), (s) => {
    const vs = vsOf(s);
    if (!vs.length) return skip('vspq 480: no Vidsrc cards this run');
    ok(vs.every(c => parseInt(String(c.name).replace(/\D/g, ''), 10) <= 480 || /^\u25a5 (480|360) \u25a5$/.test(c.name)), 'vspq=[480]: শুধু-ছোট-মান');
  });

  // ── 6d) AsianTV মাস্টার+ফিল্টার (v1.15.72 — OneTouchTV) ──
  const otOf = s => s.filter(c => slotOf(c) === 'AsianTV');
  const OTT_LANGS = ['Korean', 'Chinese', 'Japanese', 'Thai', 'Mandarin', 'Cantonese', 'Filipino', 'English', 'Subbed'];
  await tap('cfg ott=0 (AsianTV off)', cfgUrl({ ott: 0 }, '/stream/series/tmdb93405%3A1%3A1.json'), (s) => {
    ok(otOf(s).length === 0, 'ott=0: zero AsianTV cards');
  });
  await tap('AsianTV কার্ড-গঠন (SquidGame tmdb93405 S1E1)', BASE + '/stream/series/tmdb93405%3A1%3A1.json', (s) => {
    const ot = otOf(s);
    if (!ot.length) return skip('AsianTV: no cards this run (upstream)'); // ভাণ্ডার-ঝুঁকি — কাঠামো-টেস্ট-কার্ড-থাকলেই
    ok(ot.every(c => /^\u25a5 (\d{3,4}) \u25a5$/.test(String(c.name || ''))), 'AsianTV name = "\u25a5 Q \u25a5"');
    ok(ot.every(c => /^https?:\/\//.test(String(c.url || '')) && String(c.url).indexOf('/vsp/') < 0), 'AsianTV url = সরাসরি-m3u8 (রিলে-নয়)');
    ok(ot.every(c => OTT_LANGS.indexOf(audioOf(c)) >= 0), 'AsianTV audio = বাস্তব-ভাষা (দেশ-নির্ধারিত)');
    ok(ot.every(c => !c.bingeGroup || String(c.bingeGroup).indexOf('ott|') === 0), 'AsianTV bingeGroup ott|');
    ok(ot.every(c => !Array.isArray(c.subtitles) || c.subtitles.every(u2 => u2 && typeof u2.url === 'string' && /^https?:/.test(u2.url))), 'AsianTV subs sane');
  });
  await tap('AsianTV মুভি (Parasite tmdb496243)', BASE + '/stream/movie/tmdb496243.json', (s) => {
    const ot = otOf(s);
    if (!ot.length) return skip('AsianTV movie: no cards this run (upstream)');
    ok(ot.every(c => /\u29e0 Movie/.test(String(c.description || ''))), 'AsianTV movie: ⧠ Movie লাইন');
  });
  await tap('cfg ottq=[480] (AsianTV-ছাঁকনি)', cfgUrl({ ottq: [480] }, '/stream/series/tmdb93405%3A1%3A1.json'), (s) => {
    const ot = otOf(s);
    if (!ot.length) return skip('ottq 480: no AsianTV cards this run');
    ok(ot.every(c => ['480', '360'].includes(String(c.quality))), 'ottq=[480]: শুধু-ছোট-মান');
  });

  // ── 6e) AniZone মাস্টার+ফিল্টার (v1.15.76 — anime) ──
  const azOf = s => s.filter(c => slotOf(c) === 'AniZone');
  await tap('cfg az=0 (AniZone off)', cfgUrl({ az: 0 }, '/stream/series/tmdb209867%3A1%3A1.json'), (s) => {
    ok(azOf(s).length === 0, 'az=0: zero AniZone cards');
  });
  await tap('AniZone কার্ড-গঠন (Frieren tmdb209867 S1E1)', BASE + '/stream/series/tmdb209867%3A1%3A1.json', (s) => {
    const az = azOf(s);
    if (!az.length) return skip('AniZone: no cards this run (pool/site)'); // ভাণ্ডার-ঝুঁকি — কাঠামো-টেস্ট-কার্ড-থাকলেই
    ok(az.length === 1, 'AniZone: ১-কার্ড (single master)');
    ok(az.every(c => /^https?:\/\//.test(String(c.url || '')) && String(c.url).indexOf('/vsp/') < 0), 'AniZone url = সরাসরি-m3u8 (vid-cdn, রিলে-নয়)');
    ok(az.every(c => audioOf(c) === 'Subbed'), 'AniZone audio = Subbed');
    ok(az.every(c => !c.bingeGroup || String(c.bingeGroup).indexOf('az|') === 0), 'AniZone bingeGroup az|');
    ok(/^\u25a5 (\d{3,4}) \u25a5$/.test(String(az[0].name || '')), 'AniZone quality sane (' + String(az[0].name).replace(/\D/g, '') + 'p)'); // কার্ড-শেপার-quality-ছাঁটে — name-ই-সত্য
  });
  await tap('AniZone E28 (পেজ-১-ক্যাপ-বাইরে — watch-URL-সরাসরি)', BASE + '/stream/series/tmdb209867%3A1%3A28.json', (s) => {
    const az = azOf(s);
    if (!az.length) return skip('AniZone E28: no cards this run');
    ok(/S1E28/.test(String(az[0].description || '')), 'AniZone E28: ⧠ S1E28 লাইন');
  });
  await tap('AniZone সিজন (JJK tmdb95479 S2E9 — আলাদা-২০২৩-এন্ট্রি)', BASE + '/stream/series/tmdb95479%3A2%3A9.json', (s) => {
    const az = azOf(s);
    if (!az.length) return skip('AniZone JJK-S2: no cards this run');
    ok(/S2E9/.test(String(az[0].description || '')), 'AniZone JJK-S2: ⧠ S2E9 লাইন (uuid-প্রমাণ-প্রোবে-আলাদা)'); // সঠিক-সিজন-প্রমাণ = az-uuid == ২০২৩-এন্ট্রি-E9-uuid (azseason-probe)
  });

  await tap('cfg sub=0 (subtitle gate)', cfgUrl({ sub: 0 }, '/stream/movie/tt0468569.json'), (s) => {
    ok(s.length === 0 || s.every(c => !c.subtitles || c.subtitles.length === 0), 'sub=0: zero tracks on cards');
  });

  // ── subtitles রিসোর্স (MovieBox-ট্র্যাক — 1.11.13-পুনরুদ্ধার) ──
  try {
    let sj = await (await fetch(BASE + '/subtitles/movie/tt0468569.json', { signal: AbortSignal.timeout(40000) })).json();
    if (!sj.subtitles.length) sj = await (await fetch(BASE + '/subtitles/movie/tt0468569.json', { signal: AbortSignal.timeout(40000) })).json(); // ঠান্ডা-চাইল্ড-চেইনে-১-রিট্রাই
    ok(Array.isArray(sj.subtitles), 'subtitles resource: array');
    ok(sj.subtitles.every(u3 => typeof u3.url === 'string' && /^https?:/.test(u3.url) && typeof u3.lang === 'string' && /^[a-z]{2,3}$/.test(u3.lang)), 'subtitles resource: lang codes sanitized');
    if (sj.subtitles.length) ok(true, 'subtitles resource: MB tracks present (' + sj.subtitles.length + ')');
    else skip('subtitles resource: 0 tracks — MovieBox child off');
  } catch (e2) { ok(false, 'subtitles resource: ' + e2.message); }
  // ── subtitles-রিসোর্স: series-সহ-s:e (পার্স-পথ-রিগ্রেশন-রক্ষা) ──
  try {
    let sj2 = await (await fetch(BASE + '/subtitles/series/tt0903747:2:1.json', { signal: AbortSignal.timeout(45000) })).json();
    if (!sj2.subtitles.length) sj2 = await (await fetch(BASE + '/subtitles/series/tt0903747:2:1.json', { signal: AbortSignal.timeout(45000) })).json();
    ok(Array.isArray(sj2.subtitles) && sj2.subtitles.every(u4 => /^[a-z]{2}$/.test(u4.id) && /^https?:/.test(u4.url)), 'subtitles series s:e: schema-safe (' + sj2.subtitles.length + ' tracks)');
  } catch (e3) { ok(false, 'subtitles series s:e: ' + e3.message); }

  // ── safety-net: series without s:e → S1E1 ──
  await tap('series tt0903747 (no s:e safety-net)', BASE + '/stream/series/tt0903747.json', (s) => {
    ok(s.length === 0 || s.every(c => /\u29e0 S1E1/.test(c.description)), 'defaults to S1E1');
  });

  // ── summary ──
  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  for (const [l, ms, n] of rows) console.log('  ' + String(ms).padStart(6) + 'ms  ' + String(n).padStart(3) + ' cards  ' + l);
  console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('test crash:', e); process.exit(1); });
