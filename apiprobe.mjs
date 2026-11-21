import { fetch as ufetch, ProxyAgent } from 'undici';
import fs from 'node:fs';
const API = 'https://api.wecollege.net';
const pool = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_mb_pool.json', 'utf8')).slice(0, 40);
async function via(px, srv) {
  const ag = new ProxyAgent('http://' + px);
  const t0 = Date.now();
  try {
    const r1 = await ufetch(API + '/seed?mediaId=155', { dispatcher: ag, signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j1 = JSON.parse(await r1.text());
    if (!j1.seed) return px + ' ' + srv + ': seed-empty st=' + r1.status;
    const q = new URLSearchParams({ mediaType: 'movie', tmdbId: '155', enc: '2', seed: j1.seed, title: '' });
    const r2 = await ufetch(API + '/' + srv + '/sources?' + q, { dispatcher: ag, signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const b2 = await r2.text();
    let n = -1; try { n = (JSON.parse(b2).sources || []).length; } catch (e) {}
    return px + ' ' + srv + ': st=' + r2.status + ' sources=' + n + ' ' + (Date.now() - t0) + 'ms';
  } catch (e) { return px + ' ' + srv + ': ERR ' + String(e.message || e).slice(0, 40) + ' ' + (Date.now() - t0) + 'ms'; }
}
const exits = pool.slice(0, 6).map(x => x.px || String(x));
for (const px of exits) {
  console.log(await via(px, 'miami'));
  console.log(await via(px, 'atlanta'));
  console.log(await via(px, 'munich'));
}
