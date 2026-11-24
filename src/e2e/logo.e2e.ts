import { expect, test } from '@playwright/test'
import { launch } from './launch'
import { execFileSync } from 'node:child_process'

// PowerShell: the window's own icons (WM_GETICON), read through Windows itself, as
// "<amber pixels in the big icon> <small icon width> <the system's small icon size>". Electron's default icon has no
// amber; a PNG reaches Windows as 256 px for the small icon too, the .ico as its image at the system's size (16 at
// 100% scaling, 20 at 125%).
const READ_TASKBAR_ICON_PS = `
Add-Type -AssemblyName System.Drawing
Add-Type 'using System; using System.Runtime.InteropServices; public static class W { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i); }'
$hwnd = [IntPtr][long]$args[0]
$big = [W]::SendMessage($hwnd, 0x7F, [IntPtr]1, [IntPtr]0)
$small = [W]::SendMessage($hwnd, 0x7F, [IntPtr]0, [IntPtr]0)
if ($big -eq [IntPtr]::Zero -or $small -eq [IntPtr]::Zero) { '0 0 0'; exit }
$bmp = [System.Drawing.Icon]::FromHandle($big).ToBitmap()
$n = 0
for ($x = 0; $x -lt $bmp.Width; $x++) { for ($y = 0; $y -lt $bmp.Height; $y++) {
  $p = $bmp.GetPixel($x, $y)
  if ($p.A -gt 200 -and $p.R -gt 200 -and $p.G -gt 130 -and $p.G -lt 190 -and $p.B -lt 90) { $n++ }
} }
"$n $([System.Drawing.Icon]::FromHandle($small).ToBitmap().Width) $([W]::GetSystemMetrics(49))"` // 49 = SM_CXSMICON

test('the header shows the KapeCut mark beside the wordmark, and the window icon is the mark', async () => {
  const { app, page } = await launch({ waitForExport: false })
  try {
    const logo = page.getByRole('heading', { name: 'KapeCut', exact: true })
    await expect(logo).toBeVisible()
    await expect(logo.locator('svg')).toBeVisible()

    test.skip(process.platform !== 'win32', 'reads the taskbar icon through user32')
    const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString())
    const [amber, smallWidth, systemSmall] = execFileSync('powershell', ['-NoProfile', '-Command', `& { ${READ_TASKBAR_ICON_PS} }`, hwnd], { encoding: 'utf8', timeout: 30_000 })
      .trim()
      .split(' ')
      .map(Number)
    expect(amber).toBeGreaterThan(50)
    expect(smallWidth).toBe(systemSmall) // the .ico's image at the system's small size, not the 256 shrunk at draw time
  } finally {
    await app.close()
  }
})
