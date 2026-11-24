import { expect, test, type ElectronApplication } from '@playwright/test'
import { launch } from './launch'
import { execFileSync } from 'node:child_process'

// PowerShell, for window $args[0] and point ($args[1], $args[2]): "<the top-level window a click there goes to>
// <is window a tool window, so out of Alt+Tab and the taskbar: 1 or 0>".
const WINDOW_AT_PS = `
Add-Type 'using System; using System.Runtime.InteropServices; public struct P { public int X; public int Y; } public static class W { [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(P p); [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f); [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i); }'
$p = New-Object P; $p.X = [int]$args[1]; $p.Y = [int]$args[2]
$tool = ([W]::GetWindowLongPtr([IntPtr][long]$args[0], -20).ToInt64() -band 0x80) -ne 0
"$([W]::GetAncestor([W]::WindowFromPoint($p), 2).ToInt64()) $([int]$tool)"` // -20 = GWL_EXSTYLE, 0x80 = WS_EX_TOOLWINDOW, 2 = GA_ROOT

const windowAt = (hwnd: string, x: number, y: number) =>
  execFileSync('powershell', ['-NoProfile', '-Command', `& { ${WINDOW_AT_PS} }`, hwnd, String(x), String(y)], { encoding: 'utf8', timeout: 30_000 }).trim()
const ignoreMouse = (app: ElectronApplication, ignore: boolean) =>
  app.evaluate(({ BrowserWindow }, ignore) => BrowserWindow.getAllWindows()[0].setIgnoreMouseEvents(ignore), ignore)

test('under e2e the window is see-through, click-through, out of Alt+Tab and never takes focus, and still paints', async () => {
  test.skip(process.env.KAPECUT_HIDDEN !== '1', 'windows shown on purpose (KAPECUT_HIDDEN=0)')
  test.skip(process.platform !== 'win32', 'opacity and the window checks are Windows only')
  const { app, page } = await launch({ waitForExport: false })
  try {
    await expect(page.getByRole('heading', { name: 'KapeCut', exact: true })).toBeVisible()
    const win = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const b = w.getBounds()
      w.setAlwaysOnTop(true) // on top of every window, or the click check would pass on whatever covers it
      return { focused: w.isFocused(), opacity: w.getOpacity(), hwnd: w.getNativeWindowHandle().readBigUInt64LE().toString(), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
    })
    expect({ focused: win.focused, opacity: win.opacity }).toEqual({ focused: false, opacity: 0 })
    // A click on the window's spot reaches what is under it; the same probe finds the window once it takes the mouse.
    expect(windowAt(win.hwnd, win.x, win.y)).toMatch(new RegExp(`^(?!${win.hwnd} )(?!0 )\\d+ 1$`))
    await ignoreMouse(app, false)
    expect(windowAt(win.hwnd, win.x, win.y)).toBe(`${win.hwnd} 1`)
    await ignoreMouse(app, true)
    // A window Windows counts as hidden can stop its frames: rAF must still tick and a capture must hold the UI, not a
    // blank fill, for motion, shots and Export.
    expect(await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))).toBe(true)
    const colours = await app.evaluate(async ({ BrowserWindow }) => {
      const bitmap = (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toBitmap()
      const seen = new Set<number>()
      for (let i = 0; i < bitmap.length; i += 4) seen.add(bitmap.readUInt32LE(i))
      return seen.size
    })
    expect(colours).toBeGreaterThan(50)
  } finally {
    await app.close()
  }
})
