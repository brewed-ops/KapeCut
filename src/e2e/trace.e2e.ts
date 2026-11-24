import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './launch'

// #142: what a failed test leaves behind. This test passes, so Playwright then deletes the files (preserveOutput).
test('closing a launch saves its trace, with the renderer console, and a screenshot to the test output folder', async () => {
  const { app, page } = await launch({ waitForExport: false })
  await page.evaluate(() => console.error('Could not save notes.json: HTTP 500'))
  await app.close()
  const zip = test.info().outputPath('launch-1-trace.zip')
  expect(existsSync(test.info().outputPath('launch-1.png'))).toBe(true)
  // bsdtar reads a zip: macOS's tar, and Windows' own, named by path since Git Bash puts its GNU tar first on PATH
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  expect(execFileSync(tar, ['-xOf', zip, 'trace.trace'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 << 20 })).toContain('Could not save notes.json: HTTP 500')
})
