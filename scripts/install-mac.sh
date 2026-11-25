#!/bin/bash
# Installs the latest KapeCut on a Mac in one line:
#   curl -fsSL https://raw.githubusercontent.com/brewed-ops/KapeCut/main/scripts/install-mac.sh | bash
# The DMG is not notarized yet, so a browser download is quarantined and Gatekeeper blocks the app. curl sets no
# quarantine flag; the xattr below clears one anyway. Tests set KAPECUT_DMG_URL, KAPECUT_APPS and KAPECUT_TEST.
set -euo pipefail

[ "$(uname -s)" = Darwin ] || { echo "This installs KapeCut on a Mac. Other systems: https://github.com/brewed-ops/KapeCut/releases" >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "KapeCut's Mac build is for Apple silicon (M1 and later) only." >&2; exit 1; }

apps="${KAPECUT_APPS:-/Applications}"
url="${KAPECUT_DMG_URL:-}"
if [ -z "$url" ]; then
  url=$(curl -fsSL https://api.github.com/repos/brewed-ops/KapeCut/releases/latest | grep -o '"browser_download_url": *"[^"]*-arm64\.dmg"' | grep -o 'https://[^"]*' | head -1)
  [ -n "$url" ] || { echo "Could not find the latest KapeCut DMG on GitHub." >&2; exit 1; }
fi

work=$(mktemp -d)
mnt="$work/mnt"
cleanup() {
  hdiutil detach -quiet "$mnt" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "Downloading ${url##*/}..."
curl -fL --progress-bar -o "$work/KapeCut.dmg" "$url"
mkdir "$mnt"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "$work/KapeCut.dmg"

# An open KapeCut would keep running the old copy. A test run leaves the user's KapeCut alone.
[ -n "${KAPECUT_TEST:-}" ] || ! pgrep -xq KapeCut || osascript -e 'quit app "KapeCut"'
rm -rf "$apps/KapeCut.app"
ditto "$mnt/KapeCut.app" "$apps/KapeCut.app"
xattr -dr com.apple.quarantine "$apps/KapeCut.app" 2>/dev/null || true

echo "KapeCut is in $apps."
[ -n "${KAPECUT_TEST:-}" ] || open "$apps/KapeCut.app"
