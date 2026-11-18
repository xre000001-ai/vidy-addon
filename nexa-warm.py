#!/usr/bin/env python3
"""nexa-warm.py — nexa.mov সেশন-গরম ক্যাপচার সার্ভিস (এক ব্রাউজার, এক পেজ, বারবার ব্যবহার)।
প্রথম ক্যাপচার ধীর (৫–২০সে), পরে ওয়ার্ম সেশনে ১–৪সে।"""
import json, os, sys, threading, time, queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('NEXA_CAP_PORT', '8899'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
JOBQ = queue.Queue()
ST = {'caps': 0, 'okN': 0, 'fails': 0, 'warm': False, 'last': '', 'recycles': 0, 'blocked_until': 0, '429': 0, 'proxy': ''}

# ★ v1.34.329: nexa /v1/session rate-limit করে (429)। এক IP-তে কোটা শেষ হলে সাইটই আর প্লে করে না।
#   তাই প্রতিটি ক্যাপচার প্রক্সি-পুলের একটি নোড দিয়ে (আলাদা IP = আলাদা কোটা); 429 হলে পরের নোডে।
def load_pool():
    for p in ('vidy_proxy_pool.json', '/home/user/vidy-work/w3/vidy_proxy_pool.json'):
        try:
            d = json.load(open(p))
            out = [x['px'] for x in d if isinstance(x, dict) and x.get('px')]
            if out:
                return out
        except Exception:
            continue
    return []

POOL = load_pool()
_pi = [0]

GOOD = ['130.110.103.245:3128', '102.244.78.61:8086']   # ল্যাব-যাচাই করা (session 200)

def next_proxy():
    # আগে যাচাই করা নোড, তারপর পুল (ঘুরিয়ে)
    for px in GOOD:
        if px in POOL or True:
            GOOD.append(GOOD.pop(0))
            return px
    if not POOL:
        return None
    for _ in range(len(POOL)):
        px = POOL[_pi[0] % len(POOL)]
        _pi[0] += 1
        try:
            h, p2 = px.split(':')
            if h and p2.isdigit():
                return px
        except Exception:
            continue
    return None


def log(*a):
    line = ' '.join(str(x) for x in a)
    ST['last'] = line[:160]
    sys.stderr.write('[nexa-warm] ' + line + '\n'); sys.stderr.flush()


class Engine:
    def __init__(self):
        self.pw = None; self.b = None; self.ctx = None; self.pg = None
        self.n = 0; self.cur = {}; self.hooked = False

    def _launch(self, px=None):
        from playwright.sync_api import sync_playwright
        if self.pw is None:
            self.pw = sync_playwright().start()
        if self.b is not None:
            try: self.b.close()
            except Exception: pass
        kw = {}
        if px:
            h, p2 = px.split(':')
            kw['proxy'] = {'server': 'http://%s:%s' % (h, p2)}
            ST['proxy'] = px
        self.b = self.pw.chromium.launch(**kw, args=[
            '--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--disable-gpu',
            '--disable-software-rasterizer', '--renderer-process-limit=1',
            '--js-flags=--max-old-space-size=96', '--autoplay-policy=no-user-gesture-required',
            '--disable-blink-features=AutomationControlled'])
        self.ctx = self.b.new_context(user_agent=UA, viewport={'width': 1024, 'height': 700}, locale='en-US')

        def _route(route):
            try:
                rt = route.request.resource_type; u = route.request.url
                if rt in ('image', 'media') or '.ts' in u or 'tmdb.org' in u or 'anilist.co' in u:
                    return route.abort()
            except Exception:
                pass
            return route.continue_()
        try: self.ctx.route('**/*', _route)
        except Exception: pass
        self.pg = self.ctx.new_page()
        self.cur = {}
        self.hooked = False
        self.n = 0
        ST['warm'] = True
        log('browser launched')

    def ensure(self, force_new_proxy=False):
        try:
            alive = self.b is not None and self.pg is not None and not self.pg.is_closed()
        except Exception:
            alive = False
        if not alive or self.n >= 10 or force_new_proxy:
            if alive: ST['recycles'] += 1
            self._launch(next_proxy() if force_new_proxy or not ST['proxy'] else ST['proxy'])

    def cap(self, platform, tid, s, e, timeout):
        force = (ST['429'] > getattr(self, '_429seen', 0)) or ST.get('force_new')
        ST['force_new'] = 0
        self.ensure(force_new_proxy=force)
        self._429seen = ST['429']
        t0 = time.time()
        got = self.cur

        def on_resp(r):
            try:
                if '/v1/session' in r.url and r.status == 429:
                    ST['429'] += 1
                    ST['blocked_until'] = time.time() + 120
                    log('429 session → backoff 120s')
            except Exception:
                pass
            if 'cdn-m3u8' not in r.url or got.get('master') or got.get('single'):
                return
            try: body = r.body()
            except Exception: return
            if not body or body[:4] != b'#EXT': return
            txt = body.decode('latin1')
            if 'EXT-X-STREAM-INF' in txt: got['master'] = {'url': r.url, 'body': txt}
            elif 'EXTINF' in txt: got['single'] = {'url': r.url, 'body': txt}
        if not self.hooked:
            self.pg.on('response', on_resp)
            self.hooked = True
        if platform == 'anilist':
            path = 'anilist/%s/e%s' % (tid, e or 1)
        elif e:
            path = 'tmdb-tv/%s/s%s-e%s' % (tid, s or 1, e)
        else:
            path = 'tmdb-movie/%s' % tid
        try:
            self.pg.goto('https://nexa.mov/watch/' + path, wait_until='commit', timeout=15000)
        except Exception:
            pass
        # ★ v1.34.329: nexa সেশন-এন্ডপয়েন্ট rate-limit করে (429)। বারবার ক্লিক/রিলোড = আরও 429।
        #   তাই একবার ক্লিক, তারপর শুধু অপেক্ষা; 429 দেখলে ২ মিনিট বন্ধ (কোটা রিফিল হতে দাও)।
        clicked = False
        while time.time() - t0 < timeout and not (got.get('master') or got.get('single')):
            if not clicked:
                try:
                    loc = self.pg.locator('[aria-label*="lay" i]').first
                    if loc.count():
                        loc.click(timeout=600, force=True)
                        clicked = True
                except Exception:
                    pass
            for _ in range(8):
                if got.get('master') or got.get('single'): break
                self.pg.wait_for_timeout(200)
        self.n += 1
        out = {'ok': False, 'variants': [], 'ms': int((time.time() - t0) * 1000),
               'headers': {'referer': 'https://nexa.mov/', 'origin': 'https://nexa.mov'}, 'err': ''}
        src = got.get('master') or got.get('single')
        if not src:
            out['err'] = 'no-playlist'; return out
        body = src['body']
        if got.get('master'):
            lines = body.splitlines(); variants = []; audio = None
            for i, ln in enumerate(lines):
                if ln.startswith('#EXT-X-STREAM-INF'):
                    res = ln.split('RESOLUTION=')[1].split(',')[0].strip() if 'RESOLUTION=' in ln else None
                    bw = 0
                    if 'BANDWIDTH=' in ln:
                        try: bw = int(ln.split('BANDWIDTH=')[1].split(',')[0])
                        except Exception: bw = 0
                    url = None
                    for j in range(i + 1, min(i + 4, len(lines))):
                        if lines[j].strip() and not lines[j].startswith('#'):
                            url = lines[j].strip(); break
                    if url:
                        try: h = min(int(res.split('x')[0]), int(res.split('x')[1])) if res else None
                        except Exception: h = None
                        variants.append({'res': res, 'h': h, 'bw': bw, 'url': url})
                if ln.startswith('#EXT-X-MEDIA') and 'URI="' in ln and audio is None:
                    audio = ln.split('URI="')[1].split('"')[0]
            variants.sort(key=lambda v: (v['h'] or 0, v['bw']), reverse=True)
            out.update({'ok': bool(variants), 'kind': 'hls', 'master': src['url'], 'variants': variants, 'audio': audio})
            if not variants: out['err'] = 'master-empty'
        else:
            segs = body.count('#EXTINF')
            out.update({'ok': segs > 20, 'kind': 'hls', 'master': src['url'],
                        'variants': [{'res': None, 'h': None, 'bw': 0, 'url': src['url']}], 'segs': segs})
            if segs <= 20: out['err'] = 'decoy-short'
        return out


ENG = Engine()
CACHE = {}


def worker():
    while True:
        job = JOBQ.get()
        if job is None:
            return
        params, box, ev = job
        try:
            key = '%s:%s:%s:%s' % params[:4]
            if ST['blocked_until'] > time.time():
                box['r'] = {'ok': False, 'err': 'rate-limited', 'retryIn': int(ST['blocked_until'] - time.time())}
                ev.set(); continue
            hit = CACHE.get(key)
            if hit and time.time() - hit[0] < 900:
                box['r'] = hit[1]
            else:
                r = ENG.cap(*params)
                if not r.get('ok'):
                    ST['force_new'] = 1        # পরের বার অন্য প্রক্সি
                if r.get('ok'):
                    CACHE[key] = (time.time(), r)
                    if len(CACHE) > 200: CACHE.clear()
                box['r'] = r
        except Exception as ex:
            box['r'] = {'ok': False, 'err': ('exc:' + str(ex))[:150]}
            log('cap error', str(ex)[:150])
        finally:
            ev.set()


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def _s(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == '/health':
            return self._s(200, dict(ST, ok=True, cache=len(CACHE)))
        if u.path != '/cap':
            return self._s(404, {'error': 'not found'})
        platform = (q.get('platform', ['tmdb'])[0] or 'tmdb').lower()
        tid = (q.get('id', [''])[0] or '').strip()
        if not tid.isdigit():
            return self._s(400, {'error': 'bad id'})
        s = q.get('s', [None])[0]; e = q.get('e', [None])[0]
        timeout = float(q.get('timeout', ['20'])[0] or 20)
        box = {}; ev = threading.Event()
        JOBQ.put(((platform, tid, s, e, timeout), box, ev))
        if not ev.wait(timeout + 30):
            ST['fails'] += 1
            return self._s(504, {'ok': False, 'error': 'timeout'})
        r = box.get('r') or {'ok': False, 'err': 'no-result'}
        ST['caps'] += 1
        if r.get('ok'): ST['okN'] += 1
        else: ST['fails'] += 1
        return self._s(200, r)


if __name__ == '__main__':
    log('listening 127.0.0.1:%d' % PORT)
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
