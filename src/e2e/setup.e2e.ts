import { expect, test } from '@playwright/test'
import { withInstallDirs } from '../main/setup-checks'
import { launch } from './launch'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The Setup window (#89). Every other e2e passes it through scripts/ready-env.mjs (a temp home holding the skill, a
// dummy claude on PATH); these launch without that to prove the gate.
const SKILL = resolve('skills/kapecut')
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH' // Windows spells it Path
// Off Windows main appends the usual install dirs to PATH: an ffmpeg there is found whatever PATH the launch gets.
const ffmpegAppended = process.platform !== 'win32' && withInstallDirs('', homedir()).split(':').some((d) => existsSync(join(d, 'ffmpeg')))
const FFMPEG_APPENDED = 'main finds the ffmpeg in an install dir it appends to PATH'

// Best effort: Electron's helper processes can hold the profile a moment past close on Windows.
const cleanUp = (root: string) => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 })
  } catch {
    // left in %TEMP% for the OS to clear
  }
}

test('with ffmpeg and Claude Code off PATH the Setup window blocks Open folder; Re-check after a fix lets the user in', async () => {
  test.skip(ffmpegAppended, FFMPEG_APPENDED)
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = join(root, 'Alpha')
    mkdirSync(dir)
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Alpha', size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html'] }))
    writeFileSync(join(dir, 'a.html'), '<canvas id="c" width="200" height="200"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>')
    const { app, page } = await launch({ project: dir, userData: join(root, 'user'), env: { [PATH_KEY]: '' }, waitForExport: false })
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      await expect(setup).toBeVisible()
      await expect(setup.locator('li[data-check="ffmpeg"]')).toHaveClass(/\bno\b/)
      await expect(setup.locator('li[data-check="ffmpeg"] code')).toBeVisible()
      await expect(setup.locator('li[data-check="claude"]')).toHaveClass(/\bno\b/)
      await expect(setup.locator('li[data-check="skill"]')).toHaveClass(/\bok\b/) // the env's temp home has it
      await expect(setup.locator('#setup-prompt')).toHaveAttribute('hidden', '') // no Claude Code to run it
      await page.locator('#projects summary').click()
      await expect(page.locator('#open-folder')).toBeDisabled()
      // A drop says why nothing opened.
      await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.items.add(new File(['x'], 'x.txt'))
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      })
      await expect(page.locator('#setup-status')).toHaveText('Install what is missing first, then drop it again')
      // Main holds the launch Project too: it refuses an open, and no Session file tells Claude a Project is open.
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog
      }, dir)
      // Past the page's gate, then the button as it was.
      await page.locator('#open-folder').evaluate((b: HTMLButtonElement) => ((b.disabled = false), b.click(), (b.disabled = true)))
      await expect(page.locator('#export-status')).toHaveText('Install what the Setup window lists first')
      // Checked after that round trip: a launch open would have written it (async) long before.
      expect(existsSync(join(root, 'user', 'session.json'))).toBe(false)

      // The user installs them: PATH has them again (in main, where the checks run).
      await app.evaluate((_e, path) => void (process.env.PATH = path), process.env.PATH ?? '')
      await setup.getByRole('button', { name: 'Re-check' }).click()
      await expect(setup.locator('li[data-check="ffmpeg"]')).toHaveClass(/\bok\b/)
      // Gone at once, while the window stays a moment saying All set (toBeHidden would pass once the window goes).
      await expect(setup.locator('#setup-status')).toHaveText('All set')
      expect(await setup.locator('#setup-recheck').isVisible()).toBe(false)
      await expect(setup).toBeHidden()
      await expect(page).toHaveTitle('Alpha - KapeCut') // the launch Project opens once they pass
      expect(existsSync(join(root, 'user', 'session.json'))).toBe(true)
      await page.locator('#projects summary').click()
      await expect(page.locator('#open-folder')).toBeEnabled()
    } finally {
      await app.close().catch(() => {}) // a failed step leaves no hidden app holding the profile
    }
  } finally {
    cleanUp(root)
  }
})

test('with Claude Code found and ffmpeg missing, Copy Prompt copies the ffmpeg command for Claude to run', async () => {
  test.skip(ffmpegAppended, FFMPEG_APPENDED)
  const bin = process.env.KAPECUT_DUMMY_BIN
  if (!bin) throw new Error('KAPECUT_DUMMY_BIN is unset: run through playwright.config.ts, whose globalSetup (scripts/ready-env.mjs) sets it')
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const { app, page } = await launch({ userData: join(root, 'user'), env: { [PATH_KEY]: bin }, waitForExport: false })
    const had = await app.evaluate(({ clipboard }) => clipboard.readText()) // the user's clipboard, given back after
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      await expect(setup.locator('li[data-check="ffmpeg"]')).toHaveClass(/\bno\b/)
      await expect(setup.locator('li[data-check="claude"]')).toHaveClass(/\bok\b/)
      await app.evaluate(({ clipboard }) => clipboard.writeText(''))
      await setup.getByRole('button', { name: 'Copy Prompt' }).click()
      await expect(page.locator('#toast-text')).toHaveText('Prompt copied')
      const command = await setup.locator('li[data-check="ffmpeg"] code').textContent()
      const prompt = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(prompt).toContain(`- ffmpeg 4.4+ (ffmpeg is not on PATH. Export encodes the MP4 with it): ${command}\n`)
      expect(prompt).toContain('tell me to press Re-check')
    } finally {
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), had).catch(() => {})
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})

test('with the skill missing, Install skill copies it; a changed copy asks before Update overwrites it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const home = join(root, 'home')
  const installed = join(home, '.claude', 'skills', 'kapecut')
  const asHome = { userData: join(root, 'user'), env: { USERPROFILE: home, HOME: home }, waitForExport: false } // both launches
  try {
    let { app, page } = await launch(asHome)
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      const row = setup.locator('li[data-check="skill"]')
      await expect(row).toHaveClass(/\bno\b/)
      await row.getByRole('button', { name: 'Install skill' }).click()
      await expect(row).toHaveClass(/\bok\b/)
      await expect(setup).toBeHidden()
      expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'))
      // Once in, in for this run: a reload (a Project switch does one) does not bring the window back, even when a check
      // would fail now.
      writeFileSync(join(installed, 'SKILL.md'), 'my own edit')
      await page.reload()
      await expect(page.locator('.error')).toBeVisible()
      await expect(setup).toBeHidden()
      await app.close()

      // Next launch, the edit counts: Update asks (main's own dialog, whatever the page does), and Cancel keeps the edit.
      ;({ app, page } = await launch(asHome))
      // The native box cannot be clicked: answer it with `response` (1 Cancel, 0 Update) and count the asks.
      const answer = (response: number) =>
        app.evaluate(({ dialog }, response) => {
          const g = globalThis as { asked?: number }
          dialog.showMessageBox = (async () => ((g.asked = (g.asked ?? 0) + 1), { response, checkboxChecked: false })) as typeof dialog.showMessageBox
        }, response)
      const asked = () => app.evaluate(() => (globalThis as { asked?: number }).asked ?? 0)
      const update = page.locator('li[data-check="skill"]').getByRole('button', { name: 'Update skill' })
      await answer(1)
      await update.click()
      await expect.poll(asked).toBe(1)
      await expect(page.locator('#setup-status')).toHaveText('') // checked again after the Cancel
      expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toBe('my own edit')
      await answer(0)
      await update.click()
      await expect.poll(asked).toBe(2)
      await expect(page.getByRole('dialog', { name: /KapeCut needs/ })).toBeHidden()
      expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'))
    } finally {
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})

test('every check passing shows no Setup window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const home = join(root, 'home')
    cpSync(SKILL, join(home, '.claude', 'skills', 'kapecut'), { recursive: true })
    const { app, page } = await launch({ userData: join(root, 'user'), env: { USERPROFILE: home, HOME: home }, waitForExport: false })
    try {
      await expect(page.locator('.error')).toBeVisible() // the No Project state: past the gate
      await expect(page.locator('#setup')).toBeHidden()
    } finally {
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})
