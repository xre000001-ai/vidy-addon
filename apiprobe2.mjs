import { fetch as ufetch, ProxyAgent } from 'undici';
import fs from 'node:fs';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const HB = { ...H, 'Accept-Language': 'en-US,en;q=0.9', 'sec-ch-ua': '"Chromium";v="147", "Google Chrome";v="147"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site' };
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const exits = Object.entries(verified).sort((a, b) => (a[1].ms || 9999) - (b[1].ms || 9999)).map(x => x[0]).slice(0, 10);

async function get(ag, u, ms, hdrs) {
  const t0 = Date.now();
  try {
    const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: hdrs || H });
    const b = await r.text();
    let n = -1, seed = '';
    try { const j = JSON.parse(b); n = (j.sources || []).length; seed = j.seed || ''; } catch (e) {}
    return { st: r.status, ms: Date.now() - t0, n, seed, head: b.slice(0, 60).replace(/\s+/g, ' ') };
  } catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 42) }; }
}
const src = (srv, seed, extra) => API + '/' + srv + '/sources?' + new URLSearchParams(Object.assign({ mediaType: 'movie', tmdbId: '155', enc: '2', seed, title: '' }, extra || {}));

let good = 0;
for (const px of exits) {
  if (good >= 3) break;
  const ag = new ProxyAgent('http://' + px);
  const s = await get(ag, API + '/seed?mediaId=155', 7000);
  if (!s.seed) { console.log(px, 'seed FAIL', JSON.stringify(s)); continue; }
  const mi = await get(ag, src('miami', s.seed), 8000);
  if (mi.n <= 0) { console.log(px, 'miami FAIL', JSON.stringify(mi)); continue; }
  good++;
  console.log('\n=== exit', px, 'miami ok sources=' + mi.n, mi.ms + 'ms');
  const s2 = await get(ag, API + '/seed?mediaId=155', 7000);
  const seed = s2.seed || s.seed;
  const tests = [
    ['atlanta baseline', src('atlanta', seed), H, 14000],
    ['atlanta title', src('atlanta', seed, { title: 'The Dark Knight' }), H, 14000],
    ['atlanta enc=1', src('atlanta', seed, { enc: '1' }), H, 14000],
    ['atlanta no-enc', API + '/atlanta/sources?' + new URLSearchParams({ mediaType: 'movie', tmdbId: '155', seed, title: '' }), H, 14000],
    ['atlanta browser-hdr', src('atlanta', seed), HB, 14000],
    ['munich baseline', src('munich', seed), H, 14000],
  ];
  for (const [name, u, hd, to] of tests) {
    const r = await get(ag, u, to, hd);
    console.log(' ', name, JSON.stringify(r));
    if (r.n > 0) break;
  }
  try { await ag.close(); } catch (e) {}
}
console.log('\ngood exits tested:', good);
