#!/usr/bin/env node
/* v1.17.2 regression test — ExoPlayer seek simulation for the BollyFlix relay
 *
 * 1) serves /tmp/ep16.mkv as a virtual GDFlix-style .mkv.zip (stored-deflate 32KB blocks)
 *    (two variants: the original SeekHead, and one with a deliberately stale Cues SeekPosition)
 * 2) runs the REAL bfSeekFix()/bfApplySeekFix()/bfRawRange() code out of server.js
 * 3) emulates ExoPlayer's MatroskaExtractor: SeekHead → Cues → seek map → cluster check
 */
const fs = require('fs');
const http = require('http');

const SRC = process.env.SRC || '/tmp/ep16.mkv';
const SRV = '/home/user/vidy-addon/server.js';
const PAY = 32768, HDR = 5, BLOCK = PAY + HDR, DATA_START = 30 + 8; // 'file.mkv'

// ── load the real functions out of server.js ────────────────────────────────
function loadFns() {
  const src = fs.readFileSync(SRV, 'utf8');
  const start = src.indexOf('const BF_SEEKFIX = new Map();');
  const end = src.indexOf('async function bfServeZip(');
  if (start < 0 || end < 0) throw new Error('block not found in server.js');
  const code = src.slice(start, end);
  const shim = `
    const DBG = false; const UA = 'Mozilla/5.0 (test)';
    function bfPatchSeekHeadNoCues(buf){ const n=Math.min(buf.length,600);
      const pC=Buffer.from([0x53,0xab,0x84,0x1c,0x53,0xbb,0x6b]);
      const pT=Buffer.from([0x53,0xab,0x84,0x12,0x54,0xc3,0x67]);
      let out=null; const i1=buf.subarray(0,n).indexOf(pC); if(i1>=0){out=Buffer.from(buf);out[i1+6]=0x6c;}
      const i2=buf.subarray(0,n).indexOf(pT); if(i2>=0){ if(!out) out=Buffer.from(buf); out[i2+6]=0x68; }
      return out||buf; }
    function bfCacheGet(m,k,t){const v=m.get(k);if(!v)return null;if(Date.now()-v.ts>t){m.delete(k);return null;}return v;}
    function bfCachePut(m,k,v,n=400){if(m.size>=n){const f=m.keys().next().value;m.delete(f);}m.set(k,Object.assign({ts:Date.now()},v));}
  `;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', 'Buffer', 'fetch', 'AbortSignal', shim + code +
    '\nmodule.exports={bfParseHead,bfScanTail,bfApplySeekFix,bfRawRange,bfSeekFix,bfVint,bfId,bfIsExoReq};');
  fn(mod, mod.exports, require, Buffer, global.fetch, global.AbortSignal);
  return mod.exports;
}

// ── ExoPlayer emulation (MatroskaExtractor logic) ──────────────────────────
function exoSimulate(head, F, meta, url, label) {
  const out = { steps: [] };
  const hp = F.bfParseHead(head);
  if (!hp || !hp.cues) { out.err = 'no Cues entry in the SeekHead => ExoPlayer: SeekMap.Unseekable => every seek = 0:00'; return out; }
  out.steps.push('SeekHead ok: segStart=' + hp.segStart + '  Cues SeekPosition=' + hp.cues.val);
  const cuesAbs = hp.cues.val + hp.segStart;
  out.steps.push('ExoPlayer: GET bytes ' + cuesAbs + '-' + (cuesAbs + 15) + ' (seek-for-cues)');
  return F.bfRawRange(url, meta, cuesAbs, cuesAbs + 15).then(probe => {
    if (!probe || probe.length < 4 || probe[0] !== 0x1c || probe[1] !== 0x53 || probe[2] !== 0xbb || probe[3] !== 0x6b) {
      out.err = 'Cues element NOT at the SeekHead position => ExoPlayer: SeekMap.Unseekable => every seek = 0:00';
      return out;
    }
    out.steps.push('Cues element found ✔ (1c 53 bb 6b) => ExoPlayer builds a real seek map');
    const cuesSizeLen = (() => { const x = probe[4]; let l = 0; for (let i = 0; i < 8; i++) if (x & (0x80 >> i)) { l = i + 1; break; } return l; })();
    let size = probe[4] & (0xff >> cuesSizeLen);
    for (let i = 1; i < cuesSizeLen; i++) size = size * 256 + probe[4 + i];
    return F.bfRawRange(url, meta, cuesAbs + 4 + cuesSizeLen, cuesAbs + 4 + cuesSizeLen + size - 1).then(cues => {
      const rd = (b, p) => { const x = b[p]; let l = 0; for (let i = 0; i < 8; i++) if (x & (0x80 >> i)) { l = i + 1; break; } return l; };
      const rdId = (b, p) => b.subarray(p, p + rd(b, p)).toString('hex');
      const rdSz = (b, p) => { const l = rd(b, p); let v = b[p] & (0xff >> l); for (let i = 1; i < l; i++) v = v * 256 + b[p + i]; return { v, l }; };
      const rdVal = (b, p, len) => { let v = 0; for (let i = 0; i < len; i++) v = v * 256 + b[p + i]; return v; };
      const pts = []; let o = 0;
      while (o < cues.length - 8 && pts.length < 5) {
        const il = rd(cues, o), id = rdId(cues, o), s = rdSz(cues, o + il);
        if (id === 'bb') {
          let q = o + il + s.l, qe = q + s.v, t = null, cp = null;
          while (q < qe - 4) {
            const jl = rd(cues, q), j = rdId(cues, q), js = rdSz(cues, q + jl);
            if (j === 'b3') t = rdVal(cues, q + jl + js.l, js.v);
            if (j === 'b7') {
              let k = q + jl + js.l, ke = k + js.v;
              while (k < ke - 4) {
                const ml = rd(cues, k), m = rdId(cues, k), ms = rdSz(cues, k + ml);
                if (m === 'f1') cp = rdVal(cues, k + ml + ms.l, ms.v);
                k = k + ml + ms.l + ms.v;
              }
            }
            q = q + jl + js.l + js.v;
          }
          pts.push({ t, cp });
        }
        o = o + il + s.l + s.v;
      }
      out.cuePoints = pts;
      const offs = pts.map(p => (p.cp == null ? null : hp.segStart + p.cp));   // ExoPlayer: segmentContentPosition + cueClusterPosition
      out.offsets = offs;
      out.clusterChecks = [];
      const checks = offs.filter(x => x != null).slice(0, 5);
      let i = 0;
      const next = () => {
        if (i >= checks.length) {
          out.allClustersOk = out.clusterChecks.every(c => c.ok);
          return Promise.resolve(out);
        }
        const off = checks[i++];
        return F.bfRawRange(url, meta, off, off + 3).then(b => {
          const ok = !!b && b.length >= 4 && b[0] === 0x1f && b[1] === 0x43 && b[2] === 0xb6 && b[3] === 0x75;
          out.clusterChecks.push({ off, ok, hex: b ? b.toString('hex') : 'none' });
          return next();
        });
      };
      return next();
    });
  });
}

// ── the virtual zip server ─────────────────────────────────────────────────
function makeServer(rawFd, rawSize, broken) {
  const nBlocks = Math.ceil(rawSize / PAY);
  const zipTotal = DATA_START + nBlocks * BLOCK;
  return http.createServer((req, res) => {
    const f = req.url.split('?')[0];
    const isBroken = broken || f === '/broken.zip';
    const rh = String(req.headers.range || '');
    const m = /^bytes=(\d+)-(\d*)$/i.exec(rh);
    const z0 = m ? Math.min(zipTotal - 1, parseInt(m[1], 10)) : 0;
    const z1 = m ? (m[2] ? Math.min(zipTotal - 1, parseInt(m[2], 10)) : zipTotal - 1) : zipTotal - 1;
    const hdrs = { 'content-type': 'video/x-matroska', 'accept-ranges': 'bytes', 'content-length': String(z1 - z0 + 1) };
    if (m) hdrs['content-range'] = 'bytes ' + z0 + '-' + z1 + '/' + zipTotal;
    res.writeHead(m ? 206 : 200, hdrs);
    let z = z0;
    while (z <= z1) {
      const rel = z - DATA_START;
      const bi = Math.floor(rel / BLOCK);
      const inB = rel - bi * BLOCK;
      const rawStart = bi * PAY;
      const rawEnd = Math.min(rawSize - 1, (bi + 1) * PAY - 1);
      if (inB < HDR) {
        const n = Math.min(HDR - inB, z1 - z + 1);
        const len = rawEnd - rawStart + 1;
        const h = Buffer.alloc(HDR);
        h[0] = (bi === nBlocks - 1) ? 1 : 0;
        h.writeUInt16LE(len, 1);
        h.writeUInt16LE((~len) & 0xffff, 3);
        res.write(h.subarray(inB, inB + n));
        z += n; continue;
      }
      const n = Math.min(rawEnd - rawStart + 1 - (inB - HDR), z1 - z + 1);
      const buf = Buffer.alloc(n);
      fs.readSync(rawFd, buf, 0, n, rawStart + (inB - HDR));
      if (isBroken) {
        const target = DATA_START + HDR + 100;          // the raw offset 100 = the Cues SeekPosition value
        const s = target - z;
        if (s >= 0 && s + 4 <= n) buf.writeUInt32BE(buf.readUInt32BE(s) - 27520, s);   // make it stale
      }
      res.write(buf);
      z += n;
    }
    res.end();
  });
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(SRC)) {
    console.log('SKIP: ' + SRC + ' not present (download a My Demon S01E16 MKV to run this test)');
    process.exit(0);
  }
  const F = loadFns();
  const rawSize = fs.statSync(SRC).size;
  const rawFd = fs.openSync(SRC, 'r');
  const server = makeServer(rawFd, rawSize, false);
  await new Promise(r => server.listen(8099, '127.0.0.1', r));
  const URL_OK = 'http://127.0.0.1:8099/file.zip';
  const URL_BAD = 'http://127.0.0.1:8099/broken.zip';
  const meta = { dataStart: DATA_START, rawSize, zip: true };
  let fail = 0;

  for (const [label, url, wantMode] of [
    ['A) original SeekHead (Cues pointer correct)', URL_OK, 'ok'],
    ['B) stale Cues SeekPosition (simulates a broken muxer)', URL_BAD, 'rewrite']
  ]) {
    const fix = await F.bfSeekFix(url, meta);
    console.log('\n=== ' + label + ' ===');
    console.log('  bfSeekFix → mode=' + (fix ? fix.mode : 'null') + (fix && fix.mode === 'rewrite' ? ' (cues ' + fix.cues.val + '→' + fix.cuesRel + ')' : ''));
    if (!fix || fix.mode !== wantMode) { console.log('  !! expected mode=' + wantMode); fail++; }
    const headRaw = await F.bfRawRange(url, meta, 0, 65535);
    const served = F.bfApplySeekFix(Buffer.from(headRaw), fix);
    // the Cues SeekID byte in the served head: 0x6b = untouched (good), 0x6c = mangled (the old bug)
    const iC = served.subarray(0, 600).indexOf(Buffer.from([0x53, 0xab, 0x84, 0x1c, 0x53, 0xbb]));
    console.log('  served head: Cues SeekID byte = 0x' + (iC >= 0 ? served[iC + 6].toString(16) : '??') + (iC >= 0 && served[iC + 6] === 0x6b ? '  ✔ untouched' : '  ✘ mangled'));
    if (iC < 0 || served[iC + 6] !== 0x6b) fail++;
    const sim = await exoSimulate(served, F, meta, url, label);
    console.log('  ExoPlayer: ' + sim.steps.join(' | '));
    if (sim.err) { console.log('  ✘ ' + sim.err); fail++; }
    console.log('  cuePoints: ' + JSON.stringify(sim.cuePoints));
    console.log('  cluster offsets: ' + JSON.stringify(sim.offsets));
    console.log('  cluster checks: ' + JSON.stringify(sim.clusterChecks) + ' => allOk=' + sim.allClustersOk);
    if (sim.clusterChecks && sim.clusterChecks.length) {
      if (!sim.allClustersOk) fail++;
    } else if (!sim.err) { console.log('  !! no cue points parsed'); fail++; }
  }

  // the old behaviour for comparison: the mangled head must break Exo seeking
  const oldMangled = F.bfApplySeekFix(Buffer.from(await F.bfRawRange(URL_OK, meta, 0, 65535)), null);
  const iC2 = oldMangled.subarray(0, 600).indexOf(Buffer.from([0x53, 0xab, 0x84, 0x1c, 0x53, 0xbb]));
  console.log('\n=== C) old behaviour (no fix → the SeekID mangle) ===');
  console.log('  Cues SeekID byte = 0x' + (iC2 >= 0 ? oldMangled[iC2 + 6].toString(16) : '??') + '  => ExoPlayer cannot find the Cues => Unseekable (this was the bug)');
  if (iC2 < 0 || oldMangled[iC2 + 6] !== 0x6c) fail++;

  server.close();
  console.log('\n' + (fail ? '✘ FAILURES: ' + fail : '✔ ALL EXO-SEEK TESTS PASSED'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
