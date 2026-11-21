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
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const px = '190.12.150.244:999';
const ag = new ProxyAgent('http://' + px);
async function get(u, ms = 20000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); return { st: r.status, ms: Date.now() - t0, body: await r.text() }; }
  catch (e) { return { st: 0, ms: Date.now() - t0, err: String(e.message || e).slice(0, 40), body: '' }; }
}
const s = await get(API + '/seed?mediaId=155', 8000);
const seed = JSON.parse(s.body).seed;
console.log('seed ok');
const variants = [
  ['A title+year+imdb', { title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed }],
  ['B title-double-enc', { title: encodeURIComponent('The Dark Knight'), mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed }],
  ['C title+year', { title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', enc: '2', seed }],
  ['D title+imdb', { title: 'The Dark Knight', mediaType: 'movie', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed }],
];
for (const [name, q] of variants) {
  const r = await get(API + '/atlanta/sources?' + new URLSearchParams(q));
  let out = 'st=' + r.st + ' ' + r.ms + 'ms ' + (r.err || '');
  if (r.st === 200) { try { const j = JSON.parse(decrypt(r.body.trim(), seed, 155)); out += 'SOURCES=' + (j.sources || []).length + ' first=' + (((j.sources || [])[0] || {}).url || '').slice(0, 60); } catch (e) { out += ' decrypt-fail ' + e.message; } }
  else out += ' body=' + r.body.slice(0, 110).replace(/\s+/g, ' ');
  console.log(name, out);
  if (r.st === 200) break;
}
