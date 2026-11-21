import { fetch as ufetch, ProxyAgent } from 'undici';
import fs from 'node:fs';
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
async function raw(u, ag, ms = 12000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, err: String(e.message || e).slice(0, 34), body: '' }; }
}
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const cand = Object.entries(verified).sort((a, b) => (b[1].ok || 0) / Math.max(1, b[1].att || 1) - (a[1].ok || 0) / Math.max(1, a[1].att || 1)).map(x => x[0]);
const live = [];
for (const px of cand.slice(0, 30)) {
  if (live.length >= 2) break;
  const ag = new ProxyAgent('http://' + px);
  const s0 = await raw(API + '/seed?mediaId=155', ag, 6000);
  let sd = ''; try { sd = JSON.parse(s0.body).seed || ''; } catch (e) {}
  if (sd) { live.push({ px, ag, seed: sd }); console.log('live exit:', px); }
}
if (live.length < 2) { console.log('NEED 2 LIVE'); process.exit(0); }
const [A, B] = live;
const q = new URLSearchParams({ title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed: A.seed });
const r = await raw(API + '/nashville/sources?' + q, A.ag);
const j = JSON.parse(decrypt(r.body.trim(), A.seed, 155));
const mpd = j.sources[0].url;
console.log('mpd via A(mint):');
const mA = await raw(mpd, A.ag); console.log(' st=' + mA.st, 'len=' + mA.body.length);
if (mA.st === 200) {
  console.log(mA.body.slice(0, 1200).replace(/\s+/g, ' '));
  const media = (mA.body.match(/media="([^"]+)"/) || [])[1];
  const init = (mA.body.match(/initialization="([^"]+)"/) || [])[1];
  console.log('media template:', media, '| init:', init);
  if (media) {
    const segU = new URL(media.replace('$RepresentationID$', '0').replace('$Number$', '1').replace('$Number%04d$', '0001').replace('$Bandwidth$', '0'), mpd).href;
    console.log('seg url guess:', segU.slice(0, 130));
    const gA = await raw(segU, A.ag); console.log('segment via A:', gA.st, 'len=' + gA.body.length, (gA.err || ''));
    const gB = await raw(segU, B.ag); console.log('segment via B:', gB.st, (gB.err || 'len=' + gB.body.length));
  }
}
const m3 = await raw(mpd.replace('.mpd', '.m3u8'), A.ag); console.log('.m3u8 swap via A:', m3.st, 'len=' + m3.body.length, m3.body.slice(0, 40).replace(/\n/g, '|'));
const mB = await raw(mpd, B.ag); console.log('mpd via B(other):', mB.st, (mB.err || ''));
