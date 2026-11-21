import { fetch as ufetch, ProxyAgent } from 'undici';
import fs from 'node:fs';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const px = '190.12.150.244:999';
const ag = new ProxyAgent('http://' + px);
async function get(u, ms = 16000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 40), body: '' }; }
}
async function seedFor(id) { const s = await get(API + '/seed?mediaId=' + id, 8000); try { return JSON.parse(s.body).seed || ''; } catch (e) { return ''; } }
const movies = [['155','Dark Knight'],['278','Shawshank'],['603','Matrix'],['238','Godfather'],['680','Pulp Fiction'],['27205','Inception'],['693134','Dune 2'],['157336','Interstellar'],['550','Fight Club'],['120','LOTR FOTR']];
for (const [id, name] of movies) {
  const seed = await seedFor(id);
  if (!seed) { console.log(id, name, 'SEED-FAIL'); continue; }
  const r = await get(API + '/atlanta/sources?' + new URLSearchParams({ mediaType: 'movie', tmdbId: id, enc: '2', seed, title: '' }));
  let msg = r.body.slice(0, 90).replace(/\s+/g, ' ');
  console.log(id, name.padEnd(14), 'st=' + r.st, r.ms + 'ms', r.err || '', msg);
}
const seedTv = await seedFor('1396');
const r2 = await get(API + '/atlanta/sources?' + new URLSearchParams({ mediaType: 'tv', tmdbId: '1396', enc: '2', seed: seedTv, title: '', season: '1', episode: '1' }));
console.log('1396 Breaking Bad tv st=' + r2.st, r2.ms + 'ms', r2.body.slice(0, 90).replace(/\s+/g, ' '));
const r3 = await get(API + '/munich/sources?' + new URLSearchParams({ mediaType: 'tv', tmdbId: '1396', enc: '2', seed: seedTv, title: '', season: '1', episode: '1' }));
console.log('1396 Munich tv st=' + r3.st, r3.ms + 'ms len=' + r3.body.length);
