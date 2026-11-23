# Source-review regression suite

Scope: full HindMovie/HDHub4u provider labels; Movies4u/HDHub4u first-tap discovery and completeness; exact file, season and episode selection; actual response/container proof; the four originally reported legacy harness failures; and the user's explicit Movies4u **G-Direct exclusion**.

```sh
node --check server.js
node --test tools/source-review-tests/*.test.cjs tools/card-text-tests/*.test.cjs tools/cinejoy-tests/*.test.cjs
node --test tools/stream-tests/test-first-tap-scheduler.cjs tools/stream-tests/test-hindmovie-budget-review.cjs tools/stream-tests/test-hindmovie-first-tap-review.cjs tools/stream-tests/test-hindmovie-race.cjs
for f in tools/hdhub/test-*.cjs; do node "$f" || exit 1; done
```

The combined suite has **278 tests**: 74 source-review, 27 shared-card and 177 CineJoy tests. The dedicated historical HM/scheduler command has 29. These are deterministic code/harness checks, not provider uptime or native-player certification.

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

## Release evidence and limitations

Release version: **1.34.416**. Deployment state is recorded separately; passing these tests alone does not mean a build has been deployed. Engineering report: `/home/user/vidy-source-review/FINAL-REVIEW.md`.

The post-exclusion isolated live cohort returned **23/23 HTTP 200 nonempty listings**, including paired first/second taps, combined M4U+HD, CJ/HM controls and the separate Nexa transport. None contained G-Direct. The old exact G-Direct route returned 410.

Sequential real decoder sampling of eight actual returned cards passed **14/16** start/90-second checks: M4U Pixeldrain **8/8**, HD **6/8**. The selected HD Batman HEVC worker returned 403 and zero decoded frames at both offsets; these failures are retained, not replaced with retries. Other returned mirrors are not silently substituted or removed. This is not native-app, full-length, all-track, all-mirror or sustained-load certification. The old G-Direct failure is historical evidence for its requested exclusion, not an outstanding promise to repair its shared relay.

The expanded 98-entrypoint sweep remains **95/98**. Three failures also reproduce on untouched c593 and are unmodified: `tools/mlbd-index/test_direct.cjs`, `tools/mlbd-index/test_preserve_base.cjs`, and `tools/mls-index-lab/test-proxy-trainer.cjs`. The originally scoped 46 legacy entrypoints and all eight HD entrypoints pass. No unrelated MLBD/proxy runtime fix, test exemption or baseline hash reset was applied.
