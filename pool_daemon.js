// pool_daemon.js — সারাক্ষণ-সক্রিয় HTTP-প্রক্সি পুল প্রশিক্ষক (ইউজার: "Node 20 ta, always active, 5 min e 3000 proxy scan, http only")
// প্রতি চক্র: ৩০০০ নতুন HTTP-প্রক্সি (Proxyscrape v4 + HTTP তালিকা) → CONNECT-যাচাই → vidy সেশন-যাচাই → verified-ফাইলে জমা।
const net = require('net'), tls = require('tls'), fs = require('fs'), path = require('path'), https = require('https');
const API = 'https://api.wecollege.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const WORKERS = Number(process.env.DW || 20);        // ★ ২০ সমান্তরাল কর্মী
const PER_CYCLE = Number(process.env.DN || 3000);    // ★ প্রতি ৫ মিনিটে ৩০০০ নোড-স্ক্যান
const CYCLE_MS = Number(process.env.DMS || 300000);
const MSMAX = Number(process.env.MSMAX || 3500);     // শুধু দ্রুত-পাস (সার্ভিং-বাজেটে ফেরে)
const OUT = path.join(__dirname, 'vidy_px_verified.json');
// ★ v1.24.0 (মাপা পাস-হার, আমাদের টার্গেটে): proxmint 47.5% · monosans 32.5% · litport 17.5% · thordata 10%
//   বাকি সব ০–৭.৫% ⇒ গুণমান-তালিকা আলাদা রাখি, চক্রে সেগুলো আগে নিই।
const QLISTS = [
  'https://raw.githubusercontent.com/proxmint/free-proxy-list/main/proxies/http.txt',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000',
  'https://free-proxy-list.net/ssl-proxy.html',
  'https://free-proxy-list.net/',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
  'https://raw.githubusercontent.com/litportnet/free-proxy-list/live/proxies/http.txt',
  'https://raw.githubusercontent.com/Thordata/awesome-free-proxy-list/main/proxies/http.txt'
]; // v1.25.5: measured pass rates on our target — best four first
// HTML তালিকায় IP ও port আলাদা <td>-তে থাকে ⇒ জোড়া-ম্যাচ
const RXPAIR = /((?:\d{1,3}\.){3}\d{1,3})\s*<\/td>\s*<td[^>]*>\s*(\d{2,5})\b/g;
function htmlPairs(t) { const o = []; let m; RXPAIR.lastIndex = 0; while ((m = RXPAIR.exec(t))) { const p = +m[2]; if (p >= 20 && p <= 65535) o.push(m[1] + ':' + p); } return o; }
const LISTS = [
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&supports_https=true',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=us',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=in',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=de',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=br',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=id',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=vn',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=5000&country=tr',
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt',
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-LIST/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
];
const sp = px => { const i = px.indexOf(':'); return [px.slice(0, i), +px.slice(i + 1) || 8080]; };
const get = u => new Promise(r => { const q = https.get(u, { timeout: 20000 }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => r(b)); }); q.on('error', () => r('')); q.on('timeout', () => { q.destroy(); r(''); }); });

function connectOk(px, tmo) {
  return new Promise(res => {
    const [h, p] = sp(px); const s = net.connect({ host: h, port: p });
    let done = false; const fin = v => { if (!done) { done = true; try { s.destroy(); } catch (_) { } res(v); } };
    const to = setTimeout(() => fin(false), tmo);
    s.once('error', () => { clearTimeout(to); fin(false); });
    s.once('connect', () => s.write('CONNECT gstatic.com:443 HTTP/1.1\r\nHost: gstatic.com:443\r\n\r\n'));
    let buf = ''; s.on('data', d => { buf += d.toString('latin1'); if (buf.indexOf('\r\n\r\n') >= 0) { clearTimeout(to); fin(/^HTTP\/1\.[01] 200/.test(buf)); } });
  });
}
function pxFetch(px, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), [ph, pp] = sp(px); const s = net.connect({ host: ph, port: pp });
    const to = setTimeout(() => { try { s.destroy(); } catch (_) { } reject(new Error('timeout')); }, timeoutMs);
    const bail = e => { clearTimeout(to); try { s.destroy(); } catch (_) { } reject(e); };
    s.once('error', bail);
    s.once('connect', () => s.write('CONNECT ' + u.host + ':443 HTTP/1.1\r\nHost: ' + u.host + ':443\r\n\r\n'));
    let buf = Buffer.alloc(0);
    const onD = d => {
      buf = Buffer.concat([buf, d]); const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
      s.removeListener('data', onD);
      if (!/^HTTP\/1\.[01] 200/.test(buf.slice(0, i).toString('latin1'))) return bail(new Error('refused'));
      const t = tls.connect({ socket: s, servername: u.hostname, rejectUnauthorized: false }, () => {
        const VH = (u.hostname === 'api.wecollege.net') ? 'Referer: https://www.vidy.st/\r\nOrigin: https://www.vidy.st\r\n' : ''; // ★ v1.21.9: vidy-API হেডার ছাড়া ৪০৩ (মাপা) — নইলে ডেমনের যাচাই ০%
        t.write('GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: ' + UA + '\r\nAccept: */*\r\n' + VH + 'Connection: close\r\n\r\n');
        const ch = []; t.on('data', x => ch.push(x));
        t.on('end', () => { clearTimeout(to); const b = Buffer.concat(ch); const st = +(b.toString('latin1', 9, 13)); const k = b.indexOf('\r\n\r\n'); resolve({ st, body: b.slice(k + 4).toString('utf8') }); });
        t.on('error', bail);
      }); t.on('error', bail);
    }; s.on('data', onD);
  });
}
async function session(px) {
  const t0 = Date.now();
  const a = await pxFetch(px, API + '/seed?mediaId=278', 4000);
  if (a.st !== 200) throw new Error('seed' + a.st);
  const seed = JSON.parse(a.body).seed; if (!seed) throw new Error('seed-empty');
  const b = await pxFetch(px, API + '/miami/sources?' + new URLSearchParams({ mediaType: 'movie', tmdbId: '278', enc: '2', seed, title: '' }), 4000);
  if (b.st !== 200 || b.body.length < 200) throw new Error('src' + b.st);
  return Date.now() - t0;
}
const readVer = () => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return {}; } };
function saveVer(found) {
  const cur = readVer(); const m = Object.assign({}, cur, found);
  fs.writeFileSync(OUT, JSON.stringify(m)); return Object.keys(m).length;
}
(async () => {
  console.log('[daemon] start workers=' + WORKERS + ' perCycle=' + PER_CYCLE + ' cycle=' + (CYCLE_MS / 1000) + 's MSMAX=' + MSMAX);
  const seen = new Set(Object.keys(readVer()));
  for (;;) {
    const t0 = Date.now();
    // ১) ৩০০০ নতুন HTTP-প্রক্সি জোগাড়
    const [qtxts, txts] = await Promise.all([Promise.all(QLISTS.map(get)), Promise.all(LISTS.map(get))]);
    const rx = /\b\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}\b/g;
    const qtxt = qtxts.join('\n'), ttxt = txts.join('\n');
    const qset = new Set((qtxt.match(rx) || []).concat(htmlPairs(qtxt)));   // v1.25.5: HTML তালিকা (IP/port আলাদা cell)
    const all = [...new Set((ttxt.match(rx) || []).concat(htmlPairs(ttxt)).concat([...qset]))];
    // v1.25.5: tier — T1 = মাপা-সেরা ৪টি সোর্স, T2 = মধ্যম; premium নোড আগে যাচাই হবে
    const t1 = new Set(), t2 = new Set();
    qtxts.forEach((t, i2) => { if (!t) return; const set = (i2 < 4) ? t1 : t2; for (const px of (t.match(rx) || [])) set.add(px); for (const px of htmlPairs(t)) set.add(px); });
    const qfirst = all.filter(x => t1.has(x)), mid = all.filter(x => !t1.has(x) && t2.has(x)), rest = all.filter(x => !t1.has(x) && !t2.has(x));
    for (let i = qfirst.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const w = qfirst[i]; qfirst[i] = qfirst[j]; qfirst[j] = w; }
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const w = rest[i]; rest[i] = rest[j]; rest[j] = w; }
    const ordered = qfirst.concat(mid).concat(rest);
    const fresh = ordered.filter(x => !seen.has(x)).slice(0, PER_CYCLE);
    fresh.forEach(x => seen.add(x));
    console.log('[daemon] চক্র: তালিকা-নোড=' + all.length + ' নতুন=' + fresh.length + ' verified-আগে=' + Object.keys(readVer()).length);
    // ২) CONNECT-যাচাই (২০ কর্মী)
    let qi = 0; const alive = [];
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      while (qi < fresh.length) { const px = fresh[qi++]; if (await connectOk(px, 2500)) alive.push(px); }
    }));
    // ৩) vidy-সেশন-যাচাই (২০ কর্মী)
    let si = 0, ok = 0; const found = {};
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      while (si < alive.length) {
        const px = alive[si++];
        try { const ms = await session(px); if (ms <= MSMAX) { found[px] = { ms: ms }; ok++; } } catch (e) { }
      }
    }));
    const n = saveVer(found);
    console.log('[daemon] চক্র-শেষ: CONNECT=' + alive.length + '/' + fresh.length + ' নতুন-verified=' + ok + ' মোট=' + n + ' সময়=' + Math.round((Date.now() - t0) / 1000) + 's');
    const wait = Math.max(5000, CYCLE_MS - (Date.now() - t0));
    console.log('[daemon] পরের চক্র ' + Math.round(wait / 1000) + 'সে পরে (পুল সক্রিয়)');
    await new Promise(r => setTimeout(r, wait));
  }
})();
