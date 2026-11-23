'use strict';
/* hm-pool-train.cjs — verified-pool ট্রেনার (v2, দুই-ধাপ)
 *   ধাপ-১: CONNECT/GET দিয়ে সমান্তরালে নোড বাছাই
 *   ধাপ-২: প্রতি নোডে ক্যাপাবিলিটি যাচাই (রুট-রিচেবিলিটি)  →  {ok,att,ms,ts,cap}
 * ব্যবহার:
 *   node tools/vidy-runtime/hm-pool-train.cjs 400 60            # ডিফল্ট সব ক্যাপ
 *   HMCAP=jp node tools/vidy-runtime/hm-pool-train.cjs 300 60   # শুধু jp
 * ফ্ল্যাগ/env: HMCAP(ক্যাপ-তালিকা) HMMS(৯০০০) HMPCONC(120) HMCONC(70) SECS CONC
 */
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'), zlib = require('zlib');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const POOL_FILE = path.join(__dirname, '..', '..', 'hm_proxy_pool.json');
const SECS = Number(process.argv[2] || 300), CONC = Number(process.argv[3] || 60);
const MSMAX = Number(process.env.HMMS || 9000), PCONC = Number(process.env.HMPCONC || 120);
const WANT = String(process.env.HMCAP || 'site,hs,gd,bb,pl,jp').split(',').filter(Boolean);

const CAPS = {
  site: { url: 'https://v5.hindmovie.im/wp-json/wp/v2/search?search=inception&per_page=3', min: 60, ok: b => /^\s*\[/.test(b) },
  hs: { url: 'https://hshare.lol/', min: 300, ok: b => !/Just a moment|_cf_chl_opt|Attention Required/i.test(b.slice(0, 1200)) },
  gd: { url: 'https://gdshine.org/', min: 800, ok: b => !/Just a moment|_cf_chl_opt|Attention Required/i.test(b.slice(0, 1200)) },
  bb: { url: 'https://boldb.site/', min: 300, ok: b => !/Just a moment|_cf_chl_opt/i.test(b.slice(0, 1200)) },
  pl: { url: 'https://mvlink.blog/', min: 300, ok: b => !/Just a moment|_cf_chl_opt/i.test(b.slice(0, 1200)) },
  jp: { url: 'https://links.joshapp.blog/', min: 300, ok: b => !/Just a moment|_cf_chl_opt|Attention Required/i.test(b.slice(0, 1200)) },
};

/* ── ক্যান্ডিডেট-উৎস (ফ্রি প্রক্সি লিস্ট) ───────────────────────── */
const SRC = [
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=all',
  'https://openproxy.space/list/http',
];
function plain(url, ms) {
  return new Promise(res => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'user-agent': UA, 'accept-encoding': 'identity' }, timeout: ms || 12000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return plain(new URL(r.headers.location, url).toString(), ms).then(res); }
      const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res(Buffer.concat(ch).toString('utf8'))); r.on('error', () => res(''));
    });
    req.on('error', () => res('')); req.on('timeout', () => { req.destroy(); res(''); });
  });
}
async function candidates() {
  const set = new Set();
  for (const [k, v] of Object.entries(loadPool())) if (v && v.ok > 0) set.add(k);
  const texts = await Promise.all(SRC.map(u => plain(u, 14000)));
  for (const b of texts) {
    for (const m of String(b || '').matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/g)) {
      const p = Number(m[2]); if (p > 80 && p < 65536) set.add(m[1] + ':' + p);
    }
  }
  return [...set];
}

/* ── এক নোড দিয়ে টার্গেট-ফেচ (CONNECT টানেল) ─────────────────── */
function fetchVia(node, url, ms) {
  return new Promise(res => {
    const [host, port] = [node.slice(0, node.lastIndexOf(':')), Number(node.slice(node.lastIndexOf(':') + 1))];
    let u; try { u = new URL(url); } catch (e) { return res(null); }
    const t0 = Date.now(); let done = false;
    const fin = r => { if (!done) { done = true; res(r); } };
    const timer = setTimeout(() => fin(null), ms);
    try {
      const creq = http.request({ host, port, method: 'CONNECT', path: u.hostname + ':443', headers: { host: u.hostname + ':443', 'user-agent': UA }, timeout: ms });
      creq.on('connect', (cres, socket) => {
        if (cres.statusCode !== 200) { clearTimeout(timer); try { socket.destroy(); } catch (e) { } return fin(null); }
        notFound: {
          const rq = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', socket, agent: false, headers: { host: u.hostname, 'user-agent': UA, 'accept-encoding': 'identity', accept: '*/*' }, timeout: ms }, r => {
            const ch = []; let n = 0;
            const enc = String(r.headers['content-encoding'] || '').toLowerCase();
            let s = r; if (enc === 'gzip') s = r.pipe(zlib.createGunzip()); else if (enc === 'br') s = r.pipe(zlib.createBrotliDecompress());
            s.on('data', d => { n += d.length; if (n < 2e6) ch.push(d); });
            s.on('end', () => { clearTimeout(timer); fin({ st: r.statusCode, t: Buffer.concat(ch).toString('utf8'), ms: Date.now() - t0 }); });
            s.on('error', () => { clearTimeout(timer); fin(null); });
          });
          rq.on('error', () => { clearTimeout(timer); fin(null); });
          rq.end();
        }
      });
      creq.on('error', () => { clearTimeout(timer); fin(null); });
      creq.on('timeout', () => { clearTimeout(timer); try { creq.destroy(); } catch (e) { } fin(null); });
      creq.end();
    } catch (e) { clearTimeout(timer); fin(null); }
  });
}

function loadPool() { try { return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch (e) { return {}; } }
function savePool(o) { try { fs.writeFileSync(POOL_FILE, JSON.stringify(o)); } catch (e) { } }

(async () => {
  const T0 = Date.now();
  const cands = await candidates();
  console.log('ক্যান্ডিডেট: ' + cands.length + ' | ক্যাপ-লক্ষ্য: ' + WANT.join(','));
  const POOL = loadPool();
  const fresh = {}; let tried = 0, added = 0;
  let qi = 0;
  const workers = [];
  const run = async () => {
    while (qi < cands.length && (Date.now() - T0) < SECS * 1000) {
      const node = cands[qi++];
      tried++;
      const cap = {}, det = {};
      for (const c of WANT) {
        if ((Date.now() - T0) > SECS * 1000) break;
        const spec = CAPS[c]; if (!spec) continue;
        const r = await fetchVia(node, spec.url, Math.min(MSMAX, 9000));
        if (r && r.st >= 200 && r.st < 400 && (r.t || '').length >= spec.min && spec.ok(r.t)) { cap[c] = 1; det[c] = r.ms; }
      }
      if (Object.keys(cap).length) {
        const ms = Math.min(...Object.values(det));
        const prev = POOL[node] || { ok: 0, att: 0 };
        POOL[node] = { ok: (prev.ok || 0) + 1, att: (prev.att || 0) + 1, ms: ms, ts: Date.now(), cap: Object.assign({}, prev.cap || {}, cap) };
        added++;
        if (added % 25 === 0) console.log('  +' + added + ' verified (tried=' + tried + ', ' + Math.round((Date.now() - T0) / 1000) + 's) — ' + node + ' [' + Object.keys(cap).join('+') + ']');
      }
      if (tried % 200 === 0) savePool(POOL);
    }
  };
  for (let k = 0; k < CONC; k++) workers.push(run());
  await Promise.all(workers);
  savePool(POOL);
  const tot = Object.values(POOL).filter(v => v && v.ok > 0).length;
  console.log('\nশেষ — নতুন verified=' + added + ' | tried=' + tried + ' | পুল-মোট=' + tot + ' | সময়=' + Math.round((Date.now() - T0) / 1000) + 's');
  const by = {}; for (const v of Object.values(POOL)) for (const c of Object.keys(v.cap || {})) by[c] = (by[c] || 0) + 1;
  console.log('ক্যাপ-বণ্টন:', JSON.stringify(by));
})();
