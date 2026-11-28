import { expect, test } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './launch'

// Best effort: Electron's helper processes can hold the profile a moment past close on Windows (connect.e2e.ts).
const cleanUp = (root: string) => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 })
  } catch {
    // left in %TEMP% for the OS to clear
  }
}

const seenOnDisk = (userData: string) => {
  try {
    return JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).guideSeen
  } catch {
    return null // not written yet
  }
}

// ready-env marks the Guide seen for every other launch (KAPECUT_GUIDE_SEEN=1); '' gives a real first launch.
const firstLaunch = { KAPECUT_GUIDE_SEEN: '' }

test('the Guide opens by itself on the first launch only; the header button opens it again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-guide-'))
  const userData = join(root, 'user')
  try {
    let { app, page } = await launch({ userData, env: firstLaunch, waitForExport: false })
    const guide = () => page.locator('#guide-panel') // the page of the launch running now
    await expect(guide()).toBeVisible({ timeout: 15_000 })
    // Six steps, each naming the real button it points at.
    const steps = guide().locator('ol > li')
    await expect(steps).toHaveCount(6)
    for (const [i, label] of ['Open folder', 'Connect your agent', 'Scenes', 'Note', 'Copy Prompt', 'Export'].entries())
      await expect(steps.nth(i).locator('.button-name')).toHaveText(label)
    // Kept in settings.json before the app closes, so the relaunch below reads it.
    await expect.poll(() => seenOnDisk(userData), { timeout: 15_000 }).toBe(true)
    await page.locator('#guide-close').click()
    await expect(guide()).toBeHidden()
    await app.close()

    ;({ app, page } = await launch({ userData, env: firstLaunch, waitForExport: false }))
    // The Guide button is enabled once the launch has decided whether to open it.
    await expect(page.locator('#guide')).toBeEnabled({ timeout: 15_000 })
    await expect(guide()).toBeHidden()
    await page.locator('#guide').click()
    await expect(guide()).toBeVisible()
    // A short window: the steps scroll inside the panel, so the last one is reachable.
    await page.setViewportSize({ width: 1000, height: 420 })
    // The wheel, not scrollIntoView: script scrolls even an overflow: hidden box, a user cannot.
    await page.locator('#guide-panel h2').hover()
    await page.mouse.wheel(0, 2000)
    // Inside the panel, not cut off by its rounded frame (a flex body without min-height 0 never scrolls).
    const bottoms = () => page.locator('#guide-panel').evaluate((p) => [p.querySelector('li:last-child')!.getBoundingClientRect().bottom, p.getBoundingClientRect().bottom])
    await expect.poll(async () => { const [li, panel] = await bottoms(); return li <= panel }).toBe(true)
    // Step 1's drop on the window: the Guide steps aside so its result shows.
    await page.evaluate(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['x'], 'brief.txt'))
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
    })
    await expect(guide()).toBeHidden()
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('on a first launch the Guide waits for the Setup window to close, not opening over it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-guide-'))
  try {
    // An outdated skill lets the app in while the Setup window stays to say so, until Re-check (setup.e2e.ts).
    const home = join(root, 'home')
    cpSync(resolve('skills/kapecut'), join(home, '.claude', 'skills', 'kapecut'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'kapecut', 'SKILL.md'), 'my own edit')
    const { app, page } = await launch({ userData: join(root, 'user'), env: { ...firstLaunch, USERPROFILE: home, HOME: home }, waitForExport: false })
    try {
      const setup = page.getByRole('dialog', { name: /KapeCut needs/ })
      await expect(setup.locator('#setup-status')).toHaveText(/Update it, or Re-check to go on/)
      // Enabled once the launch has decided about the Guide: it stays shut while Setup shows.
      await expect(page.locator('#guide')).toBeEnabled({ timeout: 15_000 })
      await expect(page.locator('#guide-panel')).toBeHidden()
      await setup.getByRole('button', { name: 'Re-check' }).click()
      await expect(setup).toBeHidden()
      await expect(page.locator('#guide-panel')).toBeVisible()
    } finally {
      await app.close().catch(() => {})
    }
  } finally {
    cleanUp(root)
  }
})

test('the model warning sits on the empty editor and beside Connect your agent', async () => {
  const warning = 'Results depend on the AI model you use'
  let { app, page } = await launch({ waitForExport: false })
  await expect(page.locator('#stage .error .model-warning')).toHaveText(warning, { timeout: 15_000 })
  await expect(page.locator('#stage .error .model-warning')).toBeVisible()
  await app.close()

  const root = mkdtempSync(join(tmpdir(), 'kapecut-guide-'))
  try {
    const folder = join(root, 'Lumen')
    mkdirSync(folder)
    ;({ app, page } = await launch({ project: folder, waitForExport: false }))
    await expect(page.locator('#connect')).toBeVisible({ timeout: 15_000 })
    // A narrow viewer drops the line (app.css): CI's screen is smaller, so pin the window wide.
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('#connect + #connect-warning')).toBeVisible()
    await expect(page.locator('#connect-warning')).toHaveText(warning)
    await app.close()
  } finally {
    cleanUp(root)
  }
})
