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
async function raw(u, ag, ms = 12000) {
  const t0 = Date.now();
  try { const r = await ufetch(u, { dispatcher: ag, signal: AbortSignal.timeout(ms), headers: H }); const b = await r.text(); return { st: r.status, ms: Date.now() - t0, body: b }; }
  catch (e) { return { st: 0, err: String(e.message || e).slice(0, 40), body: '' }; }
}
import fs from 'node:fs';
const verified = JSON.parse(fs.readFileSync('/home/user/vidy-addon/vidy_px_verified.json', 'utf8'));
const cand = Object.entries(verified).sort((a, b) => (b[1].ok || 0) / Math.max(1, b[1].att || 1) - (a[1].ok || 0) / Math.max(1, a[1].att || 1)).map(x => x[0]);
let agA = null, agB = null, seed = '';
for (const px of cand.slice(0, 25)) {
  const ag = new ProxyAgent('http://' + px);
  const s0 = await raw(API + '/seed?mediaId=155', ag, 6000);
  try { seed = JSON.parse(s0.body).seed || ''; } catch (e) {}
  if (seed) { agA = ag; console.log('mint exit:', px); break; }
}
if (!agA) { console.log('NO LIVE EXIT'); process.exit(0); }
for (const px of cand.slice(0, 25)) { const ag = new ProxyAgent('http://' + px); if (ag !== agA) { agB = ag; break; } }
const q = new URLSearchParams({ title: 'The Dark Knight', mediaType: 'movie', year: '2008', tmdbId: '155', imdbId: 'tt0468569', enc: '2', seed });
const r = await raw(API + '/delhi/sources?' + q, agA);
const j = JSON.parse(decrypt(r.body.trim(), seed, 155));
const pl = j.sources[0].url;
console.log('playlist host:', new URL(pl).host, 'quality:', j.sources[0].quality);
const pA = await raw(pl, agA); console.log('playlist via SAME exit:', pA.st, pA.ms + 'ms', 'len=' + pA.body.length, pA.body.slice(0, 60).replace(/\n/g, '|'));
const pB = await raw(pl, agB); console.log('playlist via OTHER exit:', pB.st, pB.body.slice(0, 60).replace(/\n/g, '|'));
const pD = await raw(pl, undefined); console.log('playlist DIRECT (sandbox):', pD.st, (pD.err || pD.body.slice(0, 60).replace(/\n/g, '|')));
if (pA.st === 200) {
  const lines = pA.body.split('\n').filter(x => x && !x.startsWith('#'));
  console.log('segments/variants count:', lines.length, 'first:', (lines[0] || '').slice(0, 110));
  const seg = new URL(lines[0], pl).href;
  const sA = await raw(seg, agA); console.log('seg/variant via SAME exit:', sA.st, 'len=' + sA.body.length, sA.body.slice(0, 40).replace(/\n/g, '|'));
  const sB = await raw(seg, agB); console.log('seg/variant via OTHER exit:', sB.st, (sB.err || sB.body.slice(0, 40).replace(/\n/g, '|')));
}
