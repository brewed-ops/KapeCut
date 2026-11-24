import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './launch'

const current = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string
const installer = Buffer.from('not a real installer')
const sha512 = createHash('sha512').update(installer).digest('base64')
// latest.yml, latest-mac.yml and latest-linux.yml, as electron-builder writes them next to the installers.
const feedFor = (version: string) =>
  `version: ${version}\nfiles:\n  - url: kapecut-${version}.exe\n    sha512: ${sha512}\n    size: ${installer.length}\n` +
  `path: kapecut-${version}.exe\nsha512: ${sha512}\nreleaseDate: '2026-11-24T00:00:00.000Z'\n`

test('Settings > Updates: the launch check, Check for updates, and the next step (Update then Restart, or the Mac Release page)', async () => {
  // The fake feed: a failure at launch, then whatever version `latest` names.
  let latest: string | null = null
  const server = createServer((req, res) => {
    if (latest && /^\/latest(-mac|-linux)?\.yml/.test(req.url ?? '')) return res.end(feedFor(latest))
    if (latest && req.url === `/kapecut-${latest}.exe`) return res.end(installer)
    res.writeHead(404).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const cacheDir = `kapecut-e2e-updater-${randomUUID()}` // where a download lands, under the OS cache folder
  const config = join(root, 'dev-app-update.yml')
  writeFileSync(config, `provider: generic\nurl: http://127.0.0.1:${(server.address() as AddressInfo).port}/\nupdaterCacheDirName: ${cacheDir}\n`)
  const { app, page } = await launch({ env: { KAPECUT_UPDATE_CONFIG: config }, waitForExport: false })
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Settings' })
    await panel.getByRole('navigation').getByRole('button', { name: 'Updates' }).click()
    await expect(panel.locator('#settings-title')).toHaveText('Updates')
    await expect(panel.getByText(`Version v${current}`)).toBeVisible()
    const text = panel.locator('#update-text')
    // The quiet check at launch found no feed: it says so here, nowhere else.
    await expect(text).toHaveText(/^Update failed: /, { timeout: 15_000 })

    latest = current
    await panel.getByRole('button', { name: 'Check for updates' }).click()
    await expect(text).toHaveText('KapeCut is up to date.')

    latest = '9.9.9'
    await panel.getByRole('button', { name: 'Check for updates' }).click()
    await expect(text).toHaveText(/^v9\.9\.9 is out\./)
    if (process.platform === 'darwin') {
      // Ad-hoc signed: no install, the Release page opens in the browser instead.
      await app.evaluate(({ shell }) => {
        const g = globalThis as { opened?: string[] }
        g.opened = []
        shell.openExternal = (async (url: string) => void g.opened!.push(url)) as typeof shell.openExternal
      })
      await expect(panel.getByRole('button', { name: 'Update to v9.9.9' })).toHaveCount(0)
      await panel.getByRole('button', { name: 'Open Release page' }).click()
      await expect
        .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
        .toEqual(['https://github.com/brewed-ops/KapeCut/releases/tag/v9.9.9'])
    } else {
      // Nothing downloads before the click.
      await expect(panel.getByRole('button', { name: 'Open Release page' })).toHaveCount(0)
      await panel.getByRole('button', { name: 'Update to v9.9.9' }).click()
      await expect(text).toHaveText('v9.9.9 is downloaded.', { timeout: 15_000 })
      // Not clicked: it would quit the app and run the "installer".
      await expect(panel.getByRole('button', { name: 'Restart to update' })).toBeEnabled()
    }
  } finally {
    await app.close()
    server.close()
    rmSync(root, { recursive: true, force: true })
    // electron-updater's cache folder. shortcut: Linux would also need APPIMAGE set to download; CI runs no Linux e2e.
    const cache = process.platform === 'win32' ? process.env.LOCALAPPDATA : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'))
    if (cache && process.platform !== 'darwin') rmSync(join(cache, cacheDir), { recursive: true, force: true })
  }
})
