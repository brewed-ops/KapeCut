// Smoke test of the packaged app on Windows or macOS (npm run dist first): fresh home -> Setup shows the skill missing ->
// Install skill copies it out of the package -> the editor opens examples/hello, shot in each theme. Usage: npm run smoke:packaged
// shortcut: Windows and macOS only; Linux CI would need a virtual display.
import { _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readyEnv from './ready-env.mjs'

delete process.env.ELECTRON_RUN_AS_NODE
// electron-builder unpacks to win-unpacked, or mac-universal holding the .app
const mac = readdirSync('release').find((d) => /^mac/.test(d))
const exe = resolve(process.platform === 'darwin' ? `release/${mac}/KapeCut.app/Contents/MacOS/KapeCut` : 'release/win-unpacked/KapeCut.exe')
const done = readyEnv() // dummy claude on PATH, temp home WITH the skill
const home = process.env.HOME // ready-env points HOME and USERPROFILE at the same temp home
rmSync(join(home, '.claude'), { recursive: true, force: true }) // now the skill is missing
const userData = mkdtempSync(join(tmpdir(), 'kapecut-pkg-'))
const ok = (cond, what) => console.log(cond ? 'PASS' : 'FAIL', what) || cond || (process.exitCode = 1)

const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${userData}`], env: { ...process.env, KAPECUT_PROJECT: resolve('examples/hello') } })
try {
  const page = await app.firstWindow()
  ok((await app.evaluate(({ app }) => app.isPackaged)), 'runs as the packaged app')
  const install = page.getByRole('button', { name: 'Install skill' })
  await install.waitFor({ timeout: 15_000 })
  ok(true, 'Setup shows Install skill on a fresh home')
  await install.click()
  await page.locator('#export').waitFor({ state: 'visible', timeout: 15_000 })
  ok(existsSync(join(home, '.claude', 'skills', 'kapecut', 'SKILL.md')), 'Install skill copied SKILL.md from the package')
  await page.locator('#export:not([disabled])').waitFor({ timeout: 15_000 })
  ok(true, 'editor opened examples/hello, Export enabled')
  mkdirSync('.scratch', { recursive: true })
  for (const theme of ['dark', 'light', 'glass']) {
    // Through Settings, as a user picks it (the page's bridge is taken once, by the app)
    await page.locator('#settings').click()
    await page.locator('#settings-panel nav button[data-section="appearance"]').click()
    await page.locator(`input[name="theme"][value="${theme}"]`).click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800) // the panel shrinks shut
    await page.screenshot({ path: `.scratch/packaged-${process.platform}-${theme}.png` })
  }
} catch (e) {
  ok(false, String(e))
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
  done()
}
