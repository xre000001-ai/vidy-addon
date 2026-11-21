import { fetch as ufetch, ProxyAgent } from 'undici';
const API = 'https://api.wecollege.net';
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36', 'Referer': 'https://www.vidy.st/', 'Origin': 'https://www.vidy.st', 'Accept': '*/*' };
const K = 2654435769, A0 = 2779096485;
const imul = (a, b) => Math.imul(a, b) >>> 0;
function rotl(x, r) { const s = r & 31; return s === 0 ? x >>> 0 : (((x << s) | (x >>> (32 - s))) >>> 0); }
function mix(e) { let x = e >>> 0; x = (x ^ (x >>> 16)) >>> 0; x = imul(x, 2246822507); x = (x ^ (x >>> 13)) >>> 0; x = imul(x, 3266489909); x = (x ^ (x >>> 16)) >>> 0; return x >>> 0; }
function fnv1a(str) { let t = 2166136261; const b = Buffer.from(str, 'utf8'); for (let i = 0; i < b.length; i++) t = imul((t ^ b[i]) >>> 0, 16777619); return mix(t); }
function keystream(seed, tmdbId, len) {
  const s0 = mix((fnv1a(seed) ^ mix((tmdbId >>> 0) ^ K)) >>> 0) >>> 0;
  const S = new Array(61).fill(0), def = new Array(61).fill(false);
  let s = s0;
  for (let e = 0; e < 8; e++) { const t = s % 61; const sr = rotl((s + K) >>> 0, 7 + (7 & e)); S[t] = (sr ^ mix(sr)) >>> 0; def[t] = true; s = mix((sr + t) >>> 0) >>> 0; }
  const acc = mix(A0 ^ s) >>> 0; const ks = Buffer.alloc(len); let n = acc, counter = 0, i = 0;
  while (i < len) { const d = n % 61; const inner = (S[d] ^ imul(K, counter + 1)) >>> 0; const rbit = def[d] ? -1 : 0; const l = (((n ^ inner) | (n & inner & rbit)) >>> 0); const x = (rotl((l + n) >>> 0, 31 & d) ^ rotl(n, 31 & ((d * 7) & 31))) >>> 0; n = mix((x + K) >>> 0) >>> 0; S[d] = n; def[d] = true; ks[i++] = n & 0xFF; if (i < len) ks[i++] = (n >>> 8) & 0xFF; if (i < len) ks[i++] = (n >>> 16) & 0xFF; if (i < len) ks[i++] = (n >>> 24) & 0xFF; counter++; }
  return ks;
}
function decrypt(b64ct, seed, tmdbId) {
  const ct = Buffer.from(b64ct, 'base64url'); const ks = keystream(seed, tmdbId >>> 0, ct.length);
  for (let i = 0; i < ct.length; i++) ct[i] ^= ks[i];
  if (ct.slice(0, 4).toString('latin1') !== 'mvm1') throw new Error('bad-magic');
  return ct.slice(4).toString('utf8');
}
const ag = new ProxyAgent('http://176.111.37.5:39811');
async function get(u, ms = 18000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 30), body: '' }; }
}
async function probe(srv, id, name, yr, imdb, tv) {
  const s = await get(API + '/seed?mediaId=' + id, 8000);
  let seed = ''; try { seed = JSON.parse(s.body).seed || ''; } catch (e) {}
  if (!seed) return console.log(srv, id, 'SEED-FAIL');
  const q = { title: name, mediaType: tv ? 'tv' : 'movie', year: yr, tmdbId: id, imdbId: imdb, enc: '2', seed };
  if (tv) { q.season = '1'; q.episode = '1'; }
  const r = await get(API + '/' + srv + '/sources?' + new URLSearchParams(q));
  let o = 'st=' + r.st + ' ' + r.ms + 'ms';
  if (r.st === 200) { try { const j = JSON.parse(decrypt(r.body.trim(), seed, +id)); o += ' sources=' + (j.sources || []).length + ' [' + (j.sources || []).map(x => x.quality).join(',') + '] host=' + (((j.sources || [])[0] || {}).url || '').slice(0, 36); } catch (e) { o += ' DEC-FAIL ' + e.message; } }
  else o += ' ' + r.body.slice(0, 80).replace(/\s+/g, ' ');
  console.log(srv.padEnd(10), name.padEnd(14), o);
}
for (const srv of ['delhi', 'chicago', 'austin', 'atlanta']) {
  await probe(srv, '155', 'The Dark Knight', '2008', 'tt0468569', false);
  await probe(srv, '1396', 'Breaking Bad', '2008', 'tt0903747', true);
  await probe(srv, '278', 'The Shawshank Redemption', '1994', 'tt0111161', false);
}
