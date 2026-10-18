#!/usr/bin/env bash
# Rule-compliant deploy (see DEPLOY.md).
set -e
cd "$(dirname "$0")"

# rule 1: deps non-empty
node -e "const p=require('./package.json');if(!Object.keys(p.dependencies||{}).length){console.error('RULE 1: package.json dependencies empty — beamup will reject');process.exit(1)}"

# rule 3: remotes present?
git remote get-url gh >/dev/null 2>&1 || { echo 'RULE 3: remotes missing — run restore-remotes.sh first'; exit 1; }

# rule 4: github first
git push gh main
git push gh HEAD:master
echo 'gh: main+master ✓'

# rule 2: retry loop on pre-receive declines (deploy lock) — never force
BEAMUP="${BEAMUP_REMOTE:-beamup-id_ed25519:3404d3c5dc63-vidy}"
OK=0
for i in 1 2 3 4 5; do
  if OUT=$(git push "$BEAMUP" main:main 2>&1); then
    echo "$OUT" | tail -2
    echo 'beamup: landed ✓'
    OK=1
    break
  fi
  echo "$OUT" | tail -2
  echo "beamup: declined (deploy lock?) — attempt $i/5, waiting 75s (rule 2)"
  [ "$i" = "5" ] || sleep 75
done
[ "$OK" = "1" ] || { echo 'beamup: FAILED after 5 attempts'; exit 1; }
V=$(node -e "console.log(require('./package.json').version)")
echo "pushed. rule 5: poll /_health until version = $V"
