#!/usr/bin/env python3
# ★ v1.34.327: nexa.mov ব্রাউজার-ক্যাপচার সার্ভিস
# কেন: nexa-র playlist এন্ডপয়েন্ট Node/wasm সেশন মেনে নেয় (200+accept) কিন্তু এনভেলপ AS-এ
# BAD_ENVELOPE দেয়। আসল প্লেয়ার ব্রাউজারে (web worker + ফন্ট-পাজল + ফিঙ্গারপ্রিন্ট রিপোর্ট)
# master-paylist পায় — তাই ওই ফ্লো-ই এখানে চালানো হয়, আর ফলাফল JSON-এ ফেরত দেওয়া হয়।
import json, os, sys, time, threading, base64, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('NEXA_CAP_PORT', '8899'))
UA = os.environ.get('NEXA_CAP_UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36')
WATCH = 'https://nexa.mov/watch/%s'
import queue
JOBQ = queue.Queue()
STATE = {'err': '', 'n': 0, 'ok': 0, 'dead': ''}

LOGT = []
def log(*a):
    line = ' '.join(str(x) for x in a)
    LOGT.append(line[:160])
    if len(LOGT) > 200:
        del LOGT[:100]
    sys.stderr.write('[nexa-cap] ' + line + '\n'); sys.stderr.flush()

def get_browser(pw, hold):
    if hold.get('b') is None or not hold['b'].is_connected():
        # headless "new" mode (full chrome build) — পুরনো headless-এ wasm ওয়েব-ওয়ার্কার ব্লক হয়
        hold['b'] = pw.chromium.launch(args=[
            '--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
            '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage',
            '--disable-gpu', '--disable-software-rasterizer', '--renderer-process-limit=1',
            '--js-flags=--max-old-space-size=96'])
        log('browser launched')
    return hold['b']

def watch_path(platform, tid, s, e):
    if platform == 'anilist':
        return 'anilist/%s/e%s' % (tid, max(1, int(e or 1)))
    if e:
        return 'tmdb-tv/%s/s%s-e%s' % (tid, max(1, int(s or 1)), max(1, int(e)))
    return 'tmdb-movie/%s' % tid

def capture(b, platform, tid, s, e, timeout):
    ctx = b.new_context(user_agent=UA, viewport={'width': 1400, 'height': 900}, locale='en-US')
    def _route(route):
        try:
            rt = route.request.resource_type
            u = route.request.url
            if rt in ('image', 'media') or '.ts' in u or 'tmdb.org' in u or 'anilist.co' in u:
                return route.abort()
        except Exception:
            pass
        return route.continue_()
    try:
        ctx.route('**/*', _route)
    except Exception:
        pass
    pg = ctx.new_page()
    got = {'master': None, 'single': None, 'err': ''}
    t0 = time.time()
    def on_resp(r):
        if 'cdn-m3u8' not in r.url or got['master'] or got['single']:
            return
        try:
            body = r.body()
        except Exception:
            return
        if not body or body[:4] != b'#EXT':
            return
        txt = body.decode('latin1')
        if 'EXT-X-STREAM-INF' in txt:
            got['master'] = {'url': r.url, 'body': txt}
        elif 'EXTINF' in txt:
            got['single'] = {'url': r.url, 'body': txt}
    pg.on('response', on_resp)
    def on_req(r):
        u = r.url
        if any(k in u for k in ('/v1/session', '/v1/playlist', 'cdn-m3u8')):
            log('req %s' % u.split('/')[-1][:40])
    pg.on('request', on_req)
    t_commit = [0.0]; t_click = [0.0]
    try:
        try:
            pg.goto(WATCH % watch_path(platform, tid, s, e), wait_until='commit', timeout=20000)
        except Exception as ex:
            log('goto warn', str(ex)[:80])
        t_commit[0] = time.time()
        # ★ v1.34.327: প্লে-বাটন খোঁজা কঠিন — একাধিক সিলেক্টর + কোঅর্ডিনেট + কীবোর্ড, ফেল হলে ১ বার রিলোড
        CLICKS = ['[aria-label*="lay" i]', 'button:has-text("Play")', '[class*="play" i]',
                  'video', '.player', 'main']
        attempts = 0
        rounds = 0
        while time.time() - t0 < min(timeout, 45) and not (got['master'] or got['single']):
            rounds += 1
            hit = False
            for sel in CLICKS:
                try:
                    loc = pg.locator(sel).first
                    if loc.count():
                        loc.click(timeout=900, force=True)
                        t_click[0] = time.time()
                        hit = True
                        break
                except Exception:
                    continue
            if not hit:
                try:
                    pg.mouse.click(700, 430)          # প্লেয়ার-এরিয়া (ভিডিওতে ক্লিক)
                    t_click[0] = time.time()
                except Exception:
                    pass
            for _ in range(12):                        # ~2.4সে অপেক্ষা
                if got['master'] or got['single']:
                    break
                pg.wait_for_timeout(200)
            attempts += 1
            if rounds in (2, 6):
                try:
                    pg.screenshot(path='/tmp/capdbg_%d_%d.png' % (rounds, int(time.time())), timeout=4000)
                    log('shot round %d ok' % rounds)
                except Exception as ex2:
                    log('shot fail %s' % str(ex2)[:40])
            if attempts == 3 and not (got['master'] or got['single']):
                try:
                    pg.reload(wait_until='commit', timeout=15000)
                except Exception:
                    pass
        while time.time() - t0 < timeout and not (got['master'] or got['single']):
            pg.wait_for_timeout(200)
        vid = None
        try:
            vid = pg.evaluate("()=>{const v=document.querySelector('video');return v?{w:v.videoWidth,h:v.videoHeight,t:v.currentTime}:null}")
        except Exception:
            pass
    finally:
        try:
            ctx.close()
        except Exception:
            pass
    if t_commit[0]:
        log('timing %s%s: commit %.1fs click %.1fs first-pl %.1fs' % (
            platform, tid, t_commit[0] - t0, (t_click[0] - t0) if t_click[0] else -1, time.time() - t0))
    out = {'ok': False, 'ms': int((time.time() - t0) * 1000), 'video': vid}
    if os.environ.get('NEXA_CAP_DEBUG'):
        out['trace'] = LOGT[-40:]
        try:
            out['dom'] = pg.evaluate("()=>({title:document.title,vids:document.querySelectorAll('video').length,btns:[...document.querySelectorAll('button')].map(b=>(b.getAttribute('aria-label')||b.innerText||'').trim()).filter(Boolean).slice(0,12)})")
        except Exception:
            pass
        try:
            pg.screenshot(path='/tmp/capdbg.png', timeout=5000); out['shot'] = '/tmp/capdbg.png'
        except Exception as ex3:
            out['shot'] = 'fail:' + str(ex3)[:40]
    src = got['master'] or got['single']
    if not src:
        out['err'] = 'no-playlist'
        return out
    body = src['body']
    if got['master']:
        variants, audio = [], None
        lines = body.splitlines()
        for i, ln in enumerate(lines):
            if ln.startswith('#EXT-X-STREAM-INF'):
                res = None
                m = ln.split('RESOLUTION=')
                if len(m) > 1:
                    res = m[1].split(',')[0].strip()
                bw = 0
                m2 = ln.split('BANDWIDTH=')
                if len(m2) > 1:
                    try: bw = int(m2[1].split(',')[0])
                    except Exception: bw = 0
                url = None
                for j in range(i + 1, min(i + 4, len(lines))):
                    if lines[j].strip() and not lines[j].startswith('#'):
                        url = lines[j].strip(); break
                if url:
                    h = None
                    if res and 'x' in res:
                        try: h = min(int(res.split('x')[0]), int(res.split('x')[1]))
                        except Exception: h = None
                    variants.append({'res': res, 'h': h, 'bw': bw, 'url': url})
            if ln.startswith('#EXT-X-MEDIA') and 'AUDIO' in ln:
                m3 = ln.split('URI="')
                if len(m3) > 1:
                    audio = m3[1].split('"')[0]
        variants.sort(key=lambda v: (v['h'] or 0, v['bw']), reverse=True)
        out.update({'ok': bool(variants), 'kind': 'hls', 'master': src['url'], 'variants': variants,
                    'audio': audio, 'headers': {'referer': 'https://nexa.mov/', 'origin': 'https://nexa.mov'}})
        if not variants:
            out['err'] = 'master-empty'
    else:
        segs = body.count('#EXTINF')
        out.update({'ok': segs > 8, 'kind': 'hls', 'master': src['url'], 'variants': [{'res': None, 'h': None, 'bw': 0, 'url': src['url']}],
                    'segs': segs, 'headers': {'referer': 'https://nexa.mov/', 'origin': 'https://nexa.mov'}})
        if segs <= 8:
            out['err'] = 'decoy-short'     # Atlantic ডিকয় = ঠিক ৮ সেগমেন্ট
    return out

def worker():
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            hold = {}
            b = get_browser(pw, hold)
            log('worker ready')
            while True:
                job = JOBQ.get()
                if job is None:
                    return
                params, box, ev = job
                try:
                    box['r'] = capture(b, *params)
                except Exception as ex:
                    box['r'] = {'ok': False, 'err': str(ex)[:200]}
                    log('capture error', str(ex)[:200])
                finally:
                    ev.set()
    except Exception as ex:
        STATE['dead'] = str(ex)[:200]
        log('worker died', str(ex)[:200])
        while True:
            job = JOBQ.get()
            if job is None:
                return
            params, box, ev = job
            box['r'] = {'ok': False, 'err': 'worker-dead'}
            ev.set()


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a):
        pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/health':
            return self._send(200, {'ok': True, 'n': STATE['n'], 'okN': STATE['ok'], 'err': STATE['err']})
        if u.path != '/cap':
            return self._send(404, {'error': 'not found'})
        platform = (q.get('platform', ['tmdb'])[0] or 'tmdb').lower()
        tid = (q.get('id', [''])[0] or '').strip()
        if not tid.isdigit():
            return self._send(400, {'error': 'bad id'})
        s = q.get('s', [None])[0]
        e = q.get('e', [None])[0]
        timeout = float(q.get('timeout', ['26'])[0] or 26)
        params = (platform, tid, s, e, timeout)
        if any(j[0] == params for j in list(JOBQ.queue)):
            return self._send(200, {'ok': False, 'err': 'busy-same'})
        box, ev = {}, threading.Event()
        JOBQ.put((params, box, ev))
        if not ev.wait(timeout + 45):
            return self._send(504, {'ok': False, 'error': 'timeout'})
        r = box.get('r') or {'ok': False, 'err': 'no-result'}
        STATE['n'] += 1
        if r.get('ok'):
            STATE['ok'] += 1
        return self._send(200, r)

if __name__ == '__main__':
    threading.Thread(target=worker, daemon=True).start()
    log('listening on 127.0.0.1:%d' % PORT)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
