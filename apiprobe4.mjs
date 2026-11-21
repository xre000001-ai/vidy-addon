import { fetch as ufetch, ProxyAgent } from 'undici';
import fs from 'node:fs';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const px = '190.12.150.244:999';
const ag = new ProxyAgent('http://' + px);
async function get(u, ms = 15000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 40), body: '' }; }
}
const s = await get(API + '/seed?mediaId=155', 7000);
const seed = JSON.parse(s.body).seed;
console.log('seed ok');
const tests = [
  ['atlanta movie 155 base', { mediaType: 'movie', tmdbId: '155', enc: '2', seed, title: '' }],
  ['atlanta movie 155 title', { mediaType: 'movie', tmdbId: '155', enc: '2', seed, title: 'The Dark Knight' }],
  ['atlanta movie 155 enc1', { mediaType: 'movie', tmdbId: '155', enc: '1', seed, title: '' }],
  ['atlanta movie 278', { mediaType: 'movie', tmdbId: '278', enc: '2', seed, title: '' }],
  ['atlanta movie 603', { mediaType: 'movie', tmdbId: '603', enc: '2', seed, title: '' }],
  ['atlanta tv 1396 s1e1', { mediaType: 'tv', tmdbId: '1396', enc: '2', seed, title: '', season: '1', episode: '1' }],
  ['munich tv 1396 s1e1', { mediaType: 'tv', tmdbId: '1396', enc: '2', seed, title: '', season: '1', episode: '1' }],
];
for (const [name, q] of tests) {
  const srv = name.startsWith('munich') ? 'munich' : 'atlanta';
  const r = await get(API + '/' + srv + '/sources?' + new URLSearchParams(q));
  console.log(name, 'st=' + r.st, r.ms + 'ms', r.err || '', 'body:', r.body.slice(0, 266).replace(/\s+/g, ' '));
}
