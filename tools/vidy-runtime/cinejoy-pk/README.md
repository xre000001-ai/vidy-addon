# CineJoy source for the existing addon

This is the **independent `cinejoy.pk` source**: Light, Nebula, Sirius and Polaris. It is not an alias of another provider, and it never reads, modifies or imports proofs from Vidy, HindMovie or MovieBox pools.

## Controls

- `cj: 0` disables CineJoy; otherwise it is enabled by default.
- `cjq: [2160, 1080, 720, 480]` is an **exact selection** of source rendition tiers. An empty/absent list means all available renditions. Selecting only `[1080]` never adds 720/480 fallback cards. Unknown leaf resolution remains Auto and does not satisfy a specific quality filter.
- `cjsrv` is a **server exclusion list** using `light`, `nebula`, `sirius`, `polaris`. Empty/absent means all four. All four excluded means no CineJoy extraction or cards.
- Existing source switches, language/quality settings and server lists are independent. The old default configuration object is unchanged, so CineJoy defaults do not add keys to legacy URLs or churn configured manifest IDs.

The configuration page includes a source tile, four server toggles with All/None, resolution chips, preview, summary, counts, reset and saved-URL hydration.

## Direct delivery, not a video proxy

1. Metadata uses the addon's existing TMDB JSON helper; IMDb IDs require a unique external-ID match. TV requests retain their exact season and episode.
2. A foreground extraction uses only CineJoy's own fresh **same-proxy decrypted API + HLS + recognizable media-prefix proof**.
3. API and initial master are fetched through the selected verified extraction proxy.
4. For master playlists, `/cinejoy/hls/<stateless-token>/master.m3u8` serves a bounded **text-only selected master** with original codec/audio/subtitle attributes and absolute HTTPS CDN children. It performs no upstream fetch. Tokens are portable across addon replicas.
5. Declared leaf playlist URLs are returned verbatim. Video, audio, child playlists, init segments and keys go directly from the player to the source CDN. There is no segment relay, media cache, re-encoding or free-proxy media tunnel.
6. CineJoy cards bypass the addon's final signed-URL mutation/relay wrapper and retain their source subtitles. No such bypass is applied to another source.

The portable master accepts one variant, allowlisted CDN URLs and master-only tags, with an 8,000-character token and 32 KiB decompression limit. Media paths and arbitrary destination URLs cannot use it as an open proxy.

## Pool, background work and lifetime

Mutable state is exclusively `cinejoy-data/cinejoy_pk_pool.json`, ignored by Git, with an atomic save and a single-writer ownership lock. The shipped 5,000 records are **candidate addresses only**, not ready proxies or trusted proofs. Initial cold start may therefore return no CineJoy cards until background verification succeeds. Missing/stale proof fails closed; there is no raw-candidate, other-source or direct-extraction fallback.

Proof TTL is five minutes. Serving API/master text never renews a full-media proof timestamp. Refill targets four fresh proofs per server, with two verification workers, a bounded batch and a 60-second scheduling check. Readiness depends on actual upstream/proxy conditions and is not an uptime promise. Candidate discovery periodically reads three public HTTP-proxy address feeds and rotates only never-proven, idle candidates in this pool.

Foreground budget is 7,800 ms by default, never more than 8,000 ms. Four servers run independently; each permits at most two distinct verified extraction attempts. The first attempt reserves part of that same budget for a backup (maximum 4,000 ms), rather than consuming the whole request. Busy sibling leases are waited for only inside that budget. A foreground request locally cancels a running CineJoy refill only when every selected server already has a usable fresh endpoint; empty/partially warm pools keep verifying despite app requests. The scarcest server leases first before public card order is restored. This does not ban healthy endpoints or touch another source's work. The existing addon scheduler, SCUT=8,600 ms and SDL=12,000 ms are not changed.

Failed single-lane extraction teardown is tracked asynchronously: a slow failed CONNECT cannot consume a distinct backup attempt, and the original proxy lease stays held until its socket teardown completes. Shutdown drains those cleanup tasks.

Integration revision 3 additionally owns Undici's CONNECT pool, bounds connection/CONNECT waits and locally races request aborts even if CONNECT has not finished. Both the origin dispatcher and CONNECT pool are destroyed concurrently; concurrent close callers share one completion, and even an error in one destroy waits for the other to settle. This fixes a reproducible pending-CONNECT timeout/cleanup failure without changing the API protocol, proof policy, rendition URLs or direct media delivery. The production stale-refill observation is consistent with this failure; HTTP diagnostics alone do not prove its precise internal stack.

Known 360/240-tier dimensions and explicitly declared leaf paths are labeled numerically, never Auto. The addon's existing numeric sub-720 floor is unchanged, so these lower tiers are not smuggled into the final stream list as unknown resolution. A truly undeclared resolution stays Auto. Missing HLS audio language metadata is displayed as **Original Audio**; actual HLS language groups still take precedence. This fallback is a label, not an independently measured language claim, and it does not select or rewrite audio tracks.

Normal HTTP server close drains CineJoy work. A synchronous process-exit hook persists/releases only the CineJoy pool. Existing addon signal/child-process handlers remain untouched. `close()` is idempotent and cancels this source's controllers, discovery and refill before closing the engine and pool.

## Environment

| Variable | Purpose |
|---|---|
| `CINEJOY_OFF=1` | CineJoy-only runtime kill switch; starts no pool/network work. |
| `CINEJOY_STATE_DIR=/absolute/path` | Optional directory for the same named CineJoy-only pool; one live writer per directory. |
| `CINEJOY_REFILL=0` | Disable automatic verification scheduling (diagnostic use). |
| `CINEJOY_DISCOVERY=0` | Disable public candidate-feed downloads (does not disable proof refresh). |
| `CINEJOY_BUDGET_MS=100..8000` | Optional bounded foreground budget; default 7800. |

`GET /_cinejoy` reports readiness, source-local events, background state and `videoProxy:false`, without proxy addresses, filesystem paths or signed stream URLs.

## Verification and boundaries

Run from the addon root:

```sh
node --check server.js
node --check tools/vidy-runtime/cinejoy.cjs
node --test --test-concurrency=2 tools/cinejoy-tests/*.test.cjs
```

Tests cover core protocol/transport/media proof, pool/lock/cooldown/refill/lifecycle, metadata, selected masters and URL bounds, config DOM/server parsing, all five actual route bodies, final card formatting/subtitles/URL handling, slow-primary/distinct-backup behavior, and exact baseline preservation. They use existing addon dependencies; package files are unchanged. Live checks are additional evidence, not replaced by unit success.

The old HM-only frozen whole-server hash test intentionally remains unchanged: adding CineJoy invalidates that historical scope hash. Preservation now first reverses the separately logged, user-authorized CineJoy/HindMovie careful-review delta against deployed `07d669ff6fae90669fdfd232f046b571dd65f1e1`, checking all 297 existing files. It then reverses the original logged CineJoy edits and checks all 258 pre-integration files against `74aa4fac61d8cf62e79462735b4864a5d0cb895f`. There are no exempt source runtimes, pools or dependencies. Already-published upstream bot-only DT index updates through `031cc79` are retained, separately hash-pinned and exactly reversible with compressed originals; they are not review edits or an unrelated provider fix. The old frozen test and stale 18-versus-19 Vidy-server config assertions are not rewritten or silently waived.

The public protocol assets and their hashes are recorded in `vendor/manifest.json`. The standalone lab's HTTP service, dashboard, local API key, mutable pool, logs and playback dependency were **not** included in the addon runtime. Only the addon's already-installed `undici` is used by the portable core.

Two-title 1080-tier video decode/seek checks do not establish every title, rendition, audio/subtitle track, full-length playback, Stremio UI compatibility, cold-start first-tap availability or future free-proxy uptime. See the separate integration verification report for measured results and earlier failures.
