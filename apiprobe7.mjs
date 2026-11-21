import { fetch as ufetch, ProxyAgent } from 'undici';
import fs from 'node:fs';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const exits = ['47.89.184.18:3128','116.202.108.111:3128','43.99.60.244:8089','128.199.113.85:9090','184.75.221.82:3118','190.71.72.85:2525','176.111.37.5:39811','103.189.116.20:8080'];
async function get(ag, u, ms = 16000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 30), body: '' }; }
}
for (const px of exits) {
  const ag = new ProxyAgent('http://' + px);
  const s = await get(ag, API + '/seed?mediaId=155', 7000);
  let seed = ''; try { seed = JSON.parse(s.body).seed || ''; } catch (e) {}
  if (!seed) { console.log(px, 'SEED-FAIL'); continue; }
  const qa = new URLSearchParams({ title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed });
  const ra = await get(ag, API + '/atlanta/sources?' + qa);
  const qm = new URLSearchParams({ title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', language: 'german', enc: '2', seed });
  const rm = await get(ag, API + '/munich/sources?' + qm);
  console.log(px, '| atlanta st=' + ra.st, (ra.body.slice(0, 60).replace(/\s+/g, ' ')), '| munich st=' + rm.st, 'len=' + rm.body.length);
  try { await ag.close(); } catch (e) {}
}
