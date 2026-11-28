import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'
import { pngPixel } from './scene-pixel'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { HANDSHAKE } from '../renderer/agent/status'

// Best effort: Electron's helper processes can hold the profile a moment past close on Windows.
const cleanUp = (root: string) => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 })
  } catch {
    // left in %TEMP% for the OS to clear
  }
}

// A one-Scene Project with the Agent's handshake (connected, starts idle).
function project(root: string, name: string) {
  const dir = join(root, name)
  mkdirSync(dirname(join(dir, HANDSHAKE)), { recursive: true })
  writeFileSync(join(dir, HANDSHAKE), JSON.stringify({ version: 1, connected: new Date().toISOString() }))
  writeFileSync(join(dir, 'a.html'), '<canvas id="c" width="200" height="200"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>')
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name, size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html'] }))
  return dir
}

const settingsButton = (page: Page) => page.getByRole('button', { name: 'Settings', exact: true })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Settings' })
const section = (page: Page, name: string) => panel(page).getByRole('navigation').getByRole('button', { name })

test('Settings opens as a modal panel: a section nav, a header naming the section, and Escape, outside click and Close shut it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const { app, page } = await launch({ project: project(root, 'Alpha'), userData: join(root, 'user') })
    await expect(page.locator('footer')).toHaveCount(0)
    const button = settingsButton(page)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(page)).toBeVisible()
    // Modal: the editor behind it takes no clicks while it is open.
    expect(await page.locator('#settings-panel').evaluate((el: HTMLDialogElement) => el.matches(':modal'))).toBe(true)

    // General first; each nav button shows its section alone and names it in the header.
    const title = panel(page).locator('#settings-title')
    await expect(title).toHaveText('General')
    await expect(section(page, 'General')).toHaveAttribute('aria-current', 'true')
    await expect(page.getByLabel('Idle minutes')).toBeVisible()
    for (const [name, visible] of [['Appearance', 'Theme'], ['Setup', 'ffprobe'], ['General', 'Idle minutes']]) {
      await section(page, name).click()
      await expect(title).toHaveText(name)
      await expect(section(page, name)).toHaveAttribute('aria-current', 'true')
      await expect(panel(page).locator('section:not([hidden])')).toHaveCount(1)
      await expect(panel(page).locator('section:not([hidden])')).toContainText(visible)
    }

    // Setup: the tool checks.
    await section(page, 'Setup').click()
    for (const label of ['H.264 hardware', 'H.264 software', 'ffmpeg 4.4+', 'ffprobe', 'Claude Code', 'KapeCut skill', 'Chrome or Edge'])
      await expect(panel(page).locator('#encoder > span', { hasText: label })).toHaveText(new RegExp(`^${label.replace(/[.+]/g, '\\$&')} (yes|no)$`))
    // The Setup window let the editor open, so its checks all passed (scripts/ready-env.mjs).
    for (const label of ['Claude Code', 'KapeCut skill', 'Chrome or Edge'])
      await expect(panel(page).locator('#encoder > span', { hasText: label })).toHaveText(`${label} yes`)
    // The same fact the app finds: ffmpeg on the PATH it inherits from this process.
    const ffmpeg = (() => {
      try {
        return execFileSync('ffmpeg', ['-version'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }), true
      } catch {
        return false
      }
    })()
    await expect(panel(page).locator('#encoder > span', { hasText: /^ffmpeg/ })).toHaveText(`ffmpeg 4.4+ ${ffmpeg ? 'yes' : 'no'}`)

    // Every way out returns focus to the Settings row.
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toBeFocused()
    // Escape also after a click on the panel's text.
    await button.click()
    await panel(page).locator('#settings-title').click()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(button).toBeFocused()
    await button.click()
    await panel(page).getByRole('button', { name: 'Close Settings' }).click()
    await expect(panel(page)).toBeHidden()
    await expect(button).toBeFocused()
    await button.click()
    await page.mouse.click(5, 5) // the backdrop, outside the panel
    await expect(panel(page)).toBeHidden()
    await expect(button).toBeFocused()

    // Keys inside the panel are not the editor's: Space does not play, and Escape only closes Settings (a Note being added stays).
    await page.keyboard.press('n')
    await expect(page.locator('#note')).toHaveAttribute('aria-pressed', 'true')
    await button.click()
    await panel(page).locator('#settings-title').click()
    await page.keyboard.press('Space')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', /^Play/)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(page.locator('#note')).toHaveAttribute('aria-pressed', 'true')

    // The Project state cannot be read: Settings still opens and still checks the encoder.
    await app.evaluate(({ ipcMain }) => ipcMain.removeHandler('project:state'))
    await page.reload()
    await expect(page.locator('.error')).toBeVisible()
    await button.click()
    await section(page, 'Setup').click()
    await expect(panel(page).locator('#encoder > span', { hasText: /^ffprobe/ })).toHaveText(/^ffprobe (yes|no)$/)
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('clicking a recent Project in Settings opens it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const alpha = project(root, 'Alpha')
    const beta = project(root, 'Beta')
    const userData = join(root, 'user')
    mkdirSync(userData)
    writeFileSync(join(userData, 'recent-projects.json'), JSON.stringify([alpha, beta]))
    const { app, page } = await launch({ userData })
    await expect(page).toHaveTitle('Alpha - KapeCut')
    await settingsButton(page).click()
    const recent = panel(page).getByRole('group', { name: 'Recent Projects' }).getByRole('button')
    await expect(recent).toHaveText(['Alpha', 'Beta'])
    await recent.filter({ hasText: 'Beta' }).click()
    await expect(page).toHaveTitle('Beta - KapeCut')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('idle minutes change the pill live and survive a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = project(root, 'Alpha')
    const userData = join(root, 'user')
    let { app, page } = await launch({ project: dir, userData })
    const pill = page.locator('#agent-status')
    await expect(pill).toHaveAttribute('data-s', 'idle')
    await page.clock.install()
    await settingsButton(page).click()
    const input = page.getByLabel('Idle minutes')
    await expect(input).toHaveValue('15')
    await input.fill('2')
    await input.press('Enter') // a key in the app is activity: the pill turns active
    const saved = join(userData, 'settings.json')
    const file = () => existsSync(saved) && JSON.parse(readFileSync(saved, 'utf8'))
    await expect.poll(file).toEqual({ version: 2, idleMinutes: 2, theme: 'dark' })
    await expect(pill).toHaveAttribute('data-s', 'active')
    await page.clock.fastForward(60_000)
    await expect(pill).toHaveAttribute('data-s', 'active') // not yet: 2 minutes, not 1
    await page.clock.fastForward(61_000)
    await expect(pill).toHaveAttribute('data-s', 'idle') // long before the default 15
    // Out of range: main refuses it (the page does not check), the input and the file keep 2.
    await input.fill('500')
    await input.press('Enter')
    await expect(page.locator('#settings-status')).toHaveText('Idle minutes must be a whole number, 1 to 120')
    await expect(input).toHaveValue('2')
    // Escape drops what was typed and the old refusal: nothing is saved, the reopened panel is clean.
    await input.fill('9')
    await page.keyboard.press('Escape')
    await settingsButton(page).click()
    await expect(input).toHaveValue('2')
    await expect(page.locator('#settings-status')).toBeHidden()
    expect(file()).toEqual({ version: 2, idleMinutes: 2, theme: 'dark' })
    // A click outside keeps what was typed, like any field losing focus; a theme picked straight after keeps it too.
    await input.fill('3')
    await panel(page).getByRole('navigation').getByRole('button', { name: 'Appearance' }).click()
    await panel(page).getByRole('radio', { name: 'Light' }).check()
    await expect.poll(file).toEqual({ version: 2, idleMinutes: 3, theme: 'light' })
    await panel(page).getByRole('radio', { name: 'Dark' }).check()
    await expect.poll(file).toEqual({ version: 2, idleMinutes: 3, theme: 'dark' })
    await section(page, 'General').click()
    await input.fill('2')
    await page.mouse.click(5, 5)
    await expect(panel(page)).toBeHidden()
    await expect.poll(file).toEqual({ version: 2, idleMinutes: 2, theme: 'dark' })
    await app.close()

    ;({ app, page } = await launch({ project: dir, userData }))
    await expect(page.locator('#agent-status')).toHaveAttribute('data-s', 'idle')
    await page.clock.install()
    await settingsButton(page).click()
    await expect(page.getByLabel('Idle minutes')).toHaveValue('2')
    await expect(page.locator('#agent-status')).toHaveAttribute('data-s', 'active') // the click
    await page.clock.fastForward(121_000)
    await expect(page.locator('#agent-status')).toHaveAttribute('data-s', 'idle')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('the theme repaints the app at once, survives a restart, and System follows the OS live', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = project(root, 'Alpha')
    const userData = join(root, 'user')
    let { app, page } = await launch({ project: dir, userData })
    const look = () => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }))
    const saved = () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).theme
    const ground = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase())
    const dark = await look()
    expect(dark.theme).toBe('dark')
    await settingsButton(page).click()
    await section(page, 'Appearance').click()
    const radio = (name: string) => panel(page).getByRole('radio', { name })
    await expect(radio('Dark')).toBeChecked()
    // Each option repaints the page and the window's own ground, so a reload never flashes the other one.
    for (const [name, bg, hex] of [['Light', 'rgb(238, 241, 246)', '#eef1f6'], ['Coffee', 'rgb(244, 239, 230)', '#f4efe6']]) {
      await radio(name).check()
      await expect.poll(look).toEqual({ theme: name.toLowerCase(), bg })
      await expect.poll(saved).toBe(name.toLowerCase())
      expect(await ground()).toBe(hex)
    }
    await app.close()

    ;({ app, page } = await launch({ project: dir, userData }))
    expect((await look()).theme).toBe('coffee')
    await settingsButton(page).click()
    await section(page, 'Appearance').click()
    await expect(radio('Coffee')).toBeChecked()
    // System is Dark or Light, never Coffee.
    await page.emulateMedia({ colorScheme: 'dark' })
    await radio('System').check()
    await expect.poll(async () => (await look()).theme).toBe('dark')
    expect((await look()).bg).toBe(dark.bg)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(look).toEqual({ theme: 'light', bg: 'rgb(238, 241, 246)' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(async () => (await look()).theme).toBe('dark')
    expect(saved()).toBe('system')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('a 0.0.1 settings file keeps its look: its light opens as Coffee, its glass as Light', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = project(root, 'Alpha')
    const userData = join(root, 'user')
    mkdirSync(userData)
    for (const [old, now] of [['light', 'Coffee'], ['glass', 'Light']]) {
      writeFileSync(join(userData, 'settings.json'), JSON.stringify({ version: 1, idleMinutes: 15, theme: old }))
      const { app, page } = await launch({ project: dir, userData })
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(now.toLowerCase())
      await settingsButton(page).click()
      await section(page, 'Appearance').click()
      await expect(panel(page).getByRole('radio', { name: now })).toBeChecked()
      await app.close()
    }
  } finally {
    cleanUp(root)
  }
})

test('a theme that cannot be saved is not kept: the picker, the page and the next reload stay on the old one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const userData = join(root, 'user')
    mkdirSync(join(userData, 'settings.json'), { recursive: true }) // a folder where the file goes: every write fails
    const { app, page } = await launch({ project: project(root, 'Alpha'), userData })
    await settingsButton(page).click()
    await section(page, 'Appearance').click()
    // click, not check: check() fails when the failed save puts Dark back before it looks (macOS CI).
    await panel(page).getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('#settings-status')).not.toBeEmpty({ timeout: 10_000 })
    await expect(panel(page).getByRole('radio', { name: 'Dark' })).toBeChecked()
    await page.reload()
    await expect(page.locator('#export')).toBeEnabled({ timeout: 15_000 })
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('Settings grows in and fades out on the motion tokens; reduced motion only fades', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const { app, page } = await launch({ project: project(root, 'Alpha'), userData: join(root, 'user') })
    const button = settingsButton(page)
    // A long --dur-m (a value no rule hard-codes) holds the motion still enough to read mid-way.
    const hold = (on: boolean) =>
      page.evaluate((on) => (on ? document.documentElement.style.setProperty('--dur-m', '4s') : document.documentElement.style.removeProperty('--dur-m')), on)
    await hold(true)
    const read = () =>
      page.locator('#settings-panel').evaluate((el: HTMLElement) => {
        const s = getComputedStyle(el)
        return { scale: s.scale === 'none' ? 1 : Number(s.scale), opacity: Number(s.opacity), display: s.display, hits: s.pointerEvents }
      })

    await button.click()
    let mid = await read()
    expect(mid.scale).toBeLessThan(1)
    expect(mid.opacity).toBeLessThan(1)
    // A running transition keeps the 4 s it started with, past expect's 5 s default on a slow runner.
    await hold(false)
    await expect.poll(async () => (await read()).scale, { timeout: 15_000 }).toBe(1)

    // Closing fades it out before it leaves layout, and the leaving panel takes no clicks.
    await hold(true)
    await page.keyboard.press('Escape')
    mid = await read()
    expect(mid.display).not.toBe('none')
    expect(mid.hits).toBe('none')
    expect(mid.opacity).toBeGreaterThan(0)
    await hold(false)
    await expect.poll(async () => (await read()).display, { timeout: 15_000 }).toBe('none')

    // Reduced motion: it only fades, both ways, and never scales.
    // The long --dur-m again: at the real one a slow runner reads the fade after it ended.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await hold(true)
    await button.click()
    mid = await read()
    expect(mid.opacity).toBeLessThan(1)
    expect(mid.scale).toBe(1)
    await hold(false)
    await expect.poll(async () => (await read()).opacity, { timeout: 15_000 }).toBe(1)
    await hold(true)
    await page.keyboard.press('Escape')
    mid = await read()
    expect(mid.display).not.toBe('none') // fading out, not cut
    expect(mid.opacity).toBeGreaterThan(0)
    expect(mid.scale).toBe(1)
    await hold(false)
    await expect.poll(async () => (await read()).display, { timeout: 15_000 }).toBe('none')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('a theme switch, from Settings or System following the OS, recolours the Note marks and the next Note picture at once (#125)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = project(root, 'Alpha') // a 200 x 200 Frame
    const when = '2026-11-24T10:00:00.000Z'
    const at = { done: false, scene: 'a.html', sceneTime: 0, time: 0, frame: 0, created: when, updated: when }
    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 4, notes: [
      { n: 1, text: 'Point', ...at, point: { x: 50, y: 50 } },
      { n: 2, text: 'Box', ...at, box: { x: 100, y: 100, w: 40, h: 40 } },
      { n: 3, text: 'Stroke', ...at, stroke: [{ x: 10, y: 150 }, { x: 60, y: 180 }] },
    ] }))
    const { app, page } = await launch({ project: dir, userData: join(root, 'user') })
    await expect(page.locator('#marks .pin')).toHaveCount(3)
    // Every Note colour, read in the same task as the theme flag, so a repaint that lags a frame still fails.
    const colours = () =>
      page.evaluate(() => {
        const css = (sel: string, prop: string) => [...document.querySelectorAll(sel)].map((el) => getComputedStyle(el).getPropertyValue(prop))
        const probe = Object.assign(document.createElement('i'), { style: 'color: var(--accent)' })
        document.body.append(probe)
        const accent = getComputedStyle(probe).color
        probe.remove()
        return {
          theme: document.documentElement.dataset.theme,
          accent,
          marks: [...css('#marks .pin', 'background-color'), ...css('#marks .box', 'border-top-color'), ...css('#marks polyline', 'stroke'), ...css('.note-lane .marker', 'background-color')],
        }
      })
    // Checked on the read that first sees the new theme.
    const turnsTo = async (theme: string) => {
      let now = await colours()
      await expect.poll(async () => ((now = await colours()), now.theme)).toBe(theme)
      expect(now.marks).toHaveLength(8) // 3 pins, a box, a stroke, 3 Timeline markers
      expect(new Set(now.marks)).toEqual(new Set([now.accent]))
      return now.accent
    }
    const dark = await turnsTo('dark')
    await settingsButton(page).click()
    await section(page, 'Appearance').click()
    const radio = (name: string) => panel(page).getByRole('radio', { name })
    await radio('Light').check()
    const light = await turnsTo('light')
    expect(light).not.toBe(dark)

    // System, both ways.
    await page.emulateMedia({ colorScheme: 'dark' })
    await radio('System').check()
    expect(await turnsTo('dark')).toBe(dark)
    await page.emulateMedia({ colorScheme: 'light' })
    expect(await turnsTo('light')).toBe(light)

    // A Note picture drawn after the switch takes the new accent too.
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await page.keyboard.press('n')
    const frame = (await page.locator('#marks').boundingBox())!
    await page.mouse.click(frame.x + (150 / 200) * frame.width, frame.y + (50 / 200) * frame.height)
    await page.locator('#note-pop textarea').fill('Lighter')
    await page.keyboard.press('Enter')
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8')).notes.length).toBe(4)
    const [, , ...rgb] = await pngPixel(page, 'notes/note-4.png', 150, 42) // inside the pin, above its number
    expect(`rgb(${rgb.join(', ')})`).toBe(light)
    await app.close()
  } finally {
    cleanUp(root)
  }
})
