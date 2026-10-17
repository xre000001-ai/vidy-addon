# Architecture

## Components

### 1. vidy (`server.js`, port 8128)
The Stremio addon users install. Serves `manifest.json`, `stream`, `subtitles` and a config page.

- **Proxy feed**: every 60 s it calls PoolHub `/pick?src=<space>&n=40&cb=<now>` for each of the five spaces and merges the picks into its in-memory pool (`POOL`). No public lists are ever fetched; no benching waves run locally. Boot starts at `pool=0` and fills from the hub.
- **Streams**: races vidy's own 16-server family directly; the winner URL goes to Stremio untouched.
- **MovieBox**: spawns `nethex/server.js` as a child (`PORT + 137`) after `listen` (deployment lint requires the manifest to answer immediately).
- **Resolver families** (tw/rt/multimovies): forwarded to the resolver bridge over `TWBASE`/`RTBASE`.

### 2. MovieBox child (`nethex/`, port 8265)
A standalone addon process (`community.nethex`) owned by vidy.

- **Pool feed** (`mb-lib/pool.js` → `poolOnce`): PoolHub `/pick?src=moviebox` → `own: true` picks (hub's `/report`-proven members) first with fast EWMA seeds, live-proven old members kept, the rest kept as slow-seeded backups.
- **Transport**:
  - `apiFetch` — hub `/fetch` first, then own pool exits (undici `ProxyAgent`).
  - `fetchJsonRotating` — hub `/fetch` first for **token-less GETs only** (the hub is GET-only and cannot forward `Authorization`); play/download/caption skip the hub and rotate own exits because MovieBox requires a Bearer JWT on those endpoints (verified live 2026-10: token-less `play` answers `hasResource:false`).
- **Token gate**: `search.js` owns JWT minting (search-suggest → `x-user` header, 90-day anonymous JWT). `bearerToken()` is shared with `episode-matrix.js`, `links.js`, `subtitles.js`.
- **Play token**: MovieBox rejects stale/pinned JWTs on `/subject/play` server-side (HTTP 200 with `hasResource:true` but zero streams — live-proven). The play family therefore mints a **fresh token** (`playToken()`, 60 s cache) instead of using the pinned search identity, and a 200-but-empty answer rotates to the next exit (`emptyCheck`) instead of settling the race. The `Referer` must be the real `/play/<detailPath>` path — a fake path yields empties. There is **no per-IP rate limit** (disproven by matrix tests).
- **Proof loop**: every live win (`fetchJsonRotating` own-exit success, `apiFetch` own-path success) is reported to the hub (`/report`), which grows the hub's `moviebox` sub-space. That space is what makes future `own` picks — the flywheel.

### 3. Resolver bridge (`resolver/twr_bridge.js`, port 8290)
A tiny hub-only service for the toonworld4all/raretoons resolver families.

- `/find?source=…` → one call to PoolHub `/fetch?src=<space>` — the hub races its own benched exits and returns the resolver's JSON.
- No mirror files, no sticky pools, no upstream fallbacks. If the hub has no working proxy the bridge answers with an honest empty.

### 4. PoolHub (separate repo, `293c2a7d7dd6-poolhub.baby-beamup.club`)
The single proxy authority. Runs its own enrichment + benching waves (the only component allowed to), keeps five sub-spaces (`toonworld4all`, `raretoons`, `vidy`, `moviebox`, `multimovies`), hands out picks, executes proxied fetches, and accepts win-reports. API keys per space live in `config/poolhub_keys.json`.

## Invariants (do not break)

1. **No client scans.** vidy, the child and the bridge never fetch public proxy lists.
2. **Playback never proxies.** Only platform API calls ride exits.
3. **Honest empties.** Any component that cannot fetch returns an empty result — never junk, never a cached lie.
4. **Token calls stay off the hub** until the hub can forward headers (GET-only today).
5. **Deployed child must boot fast** — `listen` before the child spawn, or the beamup linter (5×10 s manifest window) rejects the deploy.
