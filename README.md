# Vidy addon — stream-only

> **সংস্করণ-নোট (২০২৬-১০-১৫):** AW-পরীক্ষা-ধারা (1.15.28–.35) বাদ-দিয়ে স্থিতিশীল **1.15.27**-লাইনে-ফেরা হয়েছে; তার-ওপরে ৩-দফা-যত্নের-সংশোধন:
> **1.15.36 (R1)** uncaughtException-রক্ষা + /_health-এ `up`/`ucex` · **1.15.37 (R2)** ক্লায়েন্ট-abort-socket-শূন্য-লেজ + বিপর্যয়-জাল headersSent-সচেতন · **1.15.38 (R3)** EADDRINUSE-স্পষ্ট-নির্দেশ।
> সোর্স: Vidy(16-সার্ভার) + MovieBox + RareToons + ToonWorld4All — স্ট্রিম-ফলে-ক্যাশ-নয়, সৎ-শূন্য।

Stremio / Nuvio compatible **stream-only** add-on sourcing from **vidy.st**.
Users stream directly from the CDN — the add-on only resolves tokens and links.

## Features

- **16 servers scanned in parallel** — Miami · Boise · Atlanta (giant primaries, ~32 sources on a 12-title sample, listed first, longest budget); veterans Phoenix (1080p mirror), Dallas (Auto-HLS), Austin (audio variants), Seattle (backup Auto); nine extras discovered from the official player bundle: Delhi (Hindi & English audio), Munich, Paris (most consistent single feed), Orlando, Reno, Oakland, Vegas, Cancun, Tampa
- **Every card shows its server**: `◫ 1080 · Atlanta ◫`
- Up to **4K** · subtitle tracks attached per-card (English-SDH etc. on official prints)
- **Original-audio aware**: subtitle-rich (official) variants win ties; dub prints (0 subs) lose
- Configurable pack via `/cfg/<base64url>/manifest.json`: resolution whitelist (`q:[1080,480]`), subtitles toggle (`sub:0`), server subset (`srv:["atlanta"]`) — legacy numeric `q:480` still means "max 480"
- Query alternative: `?q=720,360&sub=0&srv=miami,atlanta`
- Health ops: `/_health`, `/_pool`, `/_log`, `/_servers` (live server scores)
- tt-id and tmdb-native id both supported (`idPrefixes: ["tt","tmdb"]`)

## Reliability

- Playability probe on the first source URL before returning cards (dead assets fail over)
- All-servers-fail triggers one bounded retry with a fresh seed; per-server hard budgets keep responses inside gateway limits
- Full results cache 3h; partial results (a giant missing) only 60s and self-heal
- Negative id-cache only on confirmed-empty lookups (30 min), never on network errors
- Keep-alive sockets swept every 60 s; stale-socket resets auto-retry once

## RareToons source (v1.12.1)

Third parallel source fed by the local multi-resolver (`RTBASE` env, e.g. `RTBASE=http://127.0.0.1:8619 node server.js`; empty = off):

- Every stream route merges `source=raretoons` cards: pixeldrain direct-MKV mirrors + auto-HLS shield (new episodes appear automatically)
- Universal card anatomy — `◈ Auto ◈` / `✧ Title ⏎ ⧠ SxE • ep title • size ⏎ ⊞ RareToons ⌗ audio` — same as Vidy & MovieBox
- **Own filter** (config page, independent of the Vidy-side `q`): master switch (`rt`) + audio-language chips (`rtl`: Hindi/Tamil/Telugu/Malayalam; nothing picked = every dub stays)
- Cards follow `/hls/` relay URLs from the resolver; `bingeGroup: rt|title::`
- Official transparent logo served at `/rt_logo.png` (collected from rareanimes.mov, background keyed out)

## Endpoints

| Route | Purpose |
|---|---|
| `/config` · `/configure` · `/` | Configuration page |
| `/manifest.json` | Add-on manifest (stream-only) |
| `/stream/:type/:id.json` | Streams (`tt…` or `tmdb…`, series accept `:s:e`) |
| `/_health` `/_pool` `/_log` `/_servers` | Operations |
| `/catalog/...` | Legacy no-op kept for older installs |

## Development

```
node server.js selftest      # byte-exact decrypt fixture check
PORT=7000 node server.js     # run locally
```

Deploy: `git push beamup HEAD:main --force` (baby-beamup). GitHub remote: `gh`.


Stremio / Nuvio compatible **stream-only** add-on sourcing from **vidy.st**.
Users stream directly from the CDN — the add-on only resolves tokens and links.

## Features

- **16 servers scanned in parallel** — Miami · Boise · Atlanta (giant primaries, ~32 sources on a 12-title sample, listed first, longest budget); veterans Phoenix (1080p mirror), Dallas (Auto-HLS), Austin (audio variants), Seattle (backup Auto); nine extras discovered from the official player bundle: Delhi (Hindi & English audio), Munich, Paris (most consistent single feed), Orlando, Reno, Oakland, Vegas, Cancun, Tampa
- **Every card shows its server**: `◫ 1080 · Atlanta ◫`
- Up to **4K** · subtitle tracks attached per-card (English-SDH etc. on official prints)
- **Original-audio aware**: subtitle-rich (official) variants win ties; dub prints (0 subs) lose
- Configurable pack via `/cfg/<base64url>/manifest.json`: resolution whitelist (`q:[1080,480]`), subtitles toggle (`sub:0`), server subset (`srv:["atlanta"]`) — legacy numeric `q:480` still means "max 480"
- Query alternative: `?q=720,360&sub=0&srv=miami,atlanta`
- Health ops: `/_health`, `/_pool`, `/_log`, `/_servers` (live server scores)
- tt-id and tmdb-native id both supported (`idPrefixes: ["tt","tmdb"]`)

## Reliability

- Playability probe on the first source URL before returning cards (dead assets fail over)
- All-servers-fail triggers one bounded retry with a fresh seed; per-server hard budgets keep responses inside gateway limits
- Full results cache 3h; partial results (a giant missing) only 60s and self-heal
- Negative id-cache only on confirmed-empty lookups (30 min), never on network errors
- Keep-alive sockets swept every 60 s; stale-socket resets auto-retry once

## RareToons source (v1.12.1)

Third parallel source fed by the local multi-resolver (`RTBASE` env, e.g. `RTBASE=http://127.0.0.1:8619 node server.js`; empty = off):

- Every stream route merges `source=raretoons` cards: pixeldrain direct-MKV mirrors + auto-HLS shield (new episodes appear automatically)
- Universal card anatomy — `◈ Auto ◈` / `✧ Title ⏎ ⧠ SxE • ep title • size ⏎ ⊞ RareToons ⌗ audio` — same as Vidy & MovieBox
- **Own filter** (config page, independent of the Vidy-side `q`): master switch (`rt`) + audio-language chips (`rtl`: Hindi/Tamil/Telugu/Malayalam; nothing picked = every dub stays)
- Cards follow `/hls/` relay URLs from the resolver; `bingeGroup: rt|title::`
- Official transparent logo served at `/rt_logo.png` (collected from rareanimes.mov, background keyed out)

## Endpoints

| Route | Purpose |
|---|---|
| `/config` · `/configure` · `/` | Configuration page |
| `/manifest.json` | Add-on manifest (stream-only) |
| `/stream/:type/:id.json` | Streams (`tt…` or `tmdb…`, series accept `:s:e`) |
| `/_health` `/_pool` `/_log` `/_servers` | Operations |
| `/catalog/...` | Legacy no-op kept for older installs |

## Development

```
node server.js selftest      # byte-exact decrypt fixture check
PORT=7000 node server.js     # run locally
```

Deploy: `git push beamup HEAD:main --force` (baby-beamup). GitHub remote: `gh`.
// রিডিপ্লয়-মার্কার 1792145825
