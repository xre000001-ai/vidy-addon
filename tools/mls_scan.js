#!/usr/bin/env node
// MLSBD-এর জন্য ফ্রি-প্রক্সি স্ক্যানার (workspace-এর তালিকা ব্যবহার করে)
// মাপকাঠি: প্রক্সি দিয়ে https://mlsbd.co/wp-json/... এলে **আসল JSON** ফেরে (CF-ব্লক-স্টাব নয়)।
'use strict';
const net = require('net'), tls = require('tls'), fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const TARGET = process.env.TGT || 'https://mlsbd.co/wp-json/wp/v2/posts?search=Kalki&per_page=1&_fields=title';
const ACCEPT = process.env.ACC
  ? (0, eval)(process.env.ACC)                                   // ★ ACC=স্ট্রিং হলেও ফাংশন হিসেবে চালাও
  : (s => { try { const j = JSON.parse(s); return Array.isArray(j) && j.length > 0 && !!j[0].title; } catch (e) { return false; } });
const TMO = Number(process.env.TMO || 7000);
const CONC = Number(process.env.CONC || 150);

function dechunk(buf) {
  let out = Buffer.alloc(0), i = 0;
  while (i < buf.length) {
    const j = buf.indexOf('\r\n', i);
    if (j < 0) break;
    const n = parseInt(buf.slice(i, j).toString('latin1'), 16);
    if (!n || isNaN(n)) break;
    out = Buffer.concat([out, buf.slice(j + 2, j + 2 + n)]);
    i = j + 2 + n + 2;
  }
  return out.length ? out : buf;
}

function via(px, url, ms) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), ci = px.lastIndexOf(':');
    const phost = px.slice(0, ci), pport = Number(px.slice(ci + 1)) || 8080;
    const sock = net.connect({ host: phost, port: pport });
    const hard = setTimeout(() => { sock.destroy(); reject(new Error('tmo')); }, ms);
    const bail = e => { clearTimeout(hard); try { sock.destroy(); } catch (x) { } reject(e); };
    sock.once('error', bail);
    sock.once('connect', () => sock.write('CONNECT ' + u.host + ':443 HTTP/1.1\r\nHost: ' + u.host + ':443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      sock.removeListener('data', onData);
      const head = buf.slice(0, i).toString('latin1');
      if (!/^HTTP\/1\.[01] 200/.test(head)) return bail(new Error('refused'));
      // ★ ফিক্স: CONNECT-উত্তরের সাথে TLS-হ্যান্ডশেকের প্রথম বাইটগুলো একই প্যাকেটে এলে সেগুলো
      //   সকেটে ফেরত দিতে হয়, নইলে হ্যান্ডশেক ভাঙে (আগের স্ক্যান ০/৪০০ হওয়ার কারণ)।
      const rest = buf.slice(i + 4);
      if (rest.length) { try { sock.unshift(rest); } catch (e) { } }
      const tl = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
        tl.write('GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname
          + '\r\nUser-Agent: ' + UA + '\r\nAccept: */*\r\nAccept-Language: en-US,en;q=0.9\r\nConnection: close\r\n\r\n');
        let raw = Buffer.alloc(0);
        tl.on('data', d2 => { raw = Buffer.concat([raw, d2]); });
        tl.on('close', () => {
          clearTimeout(hard);
          const s = raw.toString('latin1'), j = s.indexOf('\r\n\r\n');
          if (j < 0) return bail(new Error('nohdr'));
          const hd = s.slice(0, j);
          const code = parseInt((hd.split('\r\n')[0] || '').split(' ')[1] || '0', 10);
          const bodyBuf = /chunked/i.test(hd) ? dechunk(raw.slice(j + 4)) : raw.slice(j + 4);
          resolve({ code, body: bodyBuf.toString('utf8'), len: bodyBuf.length });
        });
      });
      tl.once('error', bail);
    };
    sock.on('data', onData);
  });
}

function loadLists() {
  const out = new Set();
  const add = v => { if (typeof v === 'string' && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) out.add(v); };
  const take = f => { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); walk(d); } catch (e) { } };
  const walk = d => {
    if (Array.isArray(d)) return d.forEach(x => (typeof x === 'string' ? add(x) : walk(x)));
    if (d && typeof d === 'object') return Object.keys(d).forEach(k => { add(k); if (typeof d[k] === 'string') add(d[k]); else if (d[k] && typeof d[k] === 'object') { add(d[k].px); walk(d[k]); } });
  };
  const curated = (process.env.LISTS || 'vidy_proxy_pool.json,src_pools.json,vidy_px_verified.json,vidy_mb_pool.json').split(',');
  curated.forEach(f => { if (fs.existsSync(f)) take(f); });
  if (process.env.BIG === '1') ['pxhttp.json', 'pxbig.json'].forEach(f => { if (fs.existsSync(f)) take(f); });
  return [...out];
}

(async () => {
  const all = loadLists();
  const LIMIT = Number(process.env.LIMIT || 0);
  let cands = all;
  if (LIMIT && all.length > LIMIT) {   // বড় তালিকা হলে র‍্যান্ডম-নমুনা (প্রতিবার আলাদা)
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    cands = all.slice(0, LIMIT);
  }
  console.error('candidates=' + cands.length + ' (তালিকায় মোট ' + all.length + ')  target=' + TARGET.slice(0, 60));
  const good = [];
  let i = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(CONC, cands.length) }, async () => {
    while (i < cands.length) {
      const px = cands[i++];
      try {
        const r = await via(px, TARGET, TMO);
        if (r.code === 200 && ACCEPT(r.body)) { good.push({ px, len: r.len, ms: Date.now() - t0 }); console.error('  ✓ ' + px + ' ' + r.len + 'b'); }
      } catch (e) { if (process.env.SCANDBG) console.error('  x ' + px + ' ' + e.message); }
      if (++done % 500 === 0) console.error('  ..' + done + '/' + cands.length + ' good=' + good.length + ' ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
  }));
  const out = { ts: Date.now(), target: TARGET, scanned: cands.length, good: good.map(g => g.px) };
  const f = process.env.OUT || 'mls_pool_found.json';
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.error('DONE good=' + good.length + '/' + cands.length + ' ⇒ ' + f);
  process.exit(0);
})();
