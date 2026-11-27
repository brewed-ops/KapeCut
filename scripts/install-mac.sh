#!/bin/bash
# Installs the latest KapeCut on a Mac in one line:
#   curl -fsSL https://kapecut.brewedops.cloud/install.sh | bash
# (the site redirects /install.sh to this file: KapeCutSite deploy/nginx/site.conf)
# The DMG is not notarized yet, so a browser download is quarantined and Gatekeeper blocks the app. curl sets no
# quarantine flag; the xattr below clears one anyway. Tests set KAPECUT_DMG_URL, KAPECUT_APPS and KAPECUT_TEST.
# All in main(), called on the last line: piped into bash, nothing runs until the whole file has arrived.
set -euo pipefail

main() {
  [ "$(uname -s)" = Darwin ] || fail "This installs KapeCut on a Mac. Other systems: https://github.com/brewed-ops/KapeCut/releases"

  local apps="${KAPECUT_APPS:-/Applications}" url="${KAPECUT_DMG_URL:-}"
  if [ -z "$url" ]; then
    # A Release holds one dmg: universal (Intel and Apple silicon) after v0.0.2, Apple silicon only up to it.
    url=$(curl -fsSL https://api.github.com/repos/brewed-ops/KapeCut/releases/latest | grep -o '"browser_download_url": *"[^"]*\.dmg"' | grep -o 'https://[^"]*' | head -1 || true)
    [ -n "$url" ] || fail "Could not find the latest KapeCut DMG on GitHub: https://github.com/brewed-ops/KapeCut/releases"
  fi

  work=$(mktemp -d)
  mnt="$work/mnt"
  trap cleanup EXIT
  echo "Downloading ${url##*/}..."
  curl -fL --progress-bar -o "$work/KapeCut.dmg" "$url"
  mkdir "$mnt"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "$work/KapeCut.dmg"
  # The new copy is whole before the old one goes, so a failed copy never leaves the user without KapeCut.
  ditto "$mnt/KapeCut.app" "$work/KapeCut.app"
  xattr -dr com.apple.quarantine "$work/KapeCut.app" 2>/dev/null || true

  # An open KapeCut would keep running the old copy: quit it and wait until it is gone. A test run leaves it alone.
  if [ -z "${KAPECUT_TEST:-}" ] && pgrep -xq KapeCut; then
    osascript -e 'quit app "KapeCut"' >/dev/null 2>&1 || fail "KapeCut did not quit. Close it, then run this again."
    for _ in $(seq 50); do pgrep -xq KapeCut || break; sleep 0.2; done
    ! pgrep -xq KapeCut || fail "KapeCut is still running. Close it, then run this again."
  fi
  rm -rf "$apps/KapeCut.app"
  mv "$work/KapeCut.app" "$apps/KapeCut.app"

  echo "KapeCut is in $apps."
  [ -n "${KAPECUT_TEST:-}" ] || open "$apps/KapeCut.app"
}

fail() {
  echo "$1" >&2
  exit 1
}

cleanup() {
  hdiutil detach -quiet "$mnt" 2>/dev/null || hdiutil detach -quiet -force "$mnt" 2>/dev/null || true
  # Never walk into a volume still mounted there.
  mount | grep -qF " on $mnt " || rm -rf "$work"
}

main "$@"
