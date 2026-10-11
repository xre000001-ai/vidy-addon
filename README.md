# Vidy addon (stream-only)

Stremio/Nuvio-সামঞ্জস্যপূর্ণ stream-only addon — Korean/Chinese drama & movies via **vidy.st**.

- 2160p/1080p/720p/480p + subtitles
- Token (seed) fetch: direct-first; rate-limit (429)-এ **trained-proxy hedge-race**
- **স্ট্রিম সবসময় ইউজার-সরাসরি CDN থেকে** — প্রক্সি ভিডিও-বাইট কখনো ধরে না
- `Referer: https://www.vidy.st/` হেডার কার্ডেই বেকড (headers + behaviorHints.proxyHeaders)
- tt-id → TMDB: keyless প্রক্সি (`db.wecollege.net/3`)

## Selftest
```
node server.js selftest
```
## Run
```
PORT=7000 node server.js
```
## Pool retrain (অ্যাকশন-ল্যাবে)
```
python3 ../vidy_proxy_pool.py train   # নতুন vidy_proxy_pool.json কপি করে redeploy
```
