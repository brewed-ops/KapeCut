import { expect, test } from '@playwright/test'
import { answerSave, launch } from './launch'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scenePixel } from './scene-pixel'

// One 1 s Scene at 1280x720, 30 fps: red before 0.5 s, green from there. From 0.7 s (past the 0.5 s thumbnail) a draw waits on
// window.openGate(), so the Export holds mid-file.
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 1280, h: 720 }, fps: 30, scenes: ['s.html'] }))
  writeFileSync(
    join(dir, 's.html'),
    `<canvas id="c" width="1280" height="720"></canvas><script>
      const k = Number(new URLSearchParams(location.search).get('scale') ?? 1)
      const c = document.getElementById('c')
      c.width = 1280 * k
      c.height = 720 * k
      const g = c.getContext('2d')
      let open; const gate = new Promise((r) => (open = r)); window.openGate = () => open()
      window.TOTAL = 1
      window.renderAt = async (t) => {
        if (t >= 0.7) { window.held = true; await gate }
        g.fillStyle = t < 0.5 ? '#ff0000' : '#00ff00'; g.fillRect(0, 0, c.width, c.height)
      }
    </script>`,
  )
  return dir
}

// 720p is the Design size (the viewer's own pages draw the Export), 1080p opens the Scene again at ?scale=.
for (const resolution of ['720p', '1080p']) {
  test(`while an Export at ${resolution} runs the viewer says the preview is paused and play is off; after it the playhead's Frame is back`, async () => {
    const dir = project()
    const out = join(mkdtempSync(join(tmpdir(), 'kapecut-out-')), 'out.mp4')
    const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
    await page.locator('#resolution').selectOption(resolution)
    const paused = page.locator('#export-paused')
    await expect(paused).toBeHidden()
    const held = () => page.evaluate(() => [...document.querySelectorAll('iframe')].some((f) => (f.contentWindow as any)?.held))
    await page.locator('#export').click()
    await expect.poll(held).toBe(true)

    await expect(paused).toBeVisible()
    await expect(paused).toContainText('Exporting')
    await expect(paused).toContainText('Preview is paused until it finishes')
    for (const id of ['#play', '#back', '#fwd', '#note', '#pen']) await expect(page.locator(id)).toBeDisabled()
    // The keys neither play nor step, nor reach a focused button: Space on Cancel would stop the Export.
    await page.locator('#export').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play')
    await expect(page.locator('#frame-no')).toHaveText('F 0')
    await expect(page.locator('#export-status')).toHaveText(/^Exporting /)
    // No new Note: the page on screen may hold an Export Frame, not the playhead's.
    await page.keyboard.press('n')
    await expect(page.locator('#notes-told')).toHaveText('Notes wait for the Export')
    await expect(page.locator('#note')).toHaveAttribute('aria-pressed', 'false')

    await page.evaluate(() => document.querySelectorAll('iframe').forEach((f) => (f.contentWindow as any)?.openGate?.()))
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
    await expect(paused).toBeHidden()
    for (const id of ['#play', '#back', '#fwd', '#note', '#pen']) await expect(page.locator(id)).toBeEnabled()
    // At the Design size the Export left its last Frame (green) in the shared page; the viewer draws the playhead's
    // Frame (red) again. At 1080p the Export drew its own pages, so there is nothing to redraw.
    if (resolution === '720p') await expect.poll(() => scenePixel(page)).toEqual([255, 0, 0])
    await app.close()
  })
}
