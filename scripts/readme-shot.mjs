// The README screenshot (docs/images/kapecut.png): builds the demo Project (scripts/readme-demo.mjs) in a temp folder,
// opens it with Claude active and one Note done, scrubs to the product shot and shoots at 1440x900.
// Usage: npm run shot:readme   (builds first)
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readyEnv from './ready-env.mjs'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node
const dropEnv = readyEnv()
const out = resolve('docs/images/kapecut.png')
const dir = join(mkdtempSync(join(tmpdir(), 'kapecut-readme-')), 'lumen-launch')
execFileSync(process.execPath, ['scripts/readme-demo.mjs', dir], { stdio: 'inherit' })
const userData = mkdtempSync(join(tmpdir(), 'kapecut-readme-data-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, KAPECUT_PROJECT: dir } })
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#export:enabled').waitFor({ timeout: 30_000 })
  await page.locator('#note-list .pin.done').waitFor({ timeout: 15_000 })
  appendFileSync(join(dir, 'brief.md'), '\n') // a change: Claude active
  await page.locator('#claude-status[data-s="active"]').waitFor({ timeout: 15_000 })
  await page.locator('#scrub').evaluate((el) => ((el.value = '3.1'), el.dispatchEvent(new Event('input')))) // mid-sweep on the product shot, Note 2 on the beam
  await page.waitForTimeout(1000) // the Frame and thumbnails settle
  await page.locator('#files-path').evaluate((el) => (el.textContent = '~/Videos/lumen-launch')) // not this machine's path
  await page.screenshot({ path: out })
  console.log(out)
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
  dropEnv()
}
