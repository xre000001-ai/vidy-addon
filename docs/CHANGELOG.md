# Changelog

## 1.15.69 / nethex 2.11.5 — speed & resilience
- Five-second mission: keep-hot bench (re-prove the 8 oldest slots every 120s — slots never go cold), 24h winning-subject map (familiar titles skip meta+search), 45s playToken cycle (the matrix never pays the mint), parallel play/download races.
- First-try guarantee: honest roster (no fake proof seeds), cold gate + active bench (true mintToken POST criterion), own-slots-first apiFetch with a hub-relay backup + circuit breaker.
- Cold-boot tap 1 lands MovieBox cards (~8-10s); repeats 2.4-3.7s; empty answers self-heal in the background.

## 1.15.68 / nethex 2.11.1c — the rate-limit myth
- Controlled matrix testing (4 exits × curl/undici × token rotation × referers) disproved the per-IP rate-limit theory: tokens are not IP-bound and there is no quota. Real causes: lost undici, stale pinned JWTs rejected on play, over-tight timings, warm-up ordering.
- playToken() gate for play/download/caption (fresh mint, 60s cache); pool empty-check rotation; NX deadline 35s.

## 1.15.6x — hub-fed pools
- All local proxy scanning removed; the pool fills only from PoolHub sub-spaces (/pick every 60s). Live wins report back to the hub.
- Universal pool + per-source spaces (site/api/vb/wo), runtime proxy health (EWMA), blackout governor, resolver-grade 12s checker waves.

## Earlier
- See the workspace archive (HISTORY_BN) for the full Bengali build log.
