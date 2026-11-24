/** Where the updater is, as main sends it to Settings (#138). `out` is the Mac's: notify and link, no install. */
export type UpdateStatus =
  | { state: 'idle' | 'off' | 'checking' | 'latest' }
  | { state: 'available' | 'out' | 'ready'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'error'; message: string }

/** The Release page of a version, or null for anything but a plain semver: the feed's text never picks the URL. */
export const releasePage = (version: string) =>
  /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ? `https://github.com/brewed-ops/KapeCut/releases/tag/v${version}` : null
