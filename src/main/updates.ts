import { app, shell, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { handle } from './app-sender'
import { exporting } from './export'
import { releasePage, type UpdateStatus } from './update-status'

/**
 * Updates from GitHub Releases (#138, ADR 0006). Nothing downloads without a click. Windows and Linux download, then
 * install on Restart; the Mac, ad-hoc signed, only says a version is out and opens its Release page.
 */
export function handleUpdates(page: WebContents) {
  // e2e points an unpackaged app at a local feed (a dev-app-update.yml); a packaged app always reads its own config.
  const feed = process.env.KAPECUT_UPDATE_CONFIG
  if (!app.isPackaged && feed) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.updateConfigPath = feed
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false // only Restart to update installs
  autoUpdater.logger = null // its info lines would fill the console on every launch
  const mac = process.platform === 'darwin'

  let status: UpdateStatus = { state: 'idle' }
  const set = (next: UpdateStatus) => {
    status = next
    if (!page.isDestroyed()) page.send('updates:status', status)
  }
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }))
  autoUpdater.on('update-available', ({ version }) => set({ state: mac ? 'out' : 'available', version }))
  autoUpdater.on('download-progress', (p) => 'version' in status && set({ state: 'downloading', version: status.version, percent: Math.floor(p.percent) }))
  autoUpdater.on('update-downloaded', ({ version }) => set({ state: 'ready', version }))
  // Its messages carry a stack and the server's whole reply: the first line is the news.
  autoUpdater.on('error', (e: Error) => set({ state: 'error', message: String(e?.message ?? e).split('\n')[0].slice(0, 200) }))

  const check = async () => {
    if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return
    // null: an unpackaged app with no feed. A failure (undefined here) is already the 'error' status.
    if ((await autoUpdater.checkForUpdates().catch(() => undefined)) === null) set({ state: 'off' })
  }
  handle('updates:version', () => app.getVersion())
  handle('updates:status', () => status)
  handle('updates:check', check)
  handle('updates:download', () => {
    if (status.state === 'available') void autoUpdater.downloadUpdate().catch(() => {}) // a failure is the 'error' status
  })
  // Silent: the installer reuses the folder it was installed to; then KapeCut opens again.
  handle('updates:install', () => {
    if (exporting()) throw new Error('Cancel the Export before restarting to update') // quitting would throw it away
    if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
  })
  // No URL comes from the page: main opens the Release page of the version the feed named, checked by releasePage.
  handle('updates:open', () => {
    const url = status.state === 'out' && releasePage(status.version)
    if (url) void shell.openExternal(url)
  })
  void check() // the quiet check at launch: its result waits in Settings
}
