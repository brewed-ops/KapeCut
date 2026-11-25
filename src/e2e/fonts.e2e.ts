import { expect, test } from '@playwright/test'
import { launch } from './launch'

// The editor's fonts ship inside the app: opening it asks no font host for anything, so none sees the user's IP, and
// offline it looks the same as online.
test('the editor loads its fonts from the app, never from a font host on the internet', async () => {
  const { app, page } = await launch({
    waitForExport: false,
    // Before the window loads, every web request the app makes is recorded.
    onLaunch: (app) =>
      app.evaluate(({ session }) => {
        const web: string[] = []
        Object.assign(globalThis, { web })
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, done) => (web.push(d.url), done({})))
      }),
  })
  try {
    // Each face the look uses loads (a missing file would leave document.fonts.load empty, not throw).
    for (const font of ['22px "Archivo Black"', '400 16px Geist', '600 16px Geist', '500 12px "Geist Mono"'])
      expect(await page.evaluate((f) => document.fonts.load(f).then((faces) => faces.length), font), font).toBeGreaterThan(0)
    const web = await app.evaluate(() => (globalThis as unknown as { web: string[] }).web)
    expect(web.filter((url) => /google|gstatic/i.test(new URL(url).hostname))).toEqual([])
  } finally {
    await app.close()
  }
})
