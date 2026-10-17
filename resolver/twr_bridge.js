// twr_bridge.js — রেজলভার-ব্রিজ v1.1.0 (পরিষ্কার-স্থাপত্য, ইউজার-আদেশ: "কেউ proxy pool মানে scan করবে না, poolhub theke এনে use করবে")
// · নিজে-কোনো-স্ক্যান-নেই, কোনো-মিরর/পুল-ফাইল-নেই, কোনো-পুরনো-আপস্ট্রিম-ফলব্যাক-নেই
// · /find?source=toonworld|raretoons&title=… → একমাত্র-পথ: PoolHub /fetch (হাব-নিজে-নিজের-বেঞ্চড-প্রক্সি-বাছে)
// · হাব-প্রক্সি-শূন্য-হলে-সৎ-খালি-উত্তর (কারও-সাথে-ধোঁয়াশা-নেই) — হাব-পুল-ভরলেই-আবার-কার্ড
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const VERSION = '1.1.0';
const PORT = Number(process.env.PORT || 8290);
const HUB = String(process.env.POOLHUB || 'https://293c2a7d7dd6-poolhub.baby-beamup.club').replace(/\/$/, ''); // ডিফল্ট=ডিপ্লয়েড-হাব (Badhan)
const SUBS = ['toonworld4all', 'raretoons'];
let KEYS = {}; try { KEYS = JSON.parse(fs.readFileSync(String(process.env.POOLHUB_KEYS || path.join(__dirname, '..', 'config', 'poolhub_keys.json')), 'utf8')); } catch (e) { }
let USED = { toonworld4all: 0, raretoons: 0 };
function viaHub(src, url) {
  return new Promise(res => {
    const K = KEYS[src] ? '&key=' + encodeURIComponent(KEYS[src]) : '';
    fetch(HUB + '/fetch?src=' + src + K + '&ms=9000&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(11500) })
      .then(r => r.json()).then(j => { if (j && j.ok && String(j.body || '')[0] === '{') return res(String(j.body)); res(null); }).catch(() => res(null));
  });
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const jout = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/health') return jout(200, { ok: 1, version: VERSION, hub: HUB, keys: Object.fromEntries(SUBS.map(s => [s, !!KEYS[s]])), used: USED, up: Math.floor(process.uptime()) });
  if (u.pathname !== '/find') return jout(404, { err: 'route?' });
  const src = u.searchParams.get('source') === 'raretoons' ? 'raretoons' : 'toonworld4all';
  const UURL = UPURL(u);
  const t0 = Date.now(); USED[src] = (USED[src] || 0) + 1;
  const b = await viaHub(src, UURL);
  if (b) { console.log('[bridge] ' + src + ' হাব ✓ ' + (Date.now() - t0) + 'ms'); return jout(200, JSON.parse(b)); }
  return jout(200, { streams: [], err: 'twr-bridge: হাব-প্রক্সি-শূন্য', el: Date.now() - t0 }); // সৎ-খালি — কোনো-লুকানো-পুল-নেই
});
function UPURL(u) { return (String(process.env.UPSTREAM || 'https://3404d3c5dc63-raretoons.baby-beamup.club').replace(/\/$/, '')) + '/find?' + u.searchParams.toString(); }
server.listen(PORT, '0.0.0.0', () => console.log('[twr-bridge] ' + VERSION + ' on :' + PORT + ' | হাব=' + HUB + ' | মোড=হাব-শুধু(স্ক্যান-নেই) | কী: ' + SUBS.map(s => s + '=' + (KEYS[s] ? '✓' : '✗')).join(' ')));
