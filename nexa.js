'use strict';
/* ★ v1.34.322: nexa.mov — নতুন সোর্স (ইউজার-নির্দেশ)।
   nexa.mov একটা SvelteKit SPA; প্লেব্যাক-পাইপলাইন সম্পূর্ণ সিল করা:
     providers.nexa.mov/v1/runtime.json → sources.mjs + sources.wasm (ABI 3, configVersion 34)
     sources.handshake(puzzle, viewer) ──► NXH3 এনভেলপ ──POST /v1/session──► সেশন-ব্লব (92B)
     api.accept(resp) ⇒ সেশন-লাইভ
     api.plan({platform:'tmdb', id, season, episode}) ⇒ সার্ভার-প্রতি {codename, envelope(NXS3), header(24B)}
     POST /v1/playlist {envelope} → 200 ⇒ api.open(header, resp) ⇒ আসল {url, kind, headers, audioOptions}
   সার্ভার-ক্যাটালগ (wasm থেকেই): মুভি/সিরিজ ৫টি — nova, onyx, orion, flux, sylver
                                অ্যানিমে ৪টি — kyoto, tokyo, hokkaido, fuji
   নীতি (অন্য সব সোর্সের মতোই): কার্ড তখনই যখন URL সত্যিই সাড়া দেয় (২০০/২০৬) — বলতে-না-পারলে
   রেজোলিউশন 'Auto' (কখনো বানানো সংখ্যা নয়), আর প্লেলিস্ট-বডিতে RESOLUTION= দেখলে তবেই সংখ্যা। */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

const PROVIDERS = process.env.NEXA_PROVIDERS || 'https://providers.nexa.mov';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const MOD = path.join(__dirname, 'nexa-sources.mjs');
const WASM = path.join(__dirname, 'nexa-sources.wasm');

const MOVIE_SRV = ['nova', 'onyx', 'orion', 'flux', 'sylver'];       // মুভি/সিরিজ
const ANIME_SRV = ['kyoto', 'tokyo', 'hokkaido', 'fuji'];             // অ্যানিমে

/* ★ v1.34.327: ব্রাউজার-ক্যাপচার পথ (প্রমাণিত) ──────────────────────────────
   wasm-পথ সেশন পায় (200+accept) কিন্তু নেক্সার AS এনভেলপ AS-এ BAD_ENVELOPE দেয়; আসল
   প্লেয়ার ব্রাউজারে (web worker + ফন্ট-পাজল + ফিঙ্গারপ্রিন্ট) master-paylist পায়।
   তাই NEXA_CAP_URL (ডিফল্ট http://127.0.0.1:8899) সার্ভিসকে টাইটেল-আইডি দেওয়া হয়,
   সে headless chromium-এ সাইটের প্লেয়ার চালিয়ে রিয়েল HLS URL + রেজলিউশন-লিস্ট ফেরত দেয়। */
const CAP_URL = process.env.NEXA_CAP_URL === undefined ? 'http://127.0.0.1:8899' : process.env.NEXA_CAP_URL;
const CAP_TTL = Number(process.env.NEXA_CAP_TTL || 1800000);
/* ★★ v1.34.395 (ইউজার: "Stremio IMDb-ই ডাকে — এত সমস্যা কেন?") — BeamUp-এ **একাধিক রেপ্লিকা**,
   প্রতিটির নিজের মেমরি ⇒ একবার ক্যাপচার হলেও পরের কল অন্য রেপ্লিকায় গিয়ে আবার ঠান্ডা (৮সে) হয়,
   আর উত্তর তার আগেই কেটে যায়। তাই সফল-ক্যাপচার ডিস্কে রাখি (URL-এ টোকেন থাকে — তাই কেবল
   CAP_TTL-এর ভিতরে, আর ফাইল /tmp-এ); বুটে ফিরিয়ে আনি ⇒ কার্ড প্রায় সাথে সাথে। */
const CAP_DISK = process.env.NEXA_CAP_DISK || '/tmp/nexa-cap-cache.json';
function capDiskSave() {
  try {
    const now = Date.now(); const o = {};
    for (const [k, v] of CAP_CACHE) {
      if (!v || v.bad || !v.val || now - v.at >= CAP_TTL) continue;
      o[k] = { at: v.at, val: v.val };
    }
    require('fs').writeFileSync(CAP_DISK, JSON.stringify(o).slice(0, 4 * 1024 * 1024));
  } catch (e) { }
}
function capDiskLoad() {
  try {
    const j = JSON.parse(require('fs').readFileSync(CAP_DISK, 'utf8')); const now = Date.now(); let n = 0;
    for (const k of Object.keys(j || {})) {
      const e = j[k];
      if (!e || !e.val || !(now - e.at < CAP_TTL)) continue;
      if (CAP_CACHE.size > CAP_MAX) break;
      CAP_CACHE.set(k, { at: e.at, val: e.val }); n++;
    }
    if (n) note('cap-disk-load ' + n + ' entries');
  } catch (e) { }
}
const CAP_CACHE = new Map();     // key → {at, val}
/* ★ v1.34.328: সার্ভিস-লুপ (nexa-cap.py) এই বক্সে মাঝে মাঝে আটকে যায় (র‍্যাম ২GB),
   তাই ডিফল্ট পথ = এক-শট CLI প্রসেস (nexa-cap1.py): প্রতিবার নতুন chromium, শেষে পুরো
   মেমরি ফেরত, ঝুলে থাকার ঝুঁকি নেই। NEXA_CAP_CLI=0 দিলে সার্ভিস-পথ। */
const CAP_CLI = process.env.NEXA_CAP_CLI === undefined ? 1 : (String(process.env.NEXA_CAP_CLI) !== '0');
/* ★ v1.34.329: প্রমাণিত পথ — প্রক্সি দিয়ে এক-শট ক্যাপচার (nexa-proxy1.py)।
   কারণ: nexa /v1/session rate-limit করে (429); আমাদের DC IP-র কোটা শেষ, প্রক্সি-নোড = নতুন কোটা।
   পরিমাপ (3/3 সফল): session 200 @4.6সে → playlist 200 @9.4সে → master @10.6সে। */
/* ★ v1.34.331: BeamUp কনটেইনারে python নেই ⇒ ক্যাপচার এখন Node-এই (nexa-cap.js)।
   playwright package.json-এ যোগ করা (npm i playwright) — chromium বাইনারি ইমেজে থাকে। */
const CAP_PY = process.env.NEXA_CAP_PY || require('path').join(__dirname, 'nexa-cap.js');
const CAP_NODE = process.env.NEXA_CAP_NODE || 1;
/* ★ v1.34.330: nexa-র নিজস্ব যাচাই-করা পুল (vidy-র পুল অপরিবর্তিত)।
   nexa /v1/session-এ IP-কোটা (429) আছে, তাই একাধিক নোড ঘুরিয়ে চেষ্টা করি; সফল হলে ৩০ মিনিট ক্যাশ। */
const NEXA_PX_FALLBACK = "147.161.246.246:10924,18.188.168.99:8741,52.56.143.248:3128,35.43.246.3:23571,103.237.102.191:11111,172.235.157.127:3128,34.43.46.91:80,147.161.246.246:10081,147.161.246.246:10634,147.161.246.246:11452,176.111.37.5:39811,147.161.246.246:12393";
const CAP_PROXY = process.env.NEXA_CAP_PROXY === undefined ? NEXA_PX_FALLBACK : process.env.NEXA_CAP_PROXY;
const CAP_PROXY_LIST = String(process.env.NEXA_CAP_PROXIES || CAP_PROXY + ',102.244.78.61:8086,4.144.146.21:80').split(',').filter(Boolean);
let CAP_PX_I = 0;
const CAP_PYTHON = process.env.NEXA_CAP_PYTHON || 'python3';
async function capCliOnce(platform, id, S, E, ms, pxOverride) {
  /* warm ওয়ার্কার আগে (প্রোক্সি-রিকোয়েস্ট ওয়ার্কারে নেই — ওগুলো এক-শটে) */
  if (WORKER_ON && !pxOverride) {
    const w = await capWorker(platform, id, S, E, ms);
    if (w && w.ok && Array.isArray(w.variants) && w.variants.length) return w;
    if (w && w.err && w.err !== 'no-playlist') note('cap-worker-err ' + String(w.err).slice(0, 80));
    else if (w) note('cap-worker-miss (' + (w.total || w.ms || 0) + 'ms)');
  }
  return new Promise(resolve => {
    let out = '', done = false;
    const px = pxOverride || '';
    const args = [CAP_PY, '--platform', platform, '--id', String(id), '--timeout', String(Math.max(16, Math.round((ms || 26000) / 1000)))];
    if (px) args.push('--proxy', px); else args.push('--proxy', '');
    if (E) { args.push('--s', String(S), '--e', String(E)); }
    let ch;
    try {
      ch = CAP_NODE
        ? require('child_process').spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'] })
        : require('child_process').spawn(CAP_PYTHON, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    }
    catch (e) { return resolve(null); }
    const tm = setTimeout(() => { if (!done) { done = true; try { ch.kill('SIGKILL'); } catch (e) { } resolve(null); } },
      Math.max(45000, (ms || 26000) + 25000));
    ch.stdout.on('data', d => { out += d.toString(); if (out.length > 400000) out = out.slice(-200000); });
    ch.on('error', () => { if (!done) { done = true; clearTimeout(tm); resolve(null); } });
    ch.on('close', () => {
      if (done) return; done = true; clearTimeout(tm);
      const lines = out.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try { const j = JSON.parse(lines[i]); if (j && typeof j === 'object') return resolve(j); } catch (e) { }
      }
      resolve(null);
    });
  });
}
const CAP_MAX = 300;
try { capDiskLoad(); } catch (eDL) { }   /* ★ v1.34.395: বুটে ডিস্ক-ক্যাশ ফিরিয়ে আনি */

/* ───────────── persistent ক্যাপচার-ওয়ার্কার (v1.34.351) ─────────────
   কোল্ড chromium লঞ্চ ≈৯–১৪সে ⇒ BeamUp গেটওয়ে ৫০৪ দেয়। তাই একটাই ব্রাউজার জীবিত রেখে
   প্রতি টাইটেলে নতুন ট্যাব খুলি ⇒ warm ক্যাপচার ১–৩সে। ওয়ার্কার মরে গেলে নিজে থেকে আবার। */
const WORKER_ON = process.env.NEXA_CAP_WORKER === undefined ? 1 : String(process.env.NEXA_CAP_WORKER) !== '0';
let WK = null, WK_BUF = '', WK_WAIT = [], WK_STARTED = 0, WK_OK = 0, WK_ERR = 0;

function wkSpawn() {
  if (WK) return WK;
  try {
    const ch = require('child_process').spawn(process.execPath, [CAP_PY, '--serve'], { stdio: ['pipe', 'pipe', 'ignore'] });
    ch.on('close', (code) => { note('worker-exit code=' + code); WK = null; WK_STARTED = 0; const w = WK_WAIT; WK_WAIT = []; for (const f of w) f(null); });
    ch.on('error', () => { WK = null; });
    ch.stdout.setEncoding('utf8');
    ch.stdout.on('data', (d) => {
      WK_BUF += d;
      let i;
      while ((i = WK_BUF.indexOf('\n')) >= 0) {
        const line = WK_BUF.slice(0, i); WK_BUF = WK_BUF.slice(i + 1);
        if (!line.trim()) continue;
        let j = null;
        try { j = JSON.parse(line); } catch (e) { j = null; }
        if (j && j.ready) { note('worker-ready pid=' + j.pid); return; }
        const f = WK_WAIT.shift();
        if (f) f(j);
      }
    });
    WK = ch; WK_STARTED = Date.now();
    note('worker-spawn pid=' + (ch.pid || '?'));
    return ch;
  } catch (e) { WK = null; return null; }
}

function capWorker(platform, id, S, E, ms) {
  return new Promise((resolve) => {
    const ch = wkSpawn();
    if (!ch) return resolve(null);
    let done = false;
    const payload = { args: { platform, id: String(id), timeout: String(Math.max(10, Math.round((ms || 20000) / 1000))) } };
    if (E) { payload.args.s = String(S); payload.args.e = String(E); }
    const entry = (j) => { if (done) return; done = true; clearTimeout(tm);
      if (j && j.ok && Array.isArray(j.variants) && j.variants.length) {
        /* ★ v1.34.371: worker-এর সফল ফল সরাসরি CAP_CACHE-এ (আগে capFetch-এর ক্যাশ-চেক আগেই
           bad-এন্ট্রি ফেরত দিত ⇒ ক্যাপচার সফল হয়েও কার্ড ০) */
        try {
          const k2 = capKey(platform, id, S, E);
          if (CAP_CACHE.size > CAP_MAX) CAP_CACHE.clear();
          CAP_CACHE.set(k2, { at: Date.now(), val: j });
          try { capDiskSave(); } catch (eDs) { }
          note('cap-worker-cached ' + k2);
        } catch (e) { }
      } WK_LAST = { ok: !!(j && j.ok), ms: (j && (j.total || j.ms)) || 0, tries: j && j.tries, err: j && j.err, nav: j && j.navMs, at: Date.now() };
    if (j && j.ok) { WK_OK++; note('cap-worker ok ' + platform + id + ' (' + ((j && (j.ms || j.total)) || 0) + 'ms, ' + ((j.variants || []).length) + ' res)'); } else { WK_ERR++; note('cap-worker-miss ' + platform + id + ': ' + ((j && j.err) || 'timeout') + ' (' + ((j && (j.total || j.ms)) || 0) + 'ms, launch ' + ((j && j.launchMs) || '?') + ', nav ' + ((j && j.navMs) || '?') + ', first ' + ((j && j.firstAt) || '-') + ')'); } resolve(j); };
    WK_WAIT.push(entry);
    try { ch.stdin.write(JSON.stringify(payload) + '\n'); } catch (e) { entry(null); return; }
    const tm = setTimeout(() => entry(null), Math.max(20000, (ms || 20000) + 12000));
  });
}

function capWarm() { if (WORKER_ON) wkSpawn(); }
let WK_LAST = null;
function capWorkerStats() { return { on: WORKER_ON ? 1 : 0, up: WK ? Math.round((Date.now() - WK_STARTED) / 1000) : 0, ok: WK_OK, err: WK_ERR, queued: WK_WAIT.length, started: WK_STARTED ? 1 : 0, last: WK_LAST }; }


let API = null, API_P = null, HS_P = null, SESS_AT = 0, BLOCK_UNTIL = 0;
let MAP = null, MAP_AT = 0, MAP_P = null;          // tmdb ⇄ anilist (অ্যানিমে সার্ভারগুলো এর উপর চলে)
const MAP_URL = process.env.NEXA_MAP_URL || 'https://backend.nexa.mov/v1/mapping/anilist-tmdb';
const MAP_TTL = Number(process.env.NEXA_MAP_TTL || 21600000);   // ৬ ঘণ্টা
const ENV_BAD_UNTIL = new Map();                    // codename → cooldown (BAD_ENVELOPE হলে খরচ বাঁচে)
const DIAG = { init: 0, initErr: '', sess: 0, sessErr: '', plan: 0, planErr: 0, pl200: 0, pl404: 0, pl400: 0, open: 0, cards: 0, probeOk: 0, probeFail: 0, last: [] };
const CARD_CACHE = new Map();   // key → {at, cards}
const PROBE_CACHE = new Map();  // url → {at, ok, quality, ct}
const CARD_TTL = Number(process.env.NEXA_CARD_TTL || 1800000);   /* ★ ৩০ মিনিট (ক্যাপচারের সমান) */
const PROBE_TTL = Number(process.env.NEXA_PROBE_TTL || 600000);
const MAXC = 400;

/* ───────────── প্রোক্সি-পুল (vidy/moviebox-এর মতোই) ─────────────
   nexa providers.nexa.mov ডেটাসেন্টার-IP-তে 429/403 দেয় ⇒ সব আপস্ট্রিম কল প্রথমে পুল-প্রোক্সি দিয়ে
   (CONNECT টানেল + TLS), ব্যর্থ হলে ডিরেক্টে। সেগমেন্ট-রিলেও একই পুল ⇒ ইউজার সরাসরি প্লে করে। */
let PX = [];
try {
  const pf = path.join(__dirname, 'vidy_proxy_pool.json');
  if (fs.existsSync(pf)) PX = JSON.parse(fs.readFileSync(pf, 'utf8')) || [];
} catch (e) { PX = []; }
const PX_STAT = new Map();   // px → {ok,fail,ms}
/* ইউজার-নিজের প্রোক্সি (রেসিডেন্সিয়াল/মোবাইল) — সবচেয়ে আগে চেষ্টা হয়:
   NEXA_RESI_PX="host:port:user:pass,host2:port2:u2:p2"  অথবা  "http://user:pass@host:port"   (কমা-বিভক্ত)
   এছাড়া nexa_proxy.json = [{px:"host:port", user:"…", pass:"…"}] হলেও চলে। */
const RESI = [];
(function () {
  const add = (host, port, user, pass) => { if (host && port) RESI.push({ px: host + ':' + port, user: user || '', pass: pass || '' }); };
  try {
    const raw = String(process.env.NEXA_RESI_PX || '').trim();
    for (const item of raw.split(',')) {
      const t = item.trim(); if (!t) continue;
      const m1 = t.match(/^https?:\/\/(?:([^:@]+):([^@]*)@)?([^:/]+):(\d+)/);
      if (m1) { add(m1[3], m1[4], m1[1] ? decodeURIComponent(m1[1]) : '', m1[2] ? decodeURIComponent(m1[2]) : ''); continue; }
      const p4 = t.split(':');
      if (p4.length >= 2) add(p4[0], p4[1], p4[2] || '', p4[3] || '');
    }
    const jf = path.join(__dirname, 'nexa_proxy.json');
    if (fs.existsSync(jf)) for (const c of (JSON.parse(fs.readFileSync(jf, 'utf8')) || [])) add(String(c.px || '').split(':')[0], String(c.px || '').split(':')[1] || c.port, c.user, c.pass);
  } catch (e) { note('resi-px-parse: ' + String((e && e.message) || e).slice(0, 60)); }
})();
function pxRec(px, good, ms) {
  const h = PX_STAT.get(px) || { ok: 0, fail: 0, ms: 0 };
  if (good) { h.ok++; h.ms = h.ms ? Math.round(h.ms * 0.7 + ms * 0.3) : ms; } else h.fail++;
  PX_STAT.set(px, h);
}
function pxRank() {
  return PX.slice().sort((a, b) => {
    const x = PX_STAT.get(a.px) || { ok: 0, fail: 0, ms: a.ms || 3000 };
    const y = PX_STAT.get(b.px) || { ok: 0, fail: 0, ms: b.ms || 3000 };
    const sx = (x.ms || 3000) + x.fail * 600 - Math.min(x.ok, 6) * 200;
    const sy = (y.ms || 3000) + y.fail * 600 - Math.min(y.ok, 6) * 200;
    return sx - sy;
  });
}
/* CONNECT-টানেল + TLS + raw HTTP/1.1 (GET/POST + Range + হেডার) — বাফার ফেরত দেয় */
function pxReq(px, method, url, body, hdrs, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(new Error('bad-url')); }
    const isHttps = u.protocol === 'https:';
    const port = Number(u.port) || (isHttps ? 443 : 80);
    const pxs = typeof px === 'string' ? { px: px } : px;
    const ci = String(pxs.px).indexOf(':');
    const phost = String(pxs.px).slice(0, ci), pport = Number(String(pxs.px).slice(ci + 1)) || 8080;
    px = pxs;
    const sock = net.connect({ host: phost, port: pport });
    let done = false;
    const to = setTimeout(() => { bail(new Error('px-timeout')); }, Math.max(3000, timeoutMs || 12000));
    function bail(e) { if (done) return; done = true; clearTimeout(to); try { sock.destroy(); } catch (e2) { } reject(e); }
    sock.once('error', bail);
    sock.once('connect', () => {
      let ch = 'CONNECT ' + u.hostname + ':' + port + ' HTTP/1.1\r\nHost: ' + u.hostname + ':' + port + '\r\n';
      if (px.user) ch += 'Proxy-Authorization: Basic ' + Buffer.from(px.user + ':' + px.pass).toString('base64') + '\r\n';
      sock.write(ch + '\r\n');
    });
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      sock.removeListener('data', onData);
      if (!/^HTTP\/1\.[01] 200/.test(buf.slice(0, i).toString('latin1'))) return bail(new Error('px-refused'));
      const stream = isHttps ? tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }) : sock;
      const go = () => {
        let hx = method + ' ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nConnection: close\r\n';
        for (const k of Object.keys(hdrs || {})) { if (hdrs[k] !== undefined && hdrs[k] !== null) hx += k + ': ' + hdrs[k] + '\r\n'; }
        if (body) hx += 'content-length: ' + body.length + '\r\n';
        stream.write(Buffer.from(hx + '\r\n', 'latin1'));
        if (body) stream.write(body);
        const chunks = [isHttps ? Buffer.alloc(0) : buf.slice(i + 4)];
        let head = '', hdrDone = false;
        stream.on('data', d2 => {
          if (!hdrDone) {
            head += d2.toString('latin1');
            const j = head.indexOf('\r\n\r\n');
            if (j < 0) return;
            hdrDone = true;
            if (isHttps) chunks.push(Buffer.from(head.slice(j + 4), 'latin1'));
            head = head.slice(0, j);
            return;
          }
          chunks.push(d2);
        });
        stream.on('close', () => {
          if (done) return;
          done = true; clearTimeout(to);
          let raw = Buffer.concat(chunks);
          if (/transfer-encoding: *chunked/i.test(head)) {
            const out = []; let p2 = 0;
            while (p2 < raw.length) {
              const e = raw.indexOf('\r\n', p2); if (e < 0) break;
              const n = parseInt(raw.slice(p2, e).toString('latin1'), 16);
              if (!n) break;
              out.push(raw.slice(e + 2, e + 2 + n)); p2 = e + 2 + n + 2;
            }
            raw = Buffer.concat(out);
          }
          if (maxBytes && raw.length > maxBytes) raw = raw.slice(0, maxBytes);
          const code = parseInt((head.split('\r\n')[0] || '').split(' ')[1] || '0', 10);
          const hcopy = {};
          for (const ln of head.split('\r\n').slice(1)) { const c = ln.indexOf(':'); if (c > 0) hcopy[ln.slice(0, c).toLowerCase()] = ln.slice(c + 1).trim(); }
          resolve({ code, body: raw, headers: hcopy });
        });
        stream.once('error', bail);
      };
      if (isHttps) tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => { }).destroy(); // (no-op guard)
      if (isHttps) {
        const tl = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
          let hx = method + ' ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nConnection: close\r\n';
          for (const k of Object.keys(hdrs || {})) { if (hdrs[k] !== undefined && hdrs[k] !== null) hx += k + ': ' + hdrs[k] + '\r\n'; }
          if (body) hx += 'content-length: ' + body.length + '\r\n';
          tl.write(Buffer.from(hx + '\r\n', 'latin1'));
          if (body) tl.write(body);
          const chunks = [buf.slice(i + 4)];
          let head = '', hdrDone = false;
          tl.on('data', d2 => {
            if (!hdrDone) {
              head += d2.toString('latin1');
              const j = head.indexOf('\r\n\r\n');
              if (j < 0) return;
              hdrDone = true;
              chunks.push(Buffer.from(head.slice(j + 4), 'latin1'));
              head = head.slice(0, j);
              return;
            }
            chunks.push(d2);
          });
          tl.on('close', () => {
            if (done) return;
            done = true; clearTimeout(to);
            let raw = Buffer.concat(chunks);
            if (/transfer-encoding: *chunked/i.test(head)) {
              const out = []; let p2 = 0;
              while (p2 < raw.length) {
                const e = raw.indexOf('\r\n', p2); if (e < 0) break;
                const n = parseInt(raw.slice(p2, e).toString('latin1'), 16);
                if (!n) break;
                out.push(raw.slice(e + 2, e + 2 + n)); p2 = e + 2 + n + 2;
              }
              raw = Buffer.concat(out);
            }
            if (maxBytes && raw.length > maxBytes) raw = raw.slice(0, maxBytes);
            const code = parseInt((head.split('\r\n')[0] || '').split(' ')[1] || '0', 10);
            const hcopy = {};
            for (const ln of head.split('\r\n').slice(1)) { const c = ln.indexOf(':'); if (c > 0) hcopy[ln.slice(0, c).toLowerCase()] = ln.slice(c + 1).trim(); }
            resolve({ code, body: raw, headers: hcopy });
          });
          tl.once('error', bail);
        });
      } else { go(); }
    };
    sock.on('data', onData);
  });
}

/* এক দরজা, দুই পথ: ডিরেক্টে আগে (দ্রুত), তারপর 429/403/নেট-ব্যর্থতায় প্রোক্সি-পুল (প্যারালাল)।
   nexa providers.nexa.mov ডেটাসেন্টার-IP-তে মাঝে মাঝে 429 দেয় — vidy/moviebox-এর মতোই পুল সামলায়। */
const PXTRIES = Math.max(1, Number(process.env.NEXA_PXTRIES || 2));
const PX_PAR = String(process.env.NEXA_PXPAR || '1') !== '0';
function directReq(url, method, body, hdrs, ms, maxBytes) {
  const ctl = new AbortController();
  const tm = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, ms);
  return fetch(url, { method, body: body || undefined, headers: hdrs, signal: ctl.signal, redirect: 'follow' })
    .then(async r => {
      const ab = await r.arrayBuffer();
      let buf = Buffer.from(ab);
      if (maxBytes && buf.length > maxBytes) buf = buf.slice(0, maxBytes);
      const hcopy = {}; try { r.headers.forEach((v, k) => { hcopy[k.toLowerCase()] = v; }); } catch (e) { }
      return { code: r.status, body: buf, headers: hcopy };
    }).finally(() => clearTimeout(tm));
}
async function upFetch(url, opts) {
  opts = opts || {};
  const hdrs = Object.assign({ 'user-agent': UA, 'origin': 'https://nexa.mov', 'referer': 'https://nexa.mov/', 'accept': '*/*' }, opts.headers || {});
  const body = opts.body || null;
  const method = opts.method || 'GET';
  const ms = opts.ms || 15000;
  /* ১) ডিরেক্টে */
  try {
    const r = await directReq(url, method, body, hdrs, Math.min(ms, 9000), opts.maxBytes);
    if (r.code !== 429 && r.code !== 403) return r;
    if (String(process.env.NEXA_PROXY || '1') === '0' || !PX.length) return r;
    note('direct ' + r.code + ' → proxy');
  } catch (e) {
    if (String(process.env.NEXA_PROXY || '1') === '0' || !PX.length) throw e;
  }
  /* ২ক) ইউজার-নিজের (রেসিডেন্সিয়াল) প্রোক্সি — থাকলে সবচেয়ে আগে */
  if (RESI.length) {
    for (const c of RESI.slice(0, 2)) {
      try {
        const r = await pxReq(c, method, url, body, hdrs, Math.min(ms, 12000), opts.maxBytes);
        if (r.code !== 403 && r.code !== 407) { note('resi-px ok ' + c.px); return r; }
        note('resi-px ' + r.code + ' ' + c.px);
      } catch (e) { note('resi-px-fail ' + c.px + ' ' + String((e && e.message) || e).slice(0, 40)); }
    }
  }
  /* ২খ) প্রোক্সি-পুল (প্যারালাল, ছোট বাজেট) */
  const cands = pxRank().slice(0, PXTRIES);
  const one = c => pxReq(c.px, method, url, body, hdrs, Math.min(ms, 7000), opts.maxBytes)
    .then(r => { pxRec(c.px, r.code < 400, 1); if (r.code === 403 || r.code === 407) throw new Error('px-http-' + r.code); return r; })
    .catch(e => { pxRec(c.px, false, 1); throw e; });
  if (PX_PAR && cands.length > 1) {
    try { return await Promise.any(cands.map(one)); } catch (e) { }
  } else {
    for (const c of cands) { try { return await one(c); } catch (e) { } }
  }
  /* ৩) শেষ চেষ্টা: ডিরেক্টে (লম্বা টাইমআউট) */
  return directReq(url, method, body, hdrs, ms, opts.maxBytes);
}

function note(s) { try { DIAG.last.push(String(s).slice(0, 160)); if (DIAG.last.length > 25) DIAG.last.shift(); } catch (e) { } }
function nexOn(cfg) { return !(cfg && cfg.nex === 0); }

/* ───────────── wasm মডিউল (একবারই) ───────────── */
async function getApi() {
  if (API) return API;
  if (API_P) return API_P;
  API_P = (async () => {
    const t0 = Date.now();
    const origFetch = globalThis.fetch;
    try {
      const mod = await import(require('url').pathToFileURL(MOD).href);
      const factory = mod.default;
      /* emscripten Node-এও `fetch` দেখে ⇒ web-পথ নেয়, আর রিলেটিভ wasm-URL পার্স হয় না।
         তাই ইনিশিয়ালাইজেশনের মুহূর্তে wasm-URL-গুলো লোকাল ফাইল থেকেই দিই (বাকি সব পাস-থ্রু)। */
      const wasmBytes = fs.readFileSync(WASM);
      globalThis.fetch = async (u, o) => {
        const url = typeof u === 'string' ? u : ((u && u.url) || String(u));
        if (/\.wasm(\?|$)/.test(url)) return new Response(wasmBytes, { status: 200, headers: { 'content-type': 'application/wasm' } });
        return origFetch(u, o);
      };
      API = await factory({});
      DIAG.init = Date.now() - t0;
      if (!API || typeof API.handshake !== 'function') throw new Error('abi-mismatch');
      return API;
    } catch (e) {
      DIAG.initErr = String((e && e.message) || e).slice(0, 120);
      note('init-fail: ' + DIAG.initErr);
      API = null;
      return null;
    } finally { try { globalThis.fetch = origFetch; } catch (e) { } API_P = null; }
  })();
  return API_P;
}

/* ───────────── HTTP ───────────── */
async function postRaw(p, body, ms) {
  try {
    const r = await upFetch(PROVIDERS + p, {
      method: 'POST', body, ms: Math.max(3000, ms || 15000), maxBytes: 262144,
      headers: { 'content-type': 'application/octet-stream' },
    });
    return { status: r.code, body: r.body, retryAfter: Number((r.headers && r.headers['retry-after']) || 0) || 0 };
  } catch (e) {
    return { status: 0, body: Buffer.alloc(0), err: String((e && e.message) || e).slice(0, 80) };
  }
}

/* ───────────── সেশন ───────────── */
async function ensureSession(ms) {
  const api = await getApi();
  if (!api) return null;
  if (api.hasSession()) return api;
  if (Date.now() < BLOCK_UNTIL) { note('session-blocked ' + Math.ceil((BLOCK_UNTIL - Date.now()) / 1000) + 's'); return null; }
  if (HS_P) return HS_P;
  HS_P = (async () => {
    try {
      const hs = await api.handshake({}, 'g:' + crypto.randomUUID());
      const r = await postRaw('/v1/session', Buffer.from(hs), ms);
      if (r.status === 200 && api.accept(new Uint8Array(r.body))) { SESS_AT = Date.now(); DIAG.sess++; return api; }
      if (r.status === 409) { note('session 409 (version skew)'); }
      /* 429 ⇒ সার্ভারই বলে কখন আবার: retry-after (ক্লায়েন্ট-কোডের মতোই) নাহলে ৬০সে ব্যাকঅফ */
      if (r.status === 429) {
        const ra = Number(r.retryAfter) > 0 ? Number(r.retryAfter) : 120;   // সার্ভারের retry-after, নাহলে ২ মিনিট
        BLOCK_UNTIL = Date.now() + Math.max(20, Math.min(900, ra)) * 1000;
        note('session-429 rate-limited ' + ra + 's');
      }
      DIAG.sessErr = 'session ' + r.status + (r.err ? ' ' + r.err : '');
      note('session-fail ' + r.status + ' ' + (r.err || ''));
      return api.hasSession() ? api : null;
    } catch (e) {
      DIAG.sessErr = String((e && e.message) || e).slice(0, 120);
      note('hs-fail: ' + DIAG.sessErr);
      return null;
    } finally { HS_P = null; }
  })();
  return HS_P;
}

/* ───────────── প্লেলিস্ট (সার্ভার-প্রতি) ───────────── */
async function playlistFor(api, plan, ms) {
  if (Date.now() < BLOCK_UNTIL) return null;
  let r = await postRaw('/v1/playlist', Buffer.from(plan.envelope), ms);
  DIAG.plan++;
  if (r.status === 401) {            // সেশন-মেয়াদোত্তীর্ণ ⇒ রিসেট করে একবার আবার (ক্লায়েন্ট-কোডের মতোই)
    try { api.reset(); } catch (e) { }
    const a2 = await ensureSession(ms);
    if (!a2) { DIAG.planErr++; return null; }
    r = await postRaw('/v1/playlist', Buffer.from(plan.envelope), ms);
  }
  if (r.status === 200) {
    DIAG.pl200++;
    try {
      const info = api.open(plan.header, new Uint8Array(r.body));
      if (!info) { DIAG.planErr++; return null; }
      DIAG.open++;
      return info;
    } catch (e) { DIAG.planErr++; note('open-fail: ' + String((e && e.message) || e)); return null; }
  }
  if (r.status === 429) { BLOCK_UNTIL = Date.now() + 60000; note('playlist-429 → 60s backoff'); }
  if (r.status === 400) { ENV_BAD_UNTIL.set(plan.codename, Date.now() + 300000); note(plan.codename + ' envelope rejected → 5m cooldown'); }  // v1.34.323
  if (r.status === 404) DIAG.pl404++; else DIAG.pl400++;
  note(plan.codename + ' -> ' + r.status + ' ' + r.body.slice(0, 12).toString('latin1').trim());
  return null;
}

/* ───────────── প্রোব: URL সত্যিই চলে? রেজোলিউশন কত? ───────────── */
async function probe(u, hdrs, ms) {
  const hit = PROBE_CACHE.get(u);
  if (hit && Date.now() - hit.at < PROBE_TTL) return hit;
  let out = { at: Date.now(), ok: 0, quality: '', ct: '', why: '' };
  try {
    const r = await upFetch(u, {
      ms: Math.max(4000, ms || 9000), maxBytes: 65536,
      headers: Object.assign({ 'range': 'bytes=0-32767', 'referer': 'https://nexa.mov/' }, hdrs || {}),
    });
    out.ct = String((r.headers && r.headers['content-type']) || '');
    if (r.code === 200 || r.code === 206) {
      const txt = r.body.toString('utf8').slice(0, 40000);
      if (txt) {
        out.ok = 1;
        const res = [...txt.matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map(m => parseInt(m[2], 10));
        if (res.length) {
          const best = Math.max.apply(null, res);
          out.quality = String(best >= 2160 ? 2160 : best >= 1080 ? 1080 : best >= 720 ? 720 : best >= 480 ? 480 : best);
        } else if (/^#EXTM3U/.test(txt)) {
          out.quality = '';         // মিডিয়া-প্লেলিস্ট: RESOLUTION লেখাই নেই ⇒ 'Auto' (বানানো নয়)
        } else if (/ftyp|moov|mdat/.test(txt.slice(0, 400))) {
          out.quality = '';         // সরাসরি MP4 ⇒ রেজো অজানা
        } else { out.ok = 0; out.why = 'not-media'; }
      } else { out.ok = 0; out.why = 'empty'; }
    } else { out.ok = 0; out.why = 'http-' + r.code; }
  } catch (e) { out.ok = 0; out.why = String((e && e.name) || e).slice(0, 40); }
  if (out.ok) DIAG.probeOk++; else DIAG.probeFail++;
  if (PROBE_CACHE.size > 600) PROBE_CACHE.clear();
  PROBE_CACHE.set(u, out);
  return out;
}

/* ───────────── tmdb ⇄ anilist ম্যাপিং (অ্যানিমে ৪ সার্ভারের জন্য) ─────────────
   আপস্ট্রিম ফরম্যাট: {schema:'anilist-tmdb/1', a:[[anilistId, ?, [[type, tmdbId, ?, '1-26'], ...]], ...]}
   type: 0=movie, 1=tv. আমরা tmdbId → [anilistId…] আর anilistId → tmdbId দুই দিকেই সূচি বানাই। */
async function getMapping(ms) {
  if (MAP && Date.now() - MAP_AT < MAP_TTL) return MAP;
  if (MAP_P) return MAP_P;
  MAP_P = (async () => {
    try {
      const r = await upFetch(MAP_URL, { ms: Math.max(4000, ms || 12000), maxBytes: 4 * 1024 * 1024 });
      if (r.code !== 200) { note('map http-' + r.code); return MAP; }
      const j = JSON.parse(r.body.toString('utf8'));
      const t2a = new Map(), a2t = new Map();
      const rows = Array.isArray(j && j.a) ? j.a : [];
      for (const row of rows) {
        const aid = Number(row && row[0]) || 0; if (!aid) continue;
        const list = Array.isArray(row[2]) ? row[2] : [];
        for (const e of list) {
          const tmdbId = Number(e && e[1]) || 0; if (!tmdbId) continue;
          const isTv = Number(e[0]) === 1;
          if (!t2a.has(tmdbId)) t2a.set(tmdbId, []);
          const arr = t2a.get(tmdbId);
          if (arr.indexOf(aid) < 0) arr.push(aid);
          if (!a2t.has(aid)) a2t.set(aid, { tmdbId: tmdbId, tv: isTv });
        }
      }
      MAP = { t2a: t2a, a2t: a2t, ids: t2a.size, at: Date.now() };
      MAP_AT = Date.now();
      note('map loaded ' + t2a.size + ' tmdb ids');
      return MAP;
    } catch (e) { note('map-fail: ' + String((e && e.message) || e).slice(0, 80)); return MAP; }
    finally { MAP_P = null; }
  })();
  return MAP_P;
}

/* ───────────── মূল এন্ট্রি ───────────── */
function mkCards(list, meta) {
  const out = [];
  const size = String(meta.title || '').trim();
  for (const it of list) {
    const q = it.quality || '';
    const srvLabel = it.label || it.codename;
    const txt = '⧉ ' + (size || 'nexa.mov') + (meta.year ? ' | ' + meta.year + ' |' : ' |')
      + '\n' + (meta.type === 'series' && meta.s > 0 ? '⧠ S' + meta.s + 'E' + meta.e : '⧠ Movie')
      + '\n' + '⊞ nexa ◧ ' + srvLabel + (it.audio ? ' ⌗ ' + it.audio : '');
    const bh = { notWebReady: false, isBingeable: true, filename: 'nexa-' + it.codename + '-' + (q || 'auto') + (it.kind === 'file' ? '.mp4' : '.m3u8') };
    if (it.headers && Object.keys(it.headers).length) bh.proxyHeaders = { request: it.headers };
    out.push({
      name: '\u25a5 ' + (q || 'Auto') + ' \u25a5',
      title: txt, description: txt,
      quality: String(q || ''),
      url: it.url,
      behaviorHints: bh,
      bingeGroup: 'nex|' + mlsNorm(size) + '::' + (meta.type === 'series' && meta.s > 0 ? 'S' + meta.s + 'E' + meta.e : 'm'),
    });
  }
  return out;
}
function mlsNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

/* ───────────── ব্রাউজার-ক্যাপচার ক্লায়েন্ট ───────────── */
/* ★ v1.34.327: স্ট্রিম-রিকোয়েস্ট ব্লক করা যায় না (সাইটের কোল্ড-লোড ৩–২৭সে),
   তাই ব্যাকগ্রাউন্ডে ক্যাপচার শুরু হয় আর ক্যাশ ভরে গেলে পরের রিকোয়েস্টে কার্ড আসে।
   (server.js-এর SDL বাজেট ১০সে — অন্য ১৬ সোর্সের সময় কেড়ে নেওয়া চলবে না।) */
const WARM = new Map();          // key → startedAt (একই টাইটেলে বারবার ক্যাপচার নয়)
const WARM_TTL = Number(process.env.NEXA_WARM_TTL || 1200000);   // ২০ মিনিট
function warmNexa(platform, id, S, E, ms) {
  if (!CAP_URL) return;
  const key = capKey(platform, id, S, E);
  const hit = CAP_CACHE.get(key);
  if (hit && Date.now() - hit.at < CAP_TTL) return;          // ক্যাশ ঠিক আছে
  const w = WARM.get(key);
  if (w && Date.now() - w < WARM_TTL) return;                 // ইতিমধ্যে চলছে/হয়েছে
  WARM.set(key, Date.now());
  if (WARM.size > 500) WARM.clear();
  capFetch(platform, id, S, E, Math.max(45000, ms || 0))
    .then(j => { if (j) note('warm-ok ' + key + ' (' + (j.variants || []).length + ' res)'); })
    .catch(() => { });
}

function capKey(platform, id, S, E) { return platform + ':' + id + ':' + (E ? 'S' + S + 'E' + E : 'm'); }

/* ★★ v1.34.398 (মাপা: worker `err:15`, `queued:3`, `tries:null` ⇒ ক্যাপচার শুরুতেই মরে) —
   একই টাইটেলে একসাথে কয়েকটা ক্যাপচার (বুট-প্রিওয়ার্ম + ইউজার-রিকোয়েস্ট + পটভূমি) গিয়ে
   **একাধিক chromium** খুলছিল; ১GB cgroup + ৬৪MB /dev/shm-এ সেটা সঙ্গে সঙ্গে মরে।
   এখন per-key single-flight: একই কী-তে একটাই ক্যাপচার চলবে, বাকিরা তার ফল ভাগ করবে। */
const CAP_INFLIGHT = new Map();
async function capFetch(platform, id, S, E, ms) {
  if (!CAP_URL) return null;
  const key = capKey(platform, id, S, E);
  const _hit0 = CAP_CACHE.get(key);
  if (_hit0 && !_hit0.bad && _hit0.val && Date.now() - _hit0.at < CAP_TTL) return _hit0.val;
  const _inf = CAP_INFLIGHT.get(key);
  if (_inf) { try { note('cap-inflight-join ' + key); } catch (e) { } return _inf; }
  const _pr = capFetch1(platform, id, S, E, ms).finally(() => { try { CAP_INFLIGHT.delete(key); } catch (e) { } });
  CAP_INFLIGHT.set(key, _pr);
  return _pr;
}
async function capFetch1(platform, id, S, E, ms) {
  if (!CAP_URL) return null;
  const key = capKey(platform, id, S, E);
  const hit = CAP_CACHE.get(key);
  /* ★ v1.34.368: নেগেটিভ-ক্যাশ আলাদা ও ছোট (৪৫s)। আগে bad-এন্ট্রিও ৩০ মিনিট বেঁচে থেকে
     `return hit.val` (=null) করত ⇒ একবার ফেল করা টাইটেল আধা ঘণ্টা "মৃত" থাকত। */
  if (hit && hit.bad) {
    if (Date.now() - hit.at < Number(process.env.NEXA_NEG_TTL || 45000)) return null;
    CAP_CACHE.delete(key);
  } else if (hit && Date.now() - hit.at < CAP_TTL) {
    return hit.val;
  }
  if (CAP_CLI) {
    if (WORKER_ON) {   /* ★ v1.34.373: pxOverride এখানে নেই (সেটা capCliOnce-এর প্যারাম) — ReferenceError-এ পুরো পথ মরত */
      /* ★ v1.34.367: worker-ই যথেষ্ট (ভিতরে ৩ রিলোড-চেষ্টা); এক-শট CLI ফলব্যাক বাদ — নাহলে ১২s গেটওয়ে ভাঙে */
      const w = await capWorker(platform, id, S, E, Math.max(26000, ms || 16000));   /* ★ v1.34.400: লোকালে মাপা ১৫সে ⇒ ২৬সে বাজেট */
      try { if (w && !w.ok) note('cap-worker-dbg ' + JSON.stringify(w.dbg || { statuses: (w.statuses || []).slice(-3), err: w.err, tries: w.tries }).slice(0, 300)); } catch (eD) { }
      if (w && w.ok && Array.isArray(w.variants) && w.variants.length) {
        if (CAP_CACHE.size > CAP_MAX) CAP_CACHE.clear();
        CAP_CACHE.set(key, { at: Date.now(), val: w });
        note('cap-cli ' + key + ': ' + w.variants.length + ' res (' + (w.total || w.ms || 0) + 'ms, warm)');
        return w;
      }
      CAP_CACHE.set(key, { at: Date.now(), bad: 1, val: null });
      return null;
    }
    /* ★ v1.34.349: প্রোডে প্রমাণ — প্রোক্সি-পুলের নোডগুলো মরা (BAD_PROXY/ERR_TUNNEL) অথচ
       কনটেইনারের নিজের IP-তে nexa ঠিকই playlist দেয় (3840x1600, ৭.৯সে)। তাই ক্রম:
       ১) ডিরেক্ট (প্রোক্সি ছাড়া)  ২) ব্যর্থ হলে তবেই ২টি ভেরিফায়েড নোড। */
    const budget = Math.max(12000, ms || 20000);
    /* ★ v1.34.350: লোকাল স্যান্ডবক্স IP-তে nexa ৪০সে+ ঝুলে থাকে, প্রোড IP-তে ৮সে-তে দেয়।
       তাই প্রোড-প্রমাণিত ক্রম (ডিরেক্ট আগে); লোকাল ডিবাগে NEXA_CAP_PX_FIRST=1 দিলে প্রোক্সি আগে। */
    const tries = (process.env.NEXA_CAP_PX_FIRST === '1')
      ? CAP_PROXY_LIST.slice(0, 3)
      : [''].concat(CAP_PROXY_LIST.slice(0, 2));
    const per = Math.max(9000, Math.min(16000, Math.round(budget / 3) + 5000));
    for (let i = 0; i < tries.length; i++) {
      const px = tries[i];
      const j = await capCliOnce(platform, id, S, E, per, px);
      if (j && j.ok && Array.isArray(j.variants) && j.variants.length) {
        if (CAP_CACHE.size > CAP_MAX) CAP_CACHE.clear();
        CAP_CACHE.set(key, { at: Date.now(), val: j });
        note('cap-cli ' + key + ': ' + j.variants.length + ' res (' + (j.ms || 0) + 'ms, '
          + (px ? 'px ' + px : 'direct') + ')');
        return j;
      }
      note('cap-cli-miss ' + key + ' #' + i + ': ' + ((j && (j.err || j.error)) || 'no-out')
        + ' (' + ((j && j.ms) || 0) + 'ms, ' + (px ? px : 'direct') + ')');
    }
    CAP_CACHE.set(key, { at: Date.now(), bad: 1, val: null });
    return null;
  }
  const q = new URLSearchParams({ platform, id: String(id) });
  if (E) { q.set('s', String(S)); q.set('e', String(E)); }
  q.set('timeout', String(Math.max(12, Math.round((ms || 26000) / 1000))));
  try {
    const r = await directReq(CAP_URL.replace(/\/+$/, '') + '/cap?' + q.toString(), 'GET', null,
      { accept: 'application/json' }, Math.max(22000, (ms || 26000) + 14000), 262144);
    if (r.code !== 200) { CAP_CACHE.set(key, { at: Date.now(), bad: 1, val: null }); return null; }
    const j = JSON.parse(r.body.toString('utf8'));
    if (!j || !j.ok || !Array.isArray(j.variants) || !j.variants.length) {
      note('cap-miss ' + key + ': ' + ((j && (j.err || j.error)) || 'empty'));
      CAP_CACHE.set(key, { at: Date.now(), bad: 1, val: null });
      return null;
    }
    if (CAP_CACHE.size > CAP_MAX) CAP_CACHE.clear();
    CAP_CACHE.set(key, { at: Date.now(), val: j });
    return j;
  } catch (e) {
    CAP_CACHE.set(key, { at: Date.now(), bad: 1, val: null });
    return null;
  }
}

/* ক্যাপচার-ফল → কার্ড। রেজলিউশন আসে master-paylist-এর RESOLUTION= থেকে (বানানো নয়);
   URL রিলে-র মাধ্যমে যায় (রিলে referer বসায়, নাহলে totallyacdn 302/ডিকয় দেয়)। */

/* ───────── অডিও-ট্র্যাক মেটা (v1.34.377) ─────────
   nexa-র ভিডিও-প্লেলিস্ট প্রায়ই *নীরব* — অডিও আলাদা `#EXT-X-MEDIA:…TYPE=AUDIO` ইউআরআই-তে।
   আমরা ওই অডিও-ভ্যারিয়েন্টটি জানি (capture-এর `audio`), তাই master-বানিয়ে দিই ⇒ প্লেয়ারে সাউন্ড আসে। */
function capAudioInfo(j) {
  const h = j && j.headers || {};
  const a = String((j && j.audio) || '');
  const m = a.match(/[?&]lang=([a-zA-Z-]{2,8})/) || a.match(/\.([a-z]{2})(?:\.|\?|$)/);
  return {
    has: !!a,
    lang: (m && m[1]) ? m[1].toLowerCase() : '',
    name: (j && j.audioName) || '',
    forced: /&forced=1|FORCED=YES/i.test(a),
  };
}
/* এক ভিডিও-ভ্যারিয়েন্ট + অডিও-ট্র্যাক ⇒ রিলে-র `/p.m3u8` রেন্ডার করার সময় master বানানো হবে */
function capIsMuxed(j, v) {
  const au = capAudioInfo(j);
  if (!au.has || !v || !v.url) return false;
  return true;
}
function capAudioTag(j) {
  const au = capAudioInfo(j);
  if (!au.has) return '';
  return ' \u266b ' + (au.name || au.lang || 'audio');
}

function capCards(j, meta, origin, extraHdrs) {
  const out = [];
  const seen = new Set();
  /* ★ v1.34.379: একাধিক সোর্স (Nova/Onyx/Flux/Sylver/Orion) — প্রতিটির সবচেয়ে ভালো ২টি রেজলিউশন */
  const list = (j && Array.isArray(j.sources2) && j.sources2.length) ? j.sources2 : [j];
  for (const S of list) {
    const srvName = S.server || (j.server) || (meta.label || 'nexa');
    const vs = (S.variants || []).slice(0, 2);
    const sj = { headers: j.headers, audio: S.audio, audioName: S.audioName, codecs: S.codecs };
    for (const v of vs) {
      if (!v || !v.url || seen.has(v.url)) continue;
      seen.add(v.url);
      const h = Number(v.h) || 0;
      const q = h >= 2160 ? 2160 : h >= 1440 ? 1440 : h >= 1080 ? 1080 : h >= 720 ? 720 : h >= 480 ? 480 : 0;
      const srv = srvName;
      const cod = (() => {
        const c = String(sj.codecs || '').toLowerCase();
        if (!c) return '';
        if (c.indexOf('hvc1') >= 0 || c.indexOf('hev1') >= 0) return 'HEVC';
        if (c.indexOf('avc1') >= 0) return 'H.264';
        if (c.indexOf('av01') >= 0) return 'AV1';
        if (c.indexOf('vp09') >= 0) return 'VP9';
        return '';
      })();
      const txt = '\u25a4 ' + (meta.title || '') + ' (' + (meta.year || '') + ')'
        + '\n' + '\u25a6 ' + srv + ' \u00b7 ' + (v.res || 'auto') + (cod ? ' \u00b7 ' + cod : '') + capAudioTag(sj)
        + '\n' + '\u229e nexa \u25e7 ' + (q ? q + 'p' : 'Auto');
      const bh = { notWebReady: false, isBingeable: true, filename: 'nexa-' + mlsNorm(srv) + '-' + (q || 'auto') + '.m3u8' };
      const hdrs = Object.assign({}, j.headers || {}, extraHdrs || {});
      if (Object.keys(hdrs).length) bh.proxyHeaders = { request: hdrs };
      /* ★ v1.34.383: `bingeGroup`-এ 'nex|' প্রিফিক্স — vidy-র unify/fmt পথ এটাই চেনে
         (আগে 'nex|srv|title' ছিল না ⇒ nexa কার্ড ফরম্যাট-ধাপে বাদ পড়ত) */
      out.push({
        _src: 'nex',
        name: '\u25a5 ' + (q || 'Auto') + ' \u25a5',
        title: txt, description: txt,
        quality: q ? String(q) : '',
        url: nexRelayUrl(v.url, origin) + (S.audio ? '?a=' + nexB(S.audio) : ''),
        behaviorHints: bh,
        bingeGroup: 'nex|' + mlsNorm(srv) + '|' + mlsNorm(meta.title || '') + '::' + (meta.e ? 'S' + meta.s + 'E' + meta.e : 'm'),
      });
    }
  }
  return out;
}

function __legacyCapCards(j, meta, origin, extraHdrs) {
  const out = [];
  const seen = new Set();
  const vs = (j.variants || []).slice(0, 4);
  for (const v of vs) {
    if (!v || !v.url || seen.has(v.url)) continue;
    seen.add(v.url);
    const h = Number(v.h) || 0;
    const q = h >= 2160 ? 2160 : h >= 1440 ? 1440 : h >= 1080 ? 1080 : h >= 720 ? 720 : h >= 480 ? 480 : 0;
    const srv = j.server || meta.label || 'nexa';
    const cod = (() => {   /* কোডেক-মেটা master-এ থাকলে দেখাই; না থাকলে কিছু বলি না (বানানো নয়) */
      const c = String(j && j.codecs || '').toLowerCase();
      if (!c) return '';
      if (c.indexOf('hvc1') >= 0 || c.indexOf('hev1') >= 0) return 'HEVC';
      if (c.indexOf('avc1') >= 0) return 'H.264';
      if (c.indexOf('av01') >= 0) return 'AV1';
      if (c.indexOf('vp09') >= 0) return 'VP9';
      return '';
    })();
    const txt = '\u25a4 ' + (meta.title || '') + ' (' + (meta.year || '') + ')'
      + '\n' + '\u25a6 ' + srv + ' \u00b7 ' + (v.res || 'auto') + (cod ? ' \u00b7 ' + cod : '') + capAudioTag(j)
      + '\n' + '\u229e nexa \u25e7 ' + (q ? q + 'p' : 'Auto');
    const bh = { notWebReady: false, isBingeable: true, filename: 'nexa-' + mlsNorm(srv) + '-' + (q || 'auto') + '.m3u8' };
    const hdrs = Object.assign({}, j.headers || {}, extraHdrs || {});
    if (Object.keys(hdrs).length) bh.proxyHeaders = { request: hdrs };
    out.push({
      name: '\u25a5 ' + (q || 'Auto') + ' \u25a5',
      title: txt, description: txt,
      quality: q ? String(q) : '',
      url: nexRelayUrl(v.url, origin) + (capIsMuxed(j, v) ? '?a=' + nexB(j.audio) : ''),
      behaviorHints: bh,
      bingeGroup: 'nex|' + mlsNorm(meta.title || '') + '::' + (meta.e ? 'S' + meta.s + 'E' + meta.e : 'm'),
    });
  }
  return out;
}

const NEX_VER = '1.34.400';
async function nexStreams(tmdbId, type, s, e, origin, opts) {
  opts = opts || {};
  const TAG = String(opts.tag || '-');
  note(TAG + ' enter ' + NEX_VER + ' tmdb' + tmdbId + ' ' + type + ' capCl=' + CAP_CLI + ' wk=' + WORKER_ON);
  const RET = (n, why) => { note(TAG + ' ret:' + why + ' n=' + n); return n; };
  const t0 = Date.now();
  const ms = Math.max(4000, Number(opts.ms || 12000));
  /* ★ v1.34.381: 'tt1375666'-এর মতো IMDb-আইডিও চলবে — tmdb-ম্যাপিং থেকে সংখ্যায় নিই।
     (আগে Number('tt…')=NaN ⇒ সব IMDb-রুটে nexa নীরবে [] দিত।) */
  /* ★ v1.34.389 (মূল-কারণ): tmdb-রুট আইডি পাঠায় **'tmdb27205'** আকারে ⇒ `Number('tmdb27205')`
     = NaN ⇒ এই ফাংশন ৩ms-এ [] ফিরিয়ে দিত (প্রোড-লগ: `sr=['nex',0,3ms]`)। তাই 'tmdb' প্রিফিক্স
     ছাড়ানোর পর সংখ্যা ধরি; IMDb-রুটের 'tt…' আলাদা পথে। */
  const _rawId = String(tmdbId == null ? '' : tmdbId).trim().replace(/^tmdb/i, '');
  let id = Number(_rawId) || 0;
  if (!id && /^tt\d+$/i.test(String(tmdbId || ''))) {
    try {
      const mp0 = await getMapping(4000);
      const t0m = mp0 && mp0.i2t ? mp0.i2t.get(String(tmdbId)) : 0;
      if (t0m) { id = Number(t0m) || 0; note('imdb→tmdb ' + tmdbId + ' = ' + id); }
    } catch (e) { }
    if (!id) { note('imdb-map-miss ' + tmdbId); return []; }
  }
  if (!id) { note('ret:no-id ' + tmdbId); return []; }
  const isSeries = type === 'series';
  const S = isSeries ? Math.max(1, Number(s) || 1) : 0;
  const E = isSeries ? Math.max(1, Number(e) || 1) : 0;
  const key = 'tmdb:' + id + ':' + (isSeries ? 'S' + S + 'E' + E : 'm');
  const hit = CARD_CACHE.get(key);
  if (hit && hit.cards && hit.cards.length && Date.now() - hit.at < CARD_TTL) return RET(hit.cards, 'card-cache');

  const meta0 = { title: opts.title || '', year: opts.year || '', type: isSeries ? 'series' : 'movie', s: S, e: E };
  /* ★ v1.34.366: ক্যাপচার ক্যাশে থাকলে কার্ড সাথে সাথে পুনর্নির্মাণ (CARD_CACHE হারালেও) —
     এতেই "ক্যাপচার সফল কিন্তু কার্ড ০" সমস্যা শেষ হয়। */
  try {
    const _ck0 = capKey('tmdb', id, S, E);
    const _ch0 = CAP_CACHE.get(_ck0);
    if (_ch0 && _ch0.val && Date.now() - _ch0.at < CAP_TTL) {
      const _c0 = capCards(_ch0.val, Object.assign({ label: 'nova' }, meta0), origin);
      note('cap-cache-hit tmdb' + id + ': rec=' + _c0.length + ' srcs=' + ((_ch0.val.sources2 || []).length) + ' vars=' + ((_ch0.val.variants || []).length));
      if (_c0.length) {
        if (CARD_CACHE.size > MAXC) CARD_CACHE.clear();
        CARD_CACHE.set(key, { at: Date.now(), cards: _c0 });
        note('cards-from-cap-cache tmdb' + id + ': ' + _c0.length + ' (cap ' + Math.round((Date.now() - _ch0.at) / 1000) + 's old)');
        return RET(_c0, 'cap-cache');
      }
    }
  } catch (e) { }
  /* ★ v1.34.327: পথ ১ — ব্রাউজার-ক্যাপচার (একমাত্র প্রমাণিত পথ) */
  /* ক্যাশ না থাকলে: ব্যাকগ্রাউন্ডে ওয়ার্ম শুরু — এই রিকোয়েস্টে অপেক্ষা করি না (SDL বাজেট) */
  const _ck = capKey('tmdb', id, S, E);
  const _ch = CAP_CACHE.get(_ck);
  const _hasCap = _ch && Date.now() - _ch.at < CAP_TTL && _ch.val;
  note('cap-state hasCap=' + (_hasCap ? 1 : 0) + ' raw=' + (!!_ch) + ' age=' + (_ch ? Math.round((Date.now() - _ch.at) / 1000) + 's' : '-') + ' bad=' + ((_ch && _ch.bad) ? 1 : 0) + ' capUrl=' + (CAP_URL ? 1 : 0) + ' worker=' + (WORKER_ON ? 1 : 0));
  /* ★ v1.34.329: 1.34.327-এর বাগ — ক্যাশ না থাকলে এখানেই `return []` করতাম, ফলে Stremio-র
     *প্রথম* রিকোয়েস্টে nexa কার্ডই আসত না (Stremio দ্বিতীয়বার চায় না!) ⇒ "nexa থেকে কিছু
     পাচ্ছি না"। এখন প্রথমবারও ক্যাপচার-চেষ্টা করি (অ্যাডঅন-বাজেটের ভিতরে), ক্যাশ থাকলে তো কথাই নেই। */
  if (!_hasCap) {
    /* ★ v1.34.329b: এখানে warmNexa ডাকতাম — তাতে একই সময়ে দুটো chromium চালু হয়ে
       দুটোই ফেল করত (মেমরি+প্রক্সি দ্বন্দ্ব)। এখন শুধু একটা blocking ক্যাপচার। */
    /* ★★ v1.34.397 (মাপা: /_nextry ১৩সে-তে ৫০৪ ⇒ ক্যাপচার ১৩সে পেরোচ্ছে): এখানে `warmNexa` আর
       ডাকি না — নিচের `capFetch` নিজেই ক্যাপচার করে; দুটো একসাথে ডাকলে **দুটো chromium**
       চলত ⇒ দুটোই ধীর/ফেল। এখন একটাই blocking ক্যাপচার, বাজেটের ভিতরে। */
    note('cap-first-attempt tmdb' + id);
  }
  try {
    /* ★ v1.34.352: nexa-র কোল্ড ক্যাপচার ৫–১৪সে ⇒ BeamUp গেটওয়ে ১২s-এ ৫০৪ দেয়।
       তাই শুধু ~৬সে অপেক্ষা করি; দেরি হলে ক্যাপচার ব্যাকগ্রাউন্ডে চলতে থাকে আর
       ক্যাশ ভরে যায় ⇒ ইউজার পরেরবার ওই টাইটেল খুললেই কার্ড সাথে সাথে আসে। */
    /* ★ v1.34.388 (মূল-কারণ, প্রোডে মাপা): worker-এর ঠান্ডা ক্যাপচার **৮–৯সে** নেয়,
       কিন্তু এখানে মাত্র ৬সে অপেক্ষা করতাম ⇒ প্রথম অনুরোধে nexa-কার্ড কখনোই পৌঁছাত না,
       আর BeamUp-এ প্রতি রেপ্লিকা আলাদা (`/_nex`-এ worker up=205s, ক্যাপ-ক্যাশ ১) — তাই
       পরের ট্যাপেও প্রায়ই ঠান্ডা। এখন ডিফল্ট ৯.২সে (রুট-কাট SCAP=১২সে-র ভিতরে),
       আর worker ঠান্ডা হলে হালকা বাড়তি (NEXA_CAP_AWAIT_COLD=১০সে)। */
    const _awWarm = Math.max(4000, Math.min(Number(process.env.NEXA_CAP_AWAIT || 9200), ms - 1000));
    const _awCold = Math.max(_awWarm, Math.min(Number(process.env.NEXA_CAP_AWAIT_COLD || 9800), ms - 800));
    const _aw = _hasCap ? _awWarm : _awCold;
    const _capP = capFetch('tmdb', id, S, E, Math.max(ms, 20000));
    let j = await Promise.race([_capP, new Promise(r => { const t = setTimeout(() => r(null), _aw); if (t.unref) t.unref(); })]);
    if (!j) {
      note('cap-awaited-out tmdb' + id + ' (' + _aw + 'ms) → ব্যাকগ্রাউন্ডে চলবে');
      _capP.then(jj => {
        if (!jj || !jj.ok || !Array.isArray(jj.variants) || !jj.variants.length) return;
        try {
          const bg = capCards(jj, Object.assign({ label: 'nova' }, meta0), origin);
          if (bg.length) {
            if (CARD_CACHE.size > MAXC) CARD_CACHE.clear();
            CARD_CACHE.set(key, { at: Date.now(), cards: bg });
            note('cap-bg-filled tmdb' + id + ': ' + bg.length + ' cards (পরের রিকোয়েস্টে সাথে সাথে)');
          }
        } catch (e) { }
      }).catch(() => { });
    }
    if (!j) note('cap-null tmdb' + id);
    if (j) {
      const cards = capCards(j, Object.assign({ label: 'nova' }, meta0), origin);
      if (cards.length) {
        DIAG.cards += cards.length;
        note(TAG + ' cap tmdb' + id + ' (' + (isSeries ? 'S' + S + 'E' + E : 'movie') + '): '
          + (j.variants || []).length + ' res → ' + cards.length + ' cards');
        if (CARD_CACHE.size > MAXC) CARD_CACHE.clear();
        CARD_CACHE.set(key, { at: Date.now(), cards });
        return RET(cards, 'cap');
      }
      /* অ্যানিমে: anilist আইডি দিয়ে ক্যাপচার (৪টি অ্যানিমে সার্ভার) */
      try {
        const mp = await getMapping(3000);
        const aids = mp && mp.t2a ? (mp.t2a.get(id) || []) : [];
        for (const aid of aids.slice(0, 2)) {
          const aj = await capFetch('anilist', aid, S, E, ms);
          if (!aj) continue;
          const ac = capCards(aj, Object.assign({ label: 'kyoto' }, meta0), origin);
          if (ac.length) {
            DIAG.cards += ac.length;
            note('cap anilist' + aid + ': ' + ac.length + ' cards');
            if (CARD_CACHE.size > MAXC) CARD_CACHE.clear();
            CARD_CACHE.set(key, { at: Date.now(), cards: ac });
            return ac;
          }
        }
      } catch (e) { }
    }
  } catch (e) { note('cap-path-err ' + String((e && e.message) || e).slice(0, 120)); }

  const api = await ensureSession(ms);
  if (!api) return RET([], 'no-session');
  let plans = [];
  try {
    const q = isSeries ? { platform: 'tmdb', id: id, season: S, episode: E } : { platform: 'tmdb', id: id };
    plans = api.plan(q) || [];
  } catch (err) { note('plan-fail: ' + String((err && err.message) || err)); return []; }
  if (!plans.length) return RET([], 'plan-empty');

  /* ★ v1.34.323: টাইটেলটা অ্যানিমে হলে anilist-আইডি দিয়ে বাড়তি প্ল্যান — তাতেই ৪টি অ্যানিমে সার্ভার
     (kyoto/tokyo/hokkaido/fuji) ওই টাইটেলে হাজির হয়। tmdb-প্ল্যানের সাথে codename-এ ডিডুপ। */
  let animeNote = '';
  try {
    const mp = await getMapping(3000);
    const aids = mp && mp.t2a ? (mp.t2a.get(id) || []) : [];
    if (aids.length) {
      const have = new Set(plans.map(p => p.codename));
      let added = 0;
      for (const aid of aids.slice(0, 3)) {
        const aq = isSeries ? { platform: 'anilist', id: aid, season: S, episode: E } : { platform: 'anilist', id: aid };
        let ap = [];
        try { ap = api.plan(aq) || []; } catch (e) { continue; }
        for (const p of ap) { if (!have.has(p.codename)) { have.add(p.codename); plans.push(p); added++; } }
      }
      if (added) animeNote = ' +anilist(' + aids.slice(0, 3).join('/') + '):' + added;
    }
  } catch (e) { }

  const cat = (() => { try { return api.catalogue() || []; } catch (e) { return []; } })();
  const nameOf = new Map(cat.map(c => [c.codename, c.name]));

  const now0 = Date.now();
  plans = plans.filter(p => !(ENV_BAD_UNTIL.get(p.codename) > now0));   // BAD_ENVELOPE-এ ভরা সার্ভার খরচ করে না
  const deadline = t0 + ms;
  const jobs = plans.map(p => (async () => {
    if (Date.now() > deadline) return null;
    const info = await playlistFor(api, p, Math.max(2500, deadline - Date.now()));
    if (!info || !info.url) return null;
    const pr = await probe(info.url, info.headers, Math.max(3000, deadline - Date.now()));
    if (!pr.ok) return null;
    const aud = info.audioOptions && info.audioOptions.length ? String(info.audioOptions[0].label || info.audioOptions[0].lang || '') : '';
    return { codename: p.codename, label: nameOf.get(p.codename) || p.codename, url: nexRelayUrl(info.url, origin), _direct: info.url, kind: info.kind || '', headers: info.headers || null, quality: pr.quality, audio: aud };
  })().catch(() => null));

  const settled = await Promise.all(jobs);
  const good = settled.filter(Boolean);

  // কোয়ালিটি-ফিল্টার (cfg.nexq) — জানা-রেজো থাকলে তবেই ছাঁকা; অজানা (Auto) বাদ যায় না
  const want = (opts.q || []).map(Number).filter(Boolean);
  const kept = want.length ? good.filter(g => !g.quality || want.indexOf(Number(g.quality)) >= 0) : good;

  const meta = { title: opts.title || '', year: opts.year || '', type: isSeries ? 'series' : 'movie', s: S, e: E };
  const cards = mkCards(kept, meta);
  if (kept.length) DIAG.cards += cards.length;
  note(((isSeries ? 'S' + S + 'E' + E : 'movie') + ' tmdb' + id + ': ' + plans.length + ' srv → ' + good.length + ' ok (' + (Date.now() - t0) + 'ms) ' + kept.map(k => k.codename + (k.quality ? '@' + k.quality : '')).join(',')).slice(0, 150));
  /* ★ v1.34.372: খালি ফলাফল ক্যাশে নয় — নাহলে একবার ক্যাপচার-মিস হলেই ৩০ মিনিট ওই
     টাইটেল "মৃত" হয়ে থাকত এবং ক্যাপচার-পথ আর ডাকাই হতো না। */
  if (cards.length) {
    if (CARD_CACHE.size > MAXC) CARD_CACHE.clear();
    CARD_CACHE.set(key, { at: Date.now(), cards, mark: NEX_MARK++ });
  }
  /* ★ v1.34.383: ডায়াগনস্টিক — কোন ধাপে কতটা টিকল (গLOBAL-ফিল্টার কোথায় খাচ্ছে বোঝা যায়) */
  try { DIAG.out = (DIAG.out || 0) + 1; DIAG.lastN = (cards || []).length; } catch (e) { }
  RET(cards, 'plan');
  return cards;
}

/* ───────────── ডায়াগনস্টিক ───────────── */
function nexDiag() {
  const d = Object.assign({}, DIAG);
  d.servers = { movie: MOVIE_SRV, anime: ANIME_SRV };
  d.hasSession = null; d.cat = null;
  try { if (API) { d.hasSession = API.hasSession(); d.cat = (API.catalogue() || []).map(c => c.codename); } } catch (e) { }
  d.cardCache = CARD_CACHE.size; d.probeCache = PROBE_CACHE.size;
  d.mapping = MAP ? { tmdbIds: MAP.ids, at: new Date(MAP_AT).toISOString() } : null;
  try { d.worker = (typeof capWorkerStats === 'function') ? capWorkerStats() : null; } catch (e) { d.worker = 'err'; }
  d.ver = NEX_VER;
  try {
    d.caps = [...CAP_CACHE.entries()].slice(-8).map(([k, v]) => ({ k, age: Math.round((Date.now() - v.at) / 1000), bad: v.bad ? 1 : 0, res: (v.val && (v.val.variants || []).length) || 0 }));
    d.cardKeys = [...CARD_CACHE.keys()].slice(-6);
  } catch (e) { d.caps = 'err'; }
  d.proxies = { pool: PX.length, resi: RESI.length, bestPool: (pxRank()[0] || {}).px || null };
  d.envCool = [...ENV_BAD_UNTIL.entries()].filter(([, v]) => v > Date.now()).map(([k, v]) => k + ':' + Math.round((v - Date.now()) / 1000) + 's');
  d.blocked = BLOCK_UNTIL > Date.now() ? Math.round((BLOCK_UNTIL - Date.now()) / 1000) + 's' : 0;
  d.last = DIAG.last.slice(-8);
  return d;
}
async function nexSelftest(tmdbId, type, s, e) {
  const t0 = Date.now();
  const api = await ensureSession(15000);
  const out = { session: !!(api && api.hasSession()), ms: 0, plans: [], cards: 0 };
  if (api) {
    try {
      const q = type === 'series' ? { platform: 'tmdb', id: Number(tmdbId), season: Number(s || 1), episode: Number(e || 1) } : { platform: 'tmdb', id: Number(tmdbId) };
      const plans = api.plan(q) || [];
      out.plans = plans.map(p => p.codename);
      out.detail = [];
      for (const p of plans) {
        const r = await postRaw('/v1/playlist', Buffer.from(p.envelope), 12000);
        let info = null;
        if (r.status === 200) { try { info = api.open(p.header, new Uint8Array(r.body)); } catch (er) { } }
        out.detail.push({ codename: p.codename, status: r.status, bytes: r.body.length, url: info ? String(info.url).slice(0, 120) : null });
      }
    } catch (er) { out.err = String((er && er.message) || er).slice(0, 120); }
    const cards = await nexStreams(tmdbId, type, s, e, '', { title: 'selftest', ms: 15000 });
    out.cards = cards.length;
    out.cardSample = cards.slice(0, 3).map(c => ({ name: c.name, url: String(c.url).slice(0, 100) }));
  }
  out.ms = Date.now() - t0;
  return out;
}

/* ───────────── রিলে (ইউজার সরাসরি প্লে করবে) ─────────────
   nexaRelayUrl: কার্ডে বসানো URL (আমাদের সার্ভার) ; nexaServe: প্লেলিস্ট+সেগমেন্ট দুটোই
   প্রোক্সি-পুল দিয়ে এনে Rewrite করে দেয় ⇒ ডিভাইসে কোনো স্পেশাল হেডার/আইপি লাগে না। */
function nexB(u) { return Buffer.from(String(u), 'utf8').toString('base64url'); }
/* ★ v1.34.327: nexa/totallyacdn প্লেলিস্ট-URL-এ `.m3u8` থাকে না — `/cdn-m3u8?payload=…`;
   আর সেগমেন্টের ছাঁচ `/cdn-m3u8/<name>.png|.jpg?payload=…`। তাই path+ext দুটোই দেখে ঠিক করি,
   নাহয় সেগমেন্টকে প্লেলিস্ট ভেবে বডি-টেক্সট ফেরত যেত (প্লেয়ারে "http://..." দেখাত)। */
function nexIsPl(u) {
  const s = String(u);
  let p = s, q = '';
  try { const U = new URL(s); p = U.pathname; q = U.search; } catch (e) { }
  if (/\.(png|jpe?g|webp|gif|ts|m4s|mp4|m4a|aac|vtt|key)$/i.test(p)) return false;   // সেগমেন্ট/কি
  if (/\.m3u8$/i.test(p) || /\/playlist$/i.test(p)) return true;
  if (/^\/cdn-m3u8\/?$/i.test(p) && /[?&](payload|psig)=/i.test(q)) return true;      // nexa-প্লেলিস্ট
  if (/m3u8/i.test(s)) return true;
  return false;
}
function nexRelayUrl(u, origin) {
  if (!u) return '';
  if (!origin) return u;                     // no origin ⇒ direct (আগের নিয়মই)
  return origin.replace(/\/+$/, '') + '/nexp/' + nexB(u) + (nexIsPl(u) ? '/p.m3u8' : '/s');
}
async function nexaServe(req, res, b64, originIn, query) {
  let tgt = '';
  try { tgt = Buffer.from(b64, 'base64url').toString('utf8'); } catch (e) { }
  if (!/^https?:\/\//i.test(tgt)) { try { res.writeHead(400, { 'content-type': 'text/plain' }); } catch (e) { } return res.end('bad'); }
  /* ★ origin একটাই সূত্র: server.js-এর originOf(req) (beamup-এর অভ্যন্তরীণ হোস্ট-হেডার সামলায়) */
  const origin = originIn ? String(originIn).replace(/\/+$/, '') : ('http://' + (req.headers.host || 'localhost'));
  const pl = nexIsPl(tgt);
  /* ★ v1.34.377: `?a=<audio-url>` ⇒ ভিডিও-প্লেলিস্টের বদলে ছোট master দিই যাতে অডিও-ট্র্যাকও থাকে
     (nexa-র ভিডিও স্ট্রিম নীরব; অডিও আলাদা রেন্ডিশনে)। */
  const audioB64 = (query && (query.get ? query.get('a') : (query.a || ''))) || '';
  if (pl && audioB64) {
    let audioTgt = '';
    try { audioTgt = Buffer.from(String(audioB64), 'base64url').toString('utf8'); } catch (e) { }
    if (/^https?:\/\//i.test(audioTgt)) {
      const p2 = (() => { try { const u = new URL(tgt); ['lang', 'forced', 'name', 'langs'].forEach(k => u.searchParams.delete(k)); return u.toString(); } catch (e) { return tgt; } })();
      const master = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="nexa",DEFAULT=YES,AUTOSELECT=YES,URI="' + nexRelayUrl(audioTgt, origin) + '"',
        '#EXT-X-STREAM-INF:BANDWIDTH=8000000,AUDIO="aud"',
        nexRelayUrl(p2, origin),
        '',
      ].join('\n');
      try { res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-nex': 'master' }); } catch (e) { }
      return res.end(master);
    }
  }
  try {
    const hdrs = {};
    if (req.headers.range && !pl) hdrs['range'] = String(req.headers.range);
    const r = await upFetch(tgt, { ms: pl ? 15000 : 25000, headers: hdrs, maxBytes: pl ? 2097152 : 0 });
    if (r.code !== 200 && r.code !== 206) { try { res.writeHead(502, { 'content-type': 'text/plain' }); } catch (e) { } return res.end('up ' + r.code); }
    const bodyHead = r.body.slice(0, 7).toString('latin1');
    if (pl && bodyHead !== '#EXTM3U') {
      /* ★ v1.34.327: একই URL-ছাঁচ (`/cdn-m3u8?payload=…`) প্লেলিস্ট ও AES-128 কী দুটোতেই —
         বডি `#EXTM3U` না হলে ওটা কী/বাইনারি, rewrite নয় (নাহয় প্লেয়ার ১৬B কী-র জায়গায় টেক্সট পায়)। */
      const isKey = r.body.length === 16;
      const hh = { 'content-type': isKey ? 'application/octet-stream' : 'application/octet-stream',
        'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-nex': isKey ? 'key' : 'bin' };
      try { res.writeHead(r.code, hh); } catch (e) { }
      return res.end(r.body);
    }
    if (pl) {
      const txt = String(r.body.toString('utf8')).split('\n').map(line => {
        const raw = line.trim();
        if (!raw) return line;
        if (raw.charAt(0) === '#') return line.replace(/URI="([^"]+)"/g, (m0, u1) => { let a = u1; try { a = new URL(u1, tgt).toString(); } catch (e) { } return 'URI="' + nexRelayUrl(a, origin) + '"'; });
        let a = raw; try { a = new URL(raw, tgt).toString(); } catch (e) { }
        return nexRelayUrl(a, origin);
      }).join('\n');
      try { res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-nex': 'pl' }); } catch (e) { }
      return res.end(txt);
    }
    /* ★ কনটেন্ট স sniff করে ঠিক করি — nexa/সেগমেন্ট-হোস্টরা ভুল/misleading content-type দেয়
       (vidbasic image/jpeg, mux octet-stream)। TS = 0x47 সিঙ্ক, MP4 = ftyp/moov, WebVTT = "WEBVTT". */
    let ct = String((r.headers && r.headers['content-type']) || '').toLowerCase();
    const b0 = r.body.length > 3 ? r.body : Buffer.alloc(0);
    const isTs = b0.length > 376 && b0[0] === 0x47 && b0[188] === 0x47;
    const isMp4 = b0.length > 12 && b0.slice(4, 8).toString('latin1') === 'ftyp';
    const isVtt = b0.slice(0, 6).toString('latin1') === 'WEBVTT';
    let outCt = 'application/octet-stream';
    /* ★ v1.34.327: `/cdn-m3u8/<name>.png?payload=` সেগমেন্ট (এনক্রিপ্টেড বাইনারি) — path-এ "m3u8"
       থাকলেও ওটা প্লেলিস্ট নয়। তাই আগে বডি sniff, পরে হেডার। */
    const startsM3u8 = b0.slice(0, 7).toString('latin1') === '#EXTM3U';
    if (startsM3u8 || (/mpegurl/.test(ct) && startsM3u8)) outCt = 'application/vnd.apple.mpegurl';
    else if (/mpegurl/.test(ct) && nexIsPl(tgt)) outCt = 'application/vnd.apple.mpegurl';
    if (isTs) outCt = 'video/mp2t';
    else if (isMp4) outCt = 'video/mp4';
    else if (isVtt) outCt = 'text/vtt';
    else if (/mpegurl/.test(ct)) outCt = 'application/vnd.apple.mpegurl';
    else if (/^video\//.test(ct) || /mpegts|mp2t/.test(ct)) outCt = ct;
    const h = { 'content-type': outCt, 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-nex': 'seg' };
    if (r.headers && r.headers['content-range']) h['content-range'] = r.headers['content-range'];
    if (r.headers && r.headers['accept-ranges']) h['accept-ranges'] = r.headers['accept-ranges'];
    try { res.writeHead(r.code, h); } catch (e) { }
    return res.end(r.body);
  } catch (e) {
    try { res.writeHead(502, { 'content-type': 'text/plain' }); } catch (e2) { }
    return res.end('nex-relay-err');
  }
}

module.exports = {
  capWarm, capWorkerStats, capWorker, capFetch, capCards, nexOn, nexStreams, nexDiag, nexSelftest, nexaServe, nexRelayUrl, nexIsPl, MOVIE_SRV, ANIME_SRV };
