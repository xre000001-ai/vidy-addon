#!/usr/bin/env bash
# Remotes vanish with workspace snapshots (.git/config excluded) — recreate EXACTLY these, nothing else.
# gh = xre-token via ~/.git-credentials (GitHub-push-protection: টোকেন-কখনো-ট্র্যাকড-ফাইলে-নয়)
# beamup = xre-অ্যাকাউন্ট-কী (vidy-addon xre-অ্যাকাউন্টের — ইউজার-নির্দেশ; badhan-নয়)
set -e
cd "$(dirname "$0")"
chmod 600 ~/.ssh/*_ed25519 ~/.ssh/beamup_bootstrap 2>/dev/null || true # স্ন্যাপশট-পুনরুদ্ধারে-পারমিশন-0644-হয়ে-যায়
if [ -n "$GH_TOKEN" ]; then printf 'https://x-access-token:%s@github.com\n' "$GH_TOKEN" > ~/.git-credentials; chmod 600 ~/.git-credentials; fi
git config credential.helper store
git remote remove gh 2>/dev/null || true
git remote remove beamup 2>/dev/null || true
git remote add gh https://github.com/xre000001-ai/vidy-addon
git remote add beamup beamup-id_ed25519:3404d3c5dc63-vidy
echo 'remotes restored: gh (credential-store) + beamup (xre key id_ed25519)'
