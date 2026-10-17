# vidy — Stremio Addon

Multi-source streaming addon for Stremio. One install, four source families, honest results.

> **Version 1.15.67** · Live: `https://3404d3c5dc63-vidy.baby-beamup.club/manifest.json`

## Sources

| Family | What it provides | Where it runs |
|---|---|---|
| **vidy** | Movies & series from vidy servers (16 server family, direct MP4/HLS) | this process |
| **MovieBox** | Asian/global catalog, direct MP4 + soft subtitles | embedded child (`nethex/`) |
| **toonworld4all · raretoons** | Cartoon/anime resolvers | `resolver/` bridge service |
| **multimovies** | MM-HLS fallback streams | via resolver bridge |

## Architecture (one rule: nobody scans, everybody uses PoolHub)

```
                        ┌──────────────────────────────┐
                        │   PoolHub (the only pool)    │
                        │  5 sub-spaces, benched proxy │
                        │  293c2a7d7dd6-poolhub…       │
                        └──────┬───────────┬───────────┘
              /pick every 60s  │           │  /fetch per call (+ /report wins)
                ┌──────────────┘           └───────────────┐
        ┌───────┴────────┐                        ┌────────┴─────────┐
        │ vidy (this)    │                        │ resolver bridge  │
        │ + moviebox     │                        │ tw+rt /find →    │
        │   child        │                        │ hub /fetch       │
        └───────┬────────┘                        └────────┬─────────┘
                │                                          │
        ┌───────┴──────────────────────────────────────────┴────────┐
        │              Stremio plays DIRECT from CDN                │
        └───────────────────────────────────────────────────────────┘
```

- **No component scans for proxies.** Every proxy is benched by PoolHub and handed out through sub-space `/pick`.
- **MovieBox play/download/caption calls carry a minted Bearer JWT** (MovieBox gate, verified 2026-10); these token calls ride the pool exits directly (the hub transport is GET-only and cannot forward headers). Token-less GETs (detail) may ride the hub's `/fetch`.
- **Every live success is reported back** (`/report`) so the hub's `moviebox` sub-space stays built from real-traffic proof.
- **Playback is never proxied.** Only API/IP-flag calls ride the pool; video bytes go straight from the CDN to the player.

## Folder layout

```
vidy-addon/
├── server.js               # vidy addon entry (beamup start: node server.js)
├── config.html             # addon configuration page
├── config/
│   └── poolhub_keys.json   # PoolHub sub-space API keys
├── resolver/
│   └── twr_bridge.js       # toonworld4all + raretoons resolver bridge (hub-only)
├── nethex/                 # MovieBox child addon (community.nethex)
│   ├── server.js
│   └── mb-lib/             # search · episode-matrix · links · subtitles · pool
├── docs/
│   ├── ARCHITECTURE.md     # how the pieces talk
│   ├── DEPLOY.md           # deployment runbook (beamup)
│   └── HISTORY_BN.md       # full change history (Bengali)
├── test.js                 # npm test
└── assets/                 # logos
```

## Run locally

```bash
# resolver bridge (port 8290)
PORT=8290 POOLHUB_KEYS=./config/poolhub_keys.json node resolver/twr_bridge.js

# vidy + embedded MovieBox child (port 8128, child = +137)
PORT=8128 TWRT_BRIDGE=1 TWBASE=http://127.0.0.1:8290 RTBASE=http://127.0.0.1:8290 node server.js
```

## Health & debug

| Endpoint | On | Shows |
|---|---|---|
| `/_health` | vidy | version, pool, apibench, nx (child), nxpool |
| `/_pool` | vidy | current proxy roster + per-exit stats |
| `/debug/ring` | child (:8265) | last resolve steps (search → matrix → cards) |
| `/health` | bridge (:8290) | hub target, keys, usage counters |

## Deploy

See `docs/DEPLOY.md` (beamup runbook — note: this app deploys to the **main** branch).

## License

Private project. Source history in `docs/HISTORY_BN.md`.
