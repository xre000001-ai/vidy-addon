# Deployment runbook

## Targets

| App | Namespace | Deploy branch | Remote alias |
|---|---|---|---|
| **vidy** (this repo) | `3404d3c5dc63` (xre) | **`main`** | `dokku@beamup-vidy:3404d3c5dc63-vidy` |
| PoolHub | `293c2a7d7dd6` (badhan) | `master` | `dokku@beamup-badhan:293c2a7d7dd6-poolhub` |

## vidy (this repo)

```bash
cd /home/user/vidy-addon
git push dokku@beamup-vidy:3404d3c5dc63-vidy HEAD:main
```

- **Branch is `main`.** Pushing `master` only updates the ref — no build runs (learned the hard way).
- The beamup linter calls `/manifest.json` inside the freshly started container (5 attempts × 10 s). `server.js` therefore `listen`s **before** spawning the MovieBox child.
- The MovieBox child is ESM: `nethex/package.json` carries `"type": "module"` — older deployer Nodes kill type-less ESM.
- First SSH use after a sandbox reset: restore keys (`bash /home/user/beamup/restore-keys.sh`), and if the key is refused, re-register:
  ```bash
  ssh -i ~/.ssh/beamup_bootstrap -o IdentitiesOnly=yes dokku@a.baby-beamup.club sync-github-keys xre000001-ai
  ```
  (The key must also exist on the `xre000001-ai` GitHub account; PAT lives in `vidfast-addon/docs/DEPLOY-KEYS.txt`.)

## PoolHub

```bash
cd /home/user/poolhub
git push badhan HEAD:master
```

- Set vars **one per call, no quotes** (the entry script forwards only `$3` verbatim):
  ```bash
  ssh beamup-badhan config:set 293c2a7d7dd6-poolhub POOLHUB_ADMIN_TOKEN=ph-…
  ```
- Env is baked at **build time** (herokuish): after `config:set`, push again to rebuild.
- Verify with a cache-buster — beamup's nginx caches 200s for **2 hours** (`?cb=$RANDOM`). The app itself also sends `Cache-Control: no-store` since v1.3.6.
- If a push ends in `beamup-sync-swarm … Unexpected end of JSON input`, the platform's local Docker registry hiccuped — wait and retry later; do **not** run `delete-addon` while it is broken (it deletes half the app, then the sync step fails).

## Logs

```bash
ssh beamup-badhan logs 293c2a7d7dd6-poolhub     # PoolHub
ssh beamup-vidy logs 3404d3c5dc63-vidy          # vidy (+ child stdout is swallowed; use /debug/ring)
```
