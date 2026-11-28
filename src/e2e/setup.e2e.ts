import { expect, test } from '@playwright/test'
import { findAgent, findOnPath, withInstallDirs } from '../main/setup-checks'
import { HOST, terminalArgv } from '../main/terminal'
import { launch } from './launch'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

// The Setup window (#89). Every other e2e passes it through scripts/ready-env.mjs (a temp home holding the skill, a
// dummy codex on PATH); these launch without that to prove the gate.
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

test('with ffmpeg and every Agent off PATH the Setup window blocks Open folder; Re-check after a fix lets the user in', async () => {
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
      const agent = setup.locator('li[data-check="agent"]')
      await expect(agent).toHaveClass(/\bno\b/)
      await expect(agent.locator('b')).toHaveText('Claude Code') // the suggested install, the others named
      await expect(agent.locator('p')).toHaveText(/^No Agent on PATH\. Also works: Codex, OpenCode/)
      await expect(agent.locator('code')).toBeVisible()
      await expect(setup.locator('li[data-check="skill"]')).toHaveClass(/\bok\b/) // the env's temp home has it
      await expect(setup.locator('#setup-prompt')).toHaveAttribute('hidden', '') // no Agent to run it
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

test('with an Agent found and ffmpeg missing, Copy Prompt copies the ffmpeg command for the Agent to run', async () => {
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
      await expect(setup.locator('li[data-check="agent"]')).toHaveClass(/\bok\b/)
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

test("Run on a missing row opens a terminal running that row's command (spawn stubbed: nothing installs)", async () => {
  // Off Windows main appends the install dirs to PATH: an Agent there leaves no missing Agent row to Run.
  test.skip(process.platform !== 'win32' && !!findAgent({ PATH: withInstallDirs('', homedir()) }), 'main finds an Agent in an install dir it appends to PATH')
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const { app, page } = await launch({ userData: join(root, 'user'), env: { [PATH_KEY]: '' }, waitForExport: false })
    try {
      // Main's spawn records instead of running, and SystemRoot points nowhere: a real spawn would find no PowerShell.
      const nowhere = join(root, 'no-windows')
      await app.evaluate((_e, nowhere) => {
        const g = globalThis as { runs?: unknown[] }
        const { EventEmitter } = process.getBuiltinModule('node:events')
        g.runs = []
        process.env.SystemRoot = nowhere
        process.getBuiltinModule('node:child_process').spawn = ((...args: unknown[]) => {
          g.runs!.push(args)
          const child = Object.assign(new EventEmitter(), { unref: () => {} })
          setTimeout(() => (child.emit('spawn'), child.emit('close', 0))) // cmd and osascript exit once the window is open
          return child
        }) as never
      }, nowhere)
      const row = page.getByRole('dialog', { name: /KapeCut needs/ }).locator('li[data-check="agent"]')
      const command = await row.locator('code').textContent()
      const run = row.getByRole('button', { name: 'Run the Claude Code command' })
      await run.click()
      await expect(page.locator('#setup-status')).toHaveText('Running in a terminal. Re-check when it is done')
      await expect(run).toBeDisabled() // one terminal per click, until Re-check draws the rows again
      const runs = await app.evaluate(() => (globalThis as { runs?: unknown[] }).runs)
      expect(runs).toEqual([terminalArgv(HOST, command!, { SystemRoot: nowhere })])
    } finally {
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})

test('the optional skill: Install skill copies it while another check fails; a changed copy asks before Update overwrites it', async () => {
  test.skip(ffmpegAppended, FFMPEG_APPENDED)
  const bin = process.env.KAPECUT_DUMMY_BIN
  if (!bin) throw new Error('KAPECUT_DUMMY_BIN is unset: run through playwright.config.ts')
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const home = join(root, 'home')
  const installed = join(home, '.claude', 'skills', 'kapecut')
  // Both launches: ffmpeg missing keeps the window up, so the skill row and its button show.
  const asHome = { userData: join(root, 'user'), env: { USERPROFILE: home, HOME: home, [PATH_KEY]: bin }, waitForExport: false }
  try {
    let { app, page } = await launch(asHome)
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      const row = setup.locator('li[data-check="skill"]')
      await expect(row).toHaveClass(/\bopt\b/)
      await expect(row.locator('.state')).toHaveText('Optional')
      await row.getByRole('button', { name: 'Install skill' }).click()
      await expect(row).toHaveClass(/\bok\b/)
      expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'))
      await app.evaluate((_e, path) => void (process.env.PATH = path), process.env.PATH ?? '')
      await setup.getByRole('button', { name: 'Re-check' }).click()
      await expect(setup).toBeHidden()
      // Once in, in for this run: a reload (a Project switch does one) does not bring the window back, even when a check
      // would fail now.
      await app.evaluate(() => void (process.env.PATH = ''))
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
      await expect(page.locator('li[data-check="skill"]')).toHaveClass(/\bok\b/)
      expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'))
    } finally {
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})

test('only a non-Claude Agent on PATH and no skill: Setup passes', async () => {
  test.skip(process.platform === 'linux', 'Linux finds Chrome or Edge on PATH, which this test cuts down')
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    // PATH: a fake codex and the machine's ffmpeg and ffprobe, so no Claude Code this machine has is found. A tool beside
    // a real Agent (Claude Code shares ~/.local/bin with ffmpeg on a dev machine) is copied in instead of its folder.
    // shortcut: off Windows main also appends the Homebrew and ~/.local/bin dirs, so a Mac with a real claude there
    // passes on it, not codex; CI Macs have none.
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex'), '', { mode: 0o755 })
    const dirs = [bin]
    for (const tool of ['ffmpeg', 'ffprobe'].map((t) => findOnPath(t))) {
      if (!tool) throw new Error('ffmpeg and ffprobe must be on PATH for this test')
      if (findAgent({ ...process.env, PATH: dirname(tool) })) copyFileSync(realpathSync(tool), join(bin, basename(tool)))
      else dirs.push(dirname(tool))
    }
    const path = dirs.join(delimiter)
    const home = join(root, 'home') // no skill in it
    const { app, page } = await launch({ userData: join(root, 'user'), env: { USERPROFILE: home, HOME: home, [PATH_KEY]: path }, waitForExport: false })
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

test('an outdated skill never blocks: Setup says so once, with Update skill, and Re-check goes on', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const home = join(root, 'home')
    cpSync(SKILL, join(home, '.claude', 'skills', 'kapecut'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'kapecut', 'SKILL.md'), 'my own edit')
    const { app, page } = await launch({ userData: join(root, 'user'), env: { USERPROFILE: home, HOME: home }, waitForExport: false })
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      await expect(setup.locator('li[data-check="skill"]')).toHaveClass(/\bopt\b/)
      await expect(setup.locator('li[data-check="skill"]').getByRole('button', { name: 'Update skill' })).toBeVisible()
      await expect(setup.locator('#setup-status')).toHaveText('Your KapeCut skill differs from this KapeCut. Update it, or Re-check to go on')
      await page.locator('#projects summary').click() // in, not blocked: a Project may open

      await expect(page.locator('#open-folder')).toBeEnabled()
      await page.keyboard.press('Escape')
      await setup.getByRole('button', { name: 'Re-check' }).click()
      await expect(setup).toBeHidden()
      expect(readFileSync(join(home, '.claude', 'skills', 'kapecut', 'SKILL.md'), 'utf8')).toBe('my own edit')
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

test('a long status line wraps beside the buttons, never into them: Copy Prompt and Re-check stay one line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    // No Agent anywhere main looks (the launch's temp home has none): the Setup window stays.
    const { page, app } = await launch({ userData: join(root, 'user'), env: { [PATH_KEY]: '' }, waitForExport: false })
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      await expect(setup).toBeVisible()
      const prompt = setup.locator('#setup-prompt')
      await prompt.evaluate((b) => (b.hidden = false)) // shown while an Agent is found: both buttons share the row
      const boxes = () => Promise.all(['#setup-prompt', '#setup-recheck'].map((s) => setup.locator(s).boundingBox()))
      const before = await boxes()
      // The longest status the row gets: a Mac Run that Automation refused (macOS check, #15).
      await setup.locator('#setup-status').evaluate((p) => (p.textContent = 'Could not open a terminal (exit code 1): 73:160: execution error: Not authorized to send Apple events to Terminal. (-1743). Allow KapeCut to control Terminal in System Settings > Privacy & Security > Automation'))
      const after = await boxes()
      for (const [i, box] of after.entries()) expect({ w: box!.width, h: box!.height }).toEqual({ w: before[i]!.width, h: before[i]!.height })
    } finally {
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})
