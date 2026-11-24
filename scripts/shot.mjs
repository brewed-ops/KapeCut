// Screenshot of the built app on a Project, for PR evidence and visual checks.
// Usage: npm run shot -- [projectDir] [out.png] [WxH]   (defaults: examples/three-scenes, test-results/shot.png, 1440x900)
import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readyEnv from './ready-env.mjs'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node
const dropEnv = readyEnv() // past the Setup window, the real home untouched

const [dir = 'examples/three-scenes', out = 'test-results/shot.png', size = '1440x900'] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)
const userData = mkdtempSync(join(tmpdir(), 'kapecut-shot-')) // never touches the real recent-Projects list
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  env: { ...process.env, KAPECUT_PROJECT: resolve(dir) },
})
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width, height })
  await page.locator('#export:enabled').waitFor({ timeout: 30_000 }) // every Scene has opened
  await page.locator('#encoder b').first().waitFor({ state: 'attached', timeout: 30_000 }) // encoder check reported (in Settings)
  await page.waitForTimeout(500) // fonts and the ResizeObserver fit settle
  await page.screenshot({ path: out })
  console.log(resolve(out))
} finally {
  await app.close()
  dropEnv()
}
