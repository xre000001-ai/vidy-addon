#!/usr/bin/env python3
"""nexa-cap1.py — এক টাইটেলের আসল HLS URL ক্যাপচার (এক-শট প্রসেস, মেমরি-হালকা)।
ছবি/সেগমেন্ট/টিএমডিবি-পোস্টার ব্লক করা হয় (র‍্যাম বাঁচাতে); ফন্ট লাগে — পাজল ফন্টেই চলে।
আউটপুট: STDOUT-এ এক লাইন JSON {ok,variants:[{res,h,bw,url}],audio,headers,ms,err}"""
import argparse, json, sys, time

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--platform', default='tmdb', choices=['tmdb', 'anilist'])
    ap.add_argument('--id', required=True)
    ap.add_argument('--s', default=None)
    ap.add_argument('--e', default=None)
    ap.add_argument('--timeout', type=float, default=20)
    ap.add_argument('--tabs', type=int, default=4)
    ap.add_argument('--ua', default='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36')
    a = ap.parse_args()
    t0 = time.time()
    out = {'ok': False, 'variants': [], 'headers': {'referer': 'https://nexa.mov/', 'origin': 'https://nexa.mov'}, 'err': ''}
    try:
        from playwright.sync_api import sync_playwright
    except Exception as ex:
        out['err'] = 'no-playwright'
        print(json.dumps(out)); return
    if a.platform == 'anilist':
        path = 'anilist/%s/e%s' % (a.id, a.e or 1)
    elif a.e:
        path = 'tmdb-tv/%s/s%s-e%s' % (a.id, a.s or 1, a.e)
    else:
        path = 'tmdb-movie/%s' % a.id
    got = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage',
                                        '--disable-gpu', '--disable-software-rasterizer',
                                        '--renderer-process-limit=1', '--js-flags=--max-old-space-size=96',
                                        '--autoplay-policy=no-user-gesture-required',
                                        '--disable-blink-features=AutomationControlled'])
            ctx = b.new_context(user_agent=a.ua, viewport={'width': 1024, 'height': 700}, locale='en-US')

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
            def mk_handler():
                def on_resp(r):
                    if 'cdn-m3u8' not in r.url or got.get('master') or got.get('single'):
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
                return on_resp
            # ★ একাধিক ট্যাব = আলাদা session/ticket ⇒ nexa-র ব্যাকএন্ড যখন ওঠাপড়া করে,
            #   একটার বদলে কয়েকটা সেশনে চেষ্টা করলে সফল হওয়ার হার অনেক বাড়ে।
            pages = []
            for k in range(max(1, min(4, a.tabs))):
                p2 = ctx.new_page()
                p2.on('response', mk_handler())
                pages.append(p2)
                try:
                    p2.goto('https://nexa.mov/watch/' + path, wait_until='commit', timeout=15000)
                except Exception:
                    pass
            while time.time() - t0 < a.timeout and not (got.get('master') or got.get('single')):
                for p2 in pages:
                    try:
                        loc = p2.locator('[aria-label*="lay" i]').first
                        if loc.count():
                            loc.click(timeout=600, force=True)
                    except Exception:
                        pass
                if time.time() - t0 > (a.timeout * 0.55):
                    for p2 in pages:      # অর্ধেক সময় পার হলে নতুন সেশন (reload)
                        try:
                            p2.reload(wait_until='commit', timeout=8000)
                        except Exception:
                            pass
                        break
                for _ in range(6):
                    if got.get('master') or got.get('single'):
                        break
                    try:
                        pages[0].wait_for_timeout(200)
                    except Exception:
                        time.sleep(0.2)
            try:
                ctx.close()
            except Exception:
                pass
            try:
                b.close()
            except Exception:
                pass
    except Exception as ex:
        out['err'] = 'launch:' + str(ex)[:120]
        out['ms'] = int((time.time() - t0) * 1000)
        print(json.dumps(out)); return
    out['ms'] = int((time.time() - t0) * 1000)
    src = got.get('master') or got.get('single')
    if not src:
        out['err'] = 'no-playlist'
        print(json.dumps(out)); return
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
        if not variants:
            out['err'] = 'master-empty'
    else:
        segs = body.count('#EXTINF')
        out.update({'ok': segs > 20, 'kind': 'hls', 'master': src['url'],
                    'variants': [{'res': None, 'h': None, 'bw': 0, 'url': src['url']}], 'segs': segs})
        if segs <= 20:
            out['err'] = 'decoy-short'
    print(json.dumps(out))

if __name__ == '__main__':
    main()
