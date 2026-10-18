# Deploy rules (beamup) — learned the hard way

1. **package.json `dependencies` must stay non-empty.** The beamup pre-receive hook
   rejects pushes whose dependency manifest is empty (1.15.69: five rejects in a row,
   even for an empty canary commit). Deps may be unused by code; keep the known-good
   entries (`express`, `undici`).
2. **A decline right after a successful deploy is a deploy lock, not a real failure.**
   Wait 60–90 s and retry the identical push. Never force, never amend history.
3. **Restore remotes/keys first** (`restore-remotes.sh`) — SSH keys and `.git/config`
   do not survive workspace snapshots.
4. **GitHub first, beamup second** — push `gh main` + `gh HEAD:master`, then beamup.
   The repo is the source of truth; commit messages in English, no semver suffixes.
5. **Deployed = health version matches package.json.** Poll `/_health` until
   `"version"` equals the pushed version; a push log alone proves nothing.

`deploy.sh` encodes rules 1–4 with the retry loop; rule 5 is the post-push check.
