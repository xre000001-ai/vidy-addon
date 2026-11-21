import { fetch as ufetch, ProxyAgent } from 'undici';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const ag = new ProxyAgent('http://190.12.150.244:999');
async function get(u, ms = 16000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 30), body: '' }; }
}
const s = await get(API + '/seed?mediaId=155', 8000);
const seed = JSON.parse(s.body).seed;
for (const srv of ['nashville', 'chicago', 'portland', 'berlin', 'seattle', 'phoenix', 'dallas', 'vegas', 'reno', 'oakland', 'paris', 'cancun', 'delhi']) {
  const extra = srv === 'berlin' ? { language: 'german' } : {};
  const q = new URLSearchParams({ title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed, ...extra });
  const r = await get(API + '/' + srv + '/sources?' + q);
  let msg = ''; try { msg = JSON.parse(r.body).message || ''; } catch (e) {}
  console.log(srv.padEnd(10), 'st=' + r.st, r.ms + 'ms', 'len=' + r.body.length, msg);
}
