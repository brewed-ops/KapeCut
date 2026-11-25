import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch } from './launch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function oneScene() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html'] }))
  writeFileSync(join(dir, 'a.html'), `<canvas id="c" width="200" height="200"></canvas><script>
    window.TOTAL = 1
    window.renderAt = () => {}
  </script>`)
  return dir
}

// Best effort: Electron's helper processes can hold the profile a moment past close on Windows.
const cleanUp = (...dirs: string[]) => {
  for (const d of dirs)
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10 })
    } catch {
      // left in %TEMP% for the OS to clear
    }
}

const win = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, Menu }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const roles = (Menu.getApplicationMenu()?.items ?? []).flatMap((i) => i.submenu?.items.map((s) => s.role) ?? [])
    return {
      chrome: w.getBounds().height - w.getContentBounds().height, // native title bar + menu bar height
      maximized: w.isMaximized(),
      minimized: w.isMinimized(),
      roles,
    }
  })

test('frameless window: the header drags, its own buttons minimise, maximise and close, the menu keeps its shortcuts', async () => {
  const dir = oneScene()
  const { app, page } = await launch({ project: dir })
  try {
    // No native title bar or menu bar, but the menu is still set, so its accelerators work.
    const start = await win(app)
    expect(start.chrome).toBe(0)
    expect(start.roles).toEqual(expect.arrayContaining(['undo', 'copy', 'paste', 'reload', 'toggledevtools']))

    // The header drags the window; its controls still click.
    const region = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
    expect(await region('header')).toBe('drag')
    for (const sel of ['#projects', '#projects .menu', '#export-status', '#resolution', '#export', '#win-min', '#win-max', '#win-close'])
      expect(await region(sel), sel).toBe('no-drag')
    // An Export error in the header can be selected and copied.
    expect(await page.locator('#export-status').evaluate((el) => getComputedStyle(el).userSelect)).toBe('text')
    // While files from disk are dragged over the window the header takes drops too (a drag region is OS caption area).
    await page.evaluate(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['x'], 'x.txt'))
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer }))
    })
    expect(await region('header')).toBe('no-drag')
    await page.evaluate(() => window.dispatchEvent(new DragEvent('drop')))
    expect(await region('header')).toBe('drag')

    // Maximise / restore by keyboard: the label and the window follow. The one test that takes focus in a hidden run:
    // Windows activates a window it maximises, and the menu accelerators below need it. macOS hides these buttons for
    // its own traffic lights (the macOS test below).
    if (process.platform !== 'darwin') {
      const max = page.getByRole('button', { name: 'Maximise' })
      await max.focus()
      await page.keyboard.press('Enter')
      await expect.poll(async () => (await win(app)).maximized).toBe(true)
      await expect(page.getByRole('button', { name: 'Restore' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect.poll(async () => (await win(app)).maximized).toBe(false)
      await expect(max).toBeVisible()

      await page.getByRole('button', { name: 'Minimise' }).click()
      await expect.poll(async () => (await win(app)).minimized).toBe(true)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
    }

    // Ctrl+Z / Ctrl+C / Ctrl+V in the Note text box.
    await page.keyboard.press('n')
    const r = (await page.locator('#marks').boundingBox())!
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
    const box = page.locator('#note-pop textarea')
    await box.fill('Bigger')
    await box.press('ControlOrMeta+a')
    await box.press('ControlOrMeta+c')
    await box.press('ArrowRight') // collapses to the end; End does not move the caret on a Mac
    await box.press('ControlOrMeta+v')
    await expect(box).toHaveValue('BiggerBigger')
    await box.press('ControlOrMeta+z')
    await expect(box).toHaveValue('Bigger')

    // A key the page leaves alone reaches the hidden menu's accelerators: Ctrl+Shift+I opens devtools. Sent as an OS-like
    // input event: Playwright's keyboard (CDP) never reaches menu accelerators, framed window or not.
    // Accelerators need the window focused, which the restore above does not always give back (main: 3 in 15 missed).
    await page.locator('#note-cancel').click()
    if (process.platform === 'darwin') {
      // macOS keeps its menu bar on a frameless window, and its key equivalents go through the native menu, which
      // sendInputEvent never reaches: check the devtools item is there instead.
      const roles = await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()!.items.flatMap((i) => i.submenu?.items.map((s) => s.role) ?? []),
      )
      expect(roles).toContain('toggledevtools') // Electron reports roles in lower case
    } else {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true)
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0].webContents
        for (const type of ['keyDown', 'keyUp'] as const) w.sendInputEvent({ type, keyCode: 'I', modifiers: ['control', 'shift'] })
      })
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened())).toBe(true)
    }

    if (process.platform !== 'darwin') {
      const closed = app.waitForEvent('close')
      // Any press feedback on Close (#77) repaints it between mouse down and up, and Playwright's click then waits for an
      // input ack the closed window never sends (main 12/12 green, with press feedback ~1 in 3 red). Only that error is
      // allowed; the close event below is the proof.
      await page
        .getByRole('button', { name: 'Close' })
        .click()
        .catch((e: Error) => expect(e.message).toContain('has been closed'))
      await closed
    }
  } finally {
    await app.close() // a no-op once Close has closed it
    cleanUp(dir)
  }
})

test('macOS: the native window buttons sit on the header line, clear of the logo, and the app hides its own', async () => {
  test.skip(process.platform !== 'darwin', 'the traffic lights are macOS only')
  const dir = oneScene()
  const { app, page } = await launch({ project: dir })
  try {
    await expect(page.locator('.win-buttons')).toBeHidden()
    const lights = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition())
    const logo = (await page.locator('header h1').boundingBox())!
    const exportButton = (await page.locator('#export').boundingBox())!
    // Three 14 px lights 6 px apart from lights.x: the logo starts past them, with the header's gap to spare.
    expect(logo.x).toBeGreaterThanOrEqual(lights!.x + 3 * 14 + 2 * 6 + 14)
    // Their 14 px row is centred on the header's controls (Export is its tallest).
    expect(Math.abs(lights!.y + 7 - (exportButton.y + exportButton.height / 2))).toBeLessThanOrEqual(1.5)
  } finally {
    await app.close()
    cleanUp(dir)
  }
})

test('caption buttons: hover lifts them onto the panel step, a press darkens them, neither moves them', async () => {
  test.skip(process.platform === 'darwin', 'macOS shows its own traffic lights instead')
  const dir = oneScene()
  const { app, page } = await launch({ project: dir })
  try {
    // Values no rule hard-codes, so a button that ignores the tokens shows (#71's lesson). The blocker keeps the
    // presses from acting (Close would close the window).
    await page.evaluate(() => {
      const root = document.documentElement.style
      root.setProperty('--panel-2', 'rgb(1, 2, 3)')
      root.setProperty('--text', 'rgb(4, 5, 6)')
      root.setProperty('--press-tone', '0.5')
      document.addEventListener('click', (e) => (e.preventDefault(), e.stopImmediatePropagation()), true)
    })
    // The web fonts land late and shift the header by half a pixel under the test (CI, #80). Offline they never land.
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLLinkElement>('link[href*="fonts.googleapis"]')?.media), { timeout: 10_000 })
      .toBe('all')
      .catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    for (const name of ['Minimise', 'Maximise', 'Close']) {
      const button = page.getByRole('button', { name, exact: true })
      const look = () => button.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, filter: getComputedStyle(el).filter, scale: getComputedStyle(el).scale, box: JSON.stringify(el.getBoundingClientRect()) }))
      const box = (await button.boundingBox())!
      const at = await look()
      expect(at.bg, name).toBe('rgba(0, 0, 0, 0)')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(look, { message: name }).toMatchObject({ bg: 'rgb(1, 2, 3)', color: 'rgb(4, 5, 6)', filter: 'none', box: at.box })
      await page.mouse.down()
      await expect.poll(look, { message: `${name} pressed` }).toMatchObject({ filter: 'brightness(0.5)', scale: 'none', box: at.box })
      await page.mouse.up()
      await expect.poll(look, { message: `${name} released` }).toMatchObject({ filter: 'none' })
      await page.mouse.move(0, 400)
      await expect.poll(look, { message: `${name} left` }).toMatchObject({ bg: 'rgba(0, 0, 0, 0)' })
    }
  } finally {
    await app.close()
    cleanUp(dir)
  }
})
