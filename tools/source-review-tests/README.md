# Source-review regression suite

Scope: full HindMovie/HDHub4u provider labels; Movies4u/HDHub4u first-tap discovery and completeness; exact file, season and episode selection; actual response/container proof; the four originally reported legacy harness failures; and the user's explicit Movies4u **G-Direct exclusion**.

```sh
node --check server.js
node config.test.js
node --test tools/source-review-tests/*.test.cjs tools/card-text-tests/*.test.cjs tools/cinejoy-tests/*.test.cjs
node --test tools/stream-tests/test-first-tap-scheduler.cjs tools/stream-tests/test-hindmovie-budget-review.cjs tools/stream-tests/test-hindmovie-first-tap-review.cjs tools/stream-tests/test-hindmovie-race.cjs
for f in tools/hdhub/test-*.cjs; do node "$f" || exit 1; done
```

The released 1.34.416 combined suite had **278 tests**: 74 source-review, 27 shared-card and 177 CineJoy tests. The dedicated historical HM/scheduler command has 29. These are deterministic code/harness checks, not provider uptime or native-player certification.

`extract.cjs` extracts named production functions rather than copying their implementation into tests. `helpers.cjs` supplies isolated contexts and a virtual clock; unexpected fetches throw. Cases cover response metadata/container bytes, contradictory filenames, deadline/pending semantics, stalled-sibling independence, source switches, transport identity and full names through the actual formatter/sender.

`fixtures/td-catalog.json` contains reduced inline heading/link fixtures from observed Movies4u posts and compatible MDisk pages. Provenance paths are notes only: CI never reads those external workspace paths or accesses the network.

`fixtures/authorized-edits.json` records **122 exact reversible hunks**. `preservation.cjs` undoes them in reverse order, checks every occurrence and reconstructs the 320-file c593 baseline for the card/CineJoy/historical HM preservation chains. Original hashes are not reset or exempted. The stable HM outside-section hash stays pinned.

## G-Direct policy and preservation

The observed G-Direct upstream ignored first, middle and suffix Range requests and could fail an immediate cold seek. The user explicitly requested that this source be removed, rather than changing shared media delivery.

- `g-direct.test.cjs` has 17 exclusion/preservation cases. New discovery, resolver/fallback jobs, VCloud sub-links and cached final unions cannot reintroduce G-Direct.
- Old exact Fastdl and `#vcG-Direct` playback targets stop before resolution; they do not silently select another quality, episode or server.
- Disabled-only stale caches permit allowed-mirror rediscovery rather than pinning an empty result for ten minutes.
- Generic first-tap/identity fixtures now use retained GDFlix/VCloud paths. Proof, deadline, archive, identity and alternative-preservation gates are not relaxed to compensate for G-Direct removal.
- Undoing just the nine declared G-Direct function edits reconstructs the previously reviewed server SHA `588192cb70d7bbbbec74611315f50bcb676e09b75e59bc8f22c13d32fbd79639`. Shared GU/cache/relay, Revive Google Drive and the other previously reviewed runtime functions stay unchanged by this exclusion.
- **Google Drive, GDFlix, FSL/Pixeldrain and other providers are not globally banned.** Their URLs, headers, native subtitles, audio declarations and functional filenames remain meaningful.

## Historical 1.34.416 evidence and limitations

Previous released baseline: **1.34.416**. Deployment state is recorded separately; passing these tests alone does not mean a build has been deployed. Engineering report: `/home/user/vidy-source-review/FINAL-REVIEW.md`.

The post-exclusion isolated live cohort returned **23/23 HTTP 200 nonempty listings**, including paired first/second taps, combined M4U+HD, CJ/HM controls and the separate Nexa transport. None contained G-Direct. The old exact G-Direct route returned 410.

Sequential real decoder sampling of eight actual returned cards passed **14/16** start/90-second checks: M4U Pixeldrain **8/8**, HD **6/8**. The selected HD Batman HEVC worker returned 403 and zero decoded frames at both offsets; these failures are retained, not replaced with retries. Other returned mirrors are not silently substituted or removed. This is not native-app, full-length, all-track, all-mirror or sustained-load certification. The old G-Direct failure is historical evidence for its requested exclusion, not an outstanding promise to repair its shared relay.

The expanded 98-entrypoint sweep remains **95/98**. Three failures also reproduce on untouched c593 and are unmodified: `tools/mlbd-index/test_direct.cjs`, `tools/mlbd-index/test_preserve_base.cjs`, and `tools/mls-index-lab/test-proxy-trainer.cjs`. The originally scoped 46 legacy entrypoints and all eight HD entrypoints pass. No unrelated MLBD/proxy runtime fix, test exemption or baseline hash reset was applied.

## Repeated-review upgrade — 1.34.417

These changes retain the stable `31028c6` / 1.34.416 baseline and the reviewed `261a74b` upgrades, now versioned **1.34.417** for promotion. Deployment status is recorded separately; a version bump alone is not deployment proof. The upgrade adds adversarial filename-separator/standalone-episode/quality checks and narrowly hardens those gates. No GU/relay/proxy/container/audio/subtitle/timeout behavior is rewritten. `rereview-preservation.cjs` reverses each declared local change before checking the exact329-file deployed baseline, then the unchanged original122 inverses and older preservation chains still run. The workflow now triggers for these suites and runs their job independently of the three known legacy failures. Review evidence/report: `/home/user/vidy-triple-review/`.

Commit preparation additionally checks the configure page offline: its existing server grid contains **19** servers. Four obsolete 18-server expectations in `config.test.js` were corrected to that fixed existing contract, without changing `config.html` or server configuration. The scoped CI job runs this DOM check as well; config-page/test changes trigger it. The repeated-review combined suite has **333 tests** (55 new), and the separate DOM harness has **84 assertions**. New live-provider/playback/seek probes are deferred at the user’s request; that does not reclassify earlier observed failures as passes. Dependency versions and the lockfile remain unchanged (only the package release version is bumped); the known transitive body-parser audit advisory is a separate dependency-review item.

Promotion evidence and stable-version comparisons: `/home/user/vidy-release-1.34.417/`. Earlier `/home/user/vidy-triple-review/` reports remain historical pre-push/deployment snapshots. No older stable snapshot is restored or merged, and existing upgraded CineJoy/HM/Nexa/source/card behavior is retained.

## First-tap correction and explicit Vidy preservation — 1.34.418

The user requested deployment after the first-tap investigation, and an explicit comparison of the **Vidy provider** with stable behavior. All **58** Vidy/provider-pool-card/related-relay functions and seven critical server/priority/freshness/timing declarations match stable `31028c6` and older `87e0192` references. The server file changes only its VERSION relative to 1.34.417; no Vidy restore, global scheduler rewrite, full old-worktree restore, cache reset or dependency update is involved.

CineJoy now returns a successful API/manifest result without waiting on winner socket teardown. The lease remains owned and cleanup is tracked/drained before shutdown. A cold request can wait, within its unchanged source deadline, for an already-running own-source verifier to produce fresh server-specific proof; it cannot use stale/raw/foreign candidates or start a foreground trainer. Transient incomplete outcomes retain source pending metadata without changing the plain JSON stream array.

HindMovie can start requested file/mirror-link work from the exact advertised mvlink post's equivalent REST representation while slow canonical HTML is still arriving. Canonical HTML collection remains alive if REST is first, so additional files/provenance cannot disappear behind a first-completed-list cutoff or be frozen in a partial positive plan/card cache. A fast complete HTML page avoids the extra REST request. The existing three-request embed concurrency, source/route budgets, identity/title/episode/1080p/4K guards, exact provenance and ready-mirror retention remain intact. No media/HEAD/Range/seek check is added.

The combined scoped suite adds **30** tests to the prior333 (26 first-tap cases plus four explicit Vidy preservation cases): **363 tests**. Final pass/deployment status is recorded in `/home/user/vidy-release-1.34.418/`, not implied by this version bump. The unchanged historical three expanded-suite failures and transitive body-parser advisory remain separate disclosed items. New actual-media/playback/seek investigations remain deferred. Prior report paths/results above remain historical rather than being relabelled as this release's evidence.

## DeadToons-only automatic index upgrade — 1.34.419

Only the DT index builder/workflow, DT generation loader/cache-key, release metadata and their exact tests/docs are changed. All non-DT server bytes and modules remain as2419e74/418. The prior39 inverse declarations and original stable pins are retained; the whole-server Vidy pin test first reverses the explicitly declared DT edits rather than resetting its417 baseline hash.

Automatic generated index data lives on the separate `deadtoons-index` branch, not main. One shared catalog feeds four shard-owned slices (six bounded workers each); the original server-declared cooldown is honored. Distinct-host accounting, deduplication, transient/backoff states, scheduled refresh, global real coverage aggregation and a non-force atomic publication replace the lossy five-writer path. The manifest points to an immutable parent snapshot, and publication errors fail visibly. This is incremental background work; workflow success never means every upstream title/file is available.

The addon starts from bundled existing rows and aliases, performs memory-only shard lookups, and swaps all changed, checksum-validated shards together in the background. Same-count generation changes invalidate only DT stream cache keys; legacy counters cannot overwrite shard status. Existing DT proof/headers/identity/episode policy and all other sources, G-Direct exclusion, global timeouts and shared delivery remain unchanged. No new media/Range/playback/seek probe is part of this qualification. Release/deployment evidence: `/home/user/vidy-release-1.34.419/`.

The v4 catalog enumerates the real `/season/:number` episode IDs rather than guessing1..episode_count. A bounded read-only metadata check found Naruto S2 lists27..52 while `/season/2/episode/1` returns404. Only a full contiguous absolute inventory following all prior seasons may supply a proven season-relative offset; gaps are not compressed/guessed. Show/season metadata scheduling is persistent and oldest-attempt-first, so an incomplete timed pass continues automatically rather than starving later shows. Exact catalog title aliases and host-namespaced file IDs are included in the DT-only path. Catalog and state artifacts bind all slices to one prepared data SHA and catalog digest. No gate, player, media or Range endpoint was manually probed for this metadata check.

DT card assembly also collects already-unlocked mirrors independently: a ready mirror may return without waiting for the slowest sibling, and all later-ready DT cards merge into the generation-specific cache. When every started stage has already settled, the old5.2s idle poll is skipped. Resolver/media functions, headers, card identity/audio/subtitles and all existing deadlines are unchanged; these behaviors are qualified with mocks, not playback probes. The first push uses a shorter180s catalog/slice pass for prompt publication verification; hourly maintenance retains780s catalog/2100s slices and persistent progress.
