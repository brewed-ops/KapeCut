#!/bin/bash
# Rewrites package-lock.json on Linux from package.json alone: a lock written on Windows lacks the @emnapi packages
# the CI runners need, and starting from the old lock keeps that gap. Run after every dependency change, from Git Bash:
#   MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash /mnt/d/<repo>/scripts/relock-linux.sh "$(npm -v)"
# Then diff package versions against the old lock before committing.
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
d=$(mktemp -d)
cp "$repo/package.json" "$d/"
cd "$d"
npx -y "npm@$1" install --package-lock-only >/dev/null 2>&1
npx -y "npm@$1" ci --ignore-scripts >/dev/null 2>&1 # proves the new lock installs on Linux
cp package-lock.json "$repo/package-lock.json"
echo "relocked, npm ci passes on Linux"
