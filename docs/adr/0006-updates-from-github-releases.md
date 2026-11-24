# 0006 Updates come from published GitHub Releases; the Mac only gets told

**The Release is the update channel.** A `v*` tag drafts a Release with the three installers and their update feeds
(`latest.yml`, `latest-mac.yml`, `latest-linux.yml`, written by electron-builder's `publish: github`). Kenneth
publishes the draft by hand. `electron-updater` in the app reads the latest published Release of `brewed-ops/KapeCut`
without a token, so it sees nothing while the repo is private or the Release is still a draft. No token ships in the
app: anyone could read it out of the install folder.

**The Release is also the trust.** The installers are unsigned, so the updater checks only HTTPS and the sha512 in the
feed, which comes from the same Release. Whoever can publish a Release of the repo (a leaked token, a bad workflow run)
ships code every installed copy runs on Restart to update. Publishing stays a manual step, and code signing would
close it.

**Nothing downloads without a click.** A quiet check runs at launch and its result waits in Settings > Updates. On
Windows (NSIS) and Linux (AppImage), Update to vX.Y.Z downloads, and Restart to update installs and opens KapeCut again.
Quitting does not install a download on its own.

**The Mac is told, not updated.** The app is ad-hoc signed, and Squirrel.Mac only swaps in an app signed with an Apple
Developer ID. Settings says vX.Y.Z is out and opens its Release page. Main builds that URL from the repo name and the
feed's version, refused unless the version is plain semver; the page never passes a URL.

**e2e uses a local feed.** An unpackaged app with `KAPECUT_UPDATE_CONFIG` set reads that file as its
`dev-app-update.yml` (a generic provider on a local server). A packaged app ignores it.

Considered: a token in the app to read the private repo (leaks it), a separate public repo for Releases (one more repo
to keep in step, until this one goes public anyway), and a paid Apple Developer ID for real Mac updates (not for now,
Kenneth 2026-11-24).
