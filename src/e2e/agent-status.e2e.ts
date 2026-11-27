import { expect, test } from '@playwright/test'
import { launch } from './launch'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { HANDSHAKE, OLD_HANDSHAKE } from '../renderer/agent/status'

// Best effort: Electron's helper processes can hold the profile or a watched folder a moment past close on Windows.
const cleanUp = (root: string) => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 })
  } catch {
    // left in %TEMP% for the OS to clear
  }
}

const handshake = (dir: string, file = HANDSHAKE) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), JSON.stringify({ version: 1, connected: new Date().toISOString() }))
}

// What the Agent writes to turn Set-up state into a one-Scene Project. The canvas follows ?scale= (ADR 0001), so it Exports.
const build = (dir: string) => {
  writeFileSync(
    join(dir, 'a.html'),
    `<canvas id="c"></canvas><script>
      const k = Number(new URLSearchParams(location.search).get('scale') ?? 1)
      const c = document.getElementById('c')
      c.width = c.height = 2 * Math.round((200 * k) / 2)
      window.TOTAL = 0.2
      window.renderAt = () => {}
    </script>`,
  )
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html'] }))
}

test("the app's own writes never reach the page as activity; the handshake turns the pill active, deleting it disconnects", async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = join(root, 'Built')
    mkdirSync(dir)
    build(dir)
    const { app, page } = await launch({ project: dir, userData: join(root, 'user') })
    const pill = page.getByRole('status').filter({ hasText: /^Agent / })
    await expect(pill).toBeVisible()
    await expect(pill).toHaveText('Agent not connected')

    // Every file event main forwards to the page: each one is Agent activity.
    await app.evaluate(({ BrowserWindow }) => {
      const g = globalThis as unknown as { forwarded: string[] }
      g.forwarded = []
      const wc = BrowserWindow.getAllWindows()[0].webContents
      const send = wc.send.bind(wc)
      const said = (args: unknown[]) => String(args[0]) + (args[1] ? ' (own)' : '')
      wc.send = (channel: string, ...args: unknown[]) => (channel === 'file-saved' && g.forwarded.push(said(args)), send(channel, ...args))
    })
    const forwarded = () => app.evaluate(() => (globalThis as unknown as { forwarded: string[] }).forwarded)

    // A point Note: the app writes notes.json and notes/note-1.png, each through a temp file.
    await page.keyboard.press('n')
    const r = (await page.locator('#marks').boundingBox())!
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
    await page.locator('#note-pop textarea').fill('Bigger')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(dir, 'notes', 'note-1.png')) && existsSync(join(dir, 'notes.json'))).toBe(true)
    // A file saved after them is reported after them (each waits out the same quiet time): it is the only one.
    writeFileSync(join(dir, 'later.txt'), 'x')
    await expect.poll(forwarded).toContain('later.txt')
    expect(await forwarded()).toEqual(['later.txt'])

    // An Export saved inside the Project: its scratch never reaches the page, its MP4 does (for Files) marked own.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
    }, join(dir, 'out.mp4'))
    await page.locator('#export').click()
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
    writeFileSync(join(dir, 'later-2.txt'), 'x')
    await expect.poll(forwarded).toContain('later-2.txt')
    expect(await forwarded()).toEqual(['later.txt', 'out.mp4 (own)', 'later-2.txt'])
    await expect(pill).toHaveText('Agent not connected') // activity alone never connects
    await expect(page.getByRole('button', { name: 'Connect your agent' })).toBeVisible()

    handshake(dir)
    await expect(pill).toHaveText('Agent active')
    const connect = page.getByRole('button', { name: 'Agent connected, copy again' })
    await expect(connect).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 }) // the CI screen is narrower: ", copy again" drops there (layout.e2e.ts)
    await expect(connect.locator('.label.on .via')).toBeVisible()
    await expect(connect.locator('svg.on')).toBeVisible() // the check, not the link (a narrow viewer shows only the icon)
    await expect(connect.locator('svg.off')).toBeHidden()
    // One colour: the plug's filled prongs match its amber outline.
    const plug = await connect.locator('svg.on').evaluate((svg) => [getComputedStyle(svg).stroke, getComputedStyle(svg.querySelector('[fill="currentColor"]')!).fill])
    expect(plug[1]).toBe(plug[0])
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await connect.click() // the same copy as before
    await expect(page.locator('#toast')).toBeVisible()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(`Project folder (open in KapeCut now): ${dir}\n`)

    rmSync(join(dir, HANDSHAKE))
    await expect(pill).toHaveText('Agent not connected')
    await expect(page.getByRole('button', { name: 'Connect your agent' })).toBeVisible()
    handshake(dir)
    await expect(pill).toHaveText('Agent active')
    renameSync(join(dir, '.kapecut'), join(dir, '.gone')) // the folder goes (Explorer's delete is a move): one event, '.kapecut'
    await expect(pill).toHaveText('Agent not connected')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('a Project connected before agent.json (claude.json) opens connected: starts idle, stays active through its own reload, and starts idle when opened again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = join(root, 'Lumen')
    mkdirSync(dir)
    handshake(dir, OLD_HANDSHAKE)
    const { app, page } = await launch({ project: dir, userData: join(root, 'user'), waitForExport: false })
    await expect(page.locator('.set-up')).toBeVisible()
    const pill = page.getByRole('status').filter({ hasText: /^Agent / })
    await expect(pill).toBeVisible()
    await expect(pill).toHaveText('Agent idle')
    await expect(page.getByRole('button', { name: 'Agent connected, copy again' })).toBeVisible()

    // Set-up state reloads into the editor when project.json lands: the activity survives that reload.
    build(dir)
    await expect(page.locator('#export')).toBeEnabled()
    await expect(pill).toHaveText('Agent active')

    // Opened again (Projects menu): a fresh open, idle until the first activity.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog
    }, dir)
    await page.locator('#projects summary').click()
    await page.locator('#open-folder').click()
    await expect.poll(() => page.locator('#agent-status').textContent().catch(() => null)).toBe('Agent idle')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('the pill cross-fades between not connected, active and idle, and its dot and label never move', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const dir = join(root, 'Built')
    mkdirSync(dir)
    build(dir)
    const { app, page } = await launch({ project: dir, userData: join(root, 'user') })
    await page.setViewportSize({ width: 1440, height: 900 }) // wide enough for the label
    const pill = page.locator('#agent-status')
    await expect(pill).toHaveAttribute('data-s', 'none')
    // The fonts load after the first paint and would widen the label under the test: wait for them.
    await page.evaluate(() => document.fonts.ready)
    // Where the dot and the visible label sit, and how much of each state's look shows (0 to 1).
    const read = () =>
      pill.evaluate((el) => {
        const box = (e: Element) => {
          const r = e.getBoundingClientRect()
          return [r.left, r.top, r.width, r.height].map(Math.round).join(',')
        }
        const dot = el.querySelector('i')!
        const faces = Object.fromEntries([...el.querySelectorAll<HTMLElement>('[data-face]')].map((f) => [f.dataset.face, Number(getComputedStyle(f).opacity)]))
        // Every face in the one place: the labels sit on top of each other, not side by side or stacked in rows.
        const stacked = new Set([...el.querySelectorAll('[data-face]')].map(box))
        return { at: [box(el), box(dot), ...stacked].join(' '), amber: Number(getComputedStyle(dot, '::after').opacity), faces }
      })
    const rest = await read()
    expect(rest.faces).toEqual({ none: 1, active: 0, idle: 0 })
    expect(rest.amber).toBe(0)
    expect(rest.at.split(' ')).toHaveLength(3) // pill, dot, one box for all three faces

    // A long --dur-s (a value no rule hard-codes) holds the cross-fade still enough to see both faces at once.
    await page.evaluate(() => document.documentElement.style.setProperty('--dur-s', '4s'))
    handshake(dir)
    await expect(pill).toHaveAttribute('data-s', 'active')
    // Polled: a read in the very frame of the change still sees the old values, before the fade has taken a step.
    const between = (v: number) => v > 0 && v < 1
    await expect.poll(async () => {
      const mid = await read()
      return mid.at === rest.at && [mid.faces.none, mid.faces.active, mid.amber].every(between)
    }).toBe(true)
    await page.evaluate(() => document.documentElement.style.removeProperty('--dur-s'))
    await expect.poll(async () => (await read()).faces).toEqual({ none: 0, active: 1, idle: 0 })
    expect((await read()).amber).toBe(1)
    expect((await read()).at).toBe(rest.at)

    // Idle: the dot goes dim again, nothing moves.
    await page.clock.install()
    await page.keyboard.press('Shift') // activity, timed on the installed clock
    await page.clock.fastForward(16 * 60_000)
    await expect(pill).toHaveAttribute('data-s', 'idle')
    await expect.poll(async () => (await read()).faces).toEqual({ none: 0, active: 0, idle: 1 })
    expect((await read()).amber).toBe(0)
    expect((await read()).at).toBe(rest.at)
    await expect(pill).toHaveText('Agent idle') // one label for screen readers, not all three
    await app.close()
  } finally {
    cleanUp(root)
  }
})
