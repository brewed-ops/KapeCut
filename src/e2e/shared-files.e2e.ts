import { expect, test } from '@playwright/test'
import { launch } from './launch'
import { scenePixel as pixel } from './scene-pixel'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Two Scenes that draw with a helper from a script they share, as Claude's kc.js (#115).
const sceneHtml = (call: string) => `<canvas id="c" width="200" height="200"></canvas><script src="kc.js"></script><script>
  const g = document.getElementById('c').getContext('2d')
  window.TOTAL = 0.5
  window.renderAt = () => ${call}(g)
</script>`
const helper = (name: string, color: string) => `function ${name}(g) { g.fillStyle = '${color}'; g.fillRect(0, 0, 200, 200) }`

test('a Scene picks up an edited shared script without a reopen, and its Scene error clears once the script is fixed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html', 'b.html'] }))
  writeFileSync(join(dir, 'kc.js'), helper('paint', '#ff0000'))
  writeFileSync(join(dir, 'a.html'), sceneHtml('paint'))
  writeFileSync(join(dir, 'b.html'), sceneHtml('lockup'))
  const { app, page } = await launch({ project: dir })
  try {
    await expect.poll(() => pixel(page)).toEqual([255, 0, 0])
    const badge = page.locator('#scene-list li').nth(1).locator('.badge')
    await expect(badge).toBeVisible()
    await page.locator('#scene-list button').nth(1).click()
    await expect(page.locator('.error')).toContainText('lockup is not defined')
    await page.locator('#scene-list button').nth(0).click()
    await expect.poll(() => pixel(page)).toEqual([255, 0, 0])

    // The edit lands in kc.js only: no Scene page is saved.
    writeFileSync(join(dir, 'kc.js'), helper('paint', '#0000ff') + '\n' + helper('lockup', '#00ff00'))
    await expect.poll(() => pixel(page)).toEqual([0, 0, 255])
    await expect(badge).toBeHidden()
    await page.locator('#scene-list button').nth(1).click()
    await expect(page.locator('.error')).toHaveCount(0)
    await expect.poll(() => pixel(page)).toEqual([0, 255, 0])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
})
