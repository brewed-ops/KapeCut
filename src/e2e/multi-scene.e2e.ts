import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'
import { scenePixel as pixel } from './scene-pixel'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A Scene that fills its canvas with one colour for `total` seconds. Small canvas keeps the test fast.
const sceneHtml = (color: string, total: number | null = 0.5, size = 200) => `<canvas id="c" width="${size}" height="200"></canvas><script>
  const g = document.getElementById('c').getContext('2d')
  ${total === null ? '' : `window.TOTAL = ${total}`}
  window.renderAt = () => { g.fillStyle = '${color}'; g.fillRect(0, 0, ${size}, 200) }
</script>`

const RED = [255, 0, 0]
const GREEN = [0, 255, 0]
const BLUE = [0, 0, 255]

function threeScenes() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeProject(dir, ['a.html', 'b.html', 'c.html'])
  writeFileSync(join(dir, 'a.html'), sceneHtml('#ff0000'))
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00'))
  writeFileSync(join(dir, 'c.html'), sceneHtml('#0000ff'))
  return dir
}
const writeProject = (dir: string, scenes: string[]) =>
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes }))

// Puts the transport on whole-video Frame f (scrub to it, as the user drags the slider).
const seekFrame = (page: Page, f: number) =>
  page.locator('#scrub').evaluate((el: HTMLInputElement, t) => {
    el.value = String(t)
    el.dispatchEvent(new Event('input'))
  }, f / 30)

async function expectAt(page: Page, frame: number, scene: string, color: number[]) {
  await expect(page.locator('#frame-no')).toHaveText(`F ${frame}`)
  await expect(page.locator('#scene-name')).toHaveText(scene)
  await expect.poll(() => pixel(page)).toEqual(color)
}

test('3 Scenes play and step across both cuts in Project time, drawing the right Scene', async () => {
  const { app, page } = await launch({ project: threeScenes() })
  await expectAt(page, 0, 'a.html', RED)
  // The viewer shows the canvas alone, as Export does: no page margin, no scrollbars (#29).
  expect(
    await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('iframe.current')!.contentDocument!
      const r = doc.querySelector('canvas')!.getBoundingClientRect()
      const root = doc.documentElement
      return [r.left, r.top, root.scrollWidth <= root.clientWidth, root.scrollHeight <= root.clientHeight]
    }),
  ).toEqual([0, 0, true, true])

  // Each Scene is 0.5 s = 15 Frames: cuts at Frames 15 and 30.
  await seekFrame(page, 14)
  await expectAt(page, 14, 'a.html', RED)
  await page.keyboard.press('ArrowRight')
  await expectAt(page, 15, 'b.html', GREEN)
  await expect(page.locator('#time')).toHaveText('0.50s')
  await page.keyboard.press('ArrowLeft')
  await expectAt(page, 14, 'a.html', RED)
  await seekFrame(page, 29)
  await page.keyboard.press('ArrowRight')
  await expectAt(page, 30, 'c.html', BLUE)
  await page.keyboard.press('ArrowLeft')
  await expectAt(page, 29, 'b.html', GREEN)

  // Playback: sample the screen every animation frame; never a blank or wrong-order Frame.
  await seekFrame(page, 0)
  const seen = await page.evaluate(
    () =>
      new Promise<string[]>((done) => {
        const out: string[] = []
        const sample = () => {
          const c = document.querySelector<HTMLIFrameElement>('iframe.current')!.contentDocument!.querySelector('canvas')!
          const p = c.getContext('2d')!.getImageData(0, 0, 1, 1).data.join(',')
          if (out.at(-1) !== p) out.push(p)
          if (document.getElementById('play')!.getAttribute('aria-label') === 'Play' && out.length > 1) return done(out)
          requestAnimationFrame(sample)
        }
        document.getElementById('play')!.click()
        requestAnimationFrame(sample)
      }),
  )
  expect(seen).toEqual(['255,0,0,255', '0,255,0,255', '0,0,255,255'])
  await expectAt(page, 44, 'c.html', BLUE)
  await app.close()
})

test('a save reloads only its Scene, project.json edits re-order live, a broken Scene errors alone', async () => {
  const dir = threeScenes()
  const { app, page } = await launch({ project: dir })
  await page.evaluate(() => {
    ;(window as any).loads = {}
    for (const f of document.querySelectorAll('iframe'))
      f.addEventListener('load', () => ((window as any).loads[f.dataset.scene!] = ((window as any).loads[f.dataset.scene!] ?? 0) + 1))
  })
  await seekFrame(page, 20)
  await expectAt(page, 20, 'b.html', GREEN)

  writeFileSync(join(dir, 'b.html'), sceneHtml('#ffff00'))
  await expect.poll(() => pixel(page)).toEqual([255, 255, 0])
  await expect(page.locator('#frame-no')).toHaveText('F 20') // same Project time
  expect(await page.evaluate(() => (window as any).loads)).toEqual({ 'b.html': 1 })

  // Re-order and drop a Scene without a restart: c, a.
  writeProject(dir, ['c.html', 'a.html'])
  await expect(page.locator('#frame-no')).toHaveText('F 20')
  await expectAt(page, 20, 'a.html', RED)
  await seekFrame(page, 0)
  await expectAt(page, 0, 'c.html', BLUE)
  expect(await page.locator('iframe').count()).toBe(2)

  // Add a Scene back, then break it two ways: no TOTAL, wrong canvas size.
  writeProject(dir, ['c.html', 'a.html', 'b.html'])
  // Frame 30 exists only once the new Scene order lands.
  await expect.poll(async () => (await seekFrame(page, 30), page.locator('#frame-no').textContent())).toBe('F 30')
  await expectAt(page, 30, 'b.html', [255, 255, 0])
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00', null))
  await expect(page.locator('.error')).toContainText('window.TOTAL')
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00', 0.5, 300))
  await expect(page.locator('.error')).toContainText('Scene canvas is 300x200')
  await seekFrame(page, 15)
  await expectAt(page, 15, 'a.html', RED) // the other Scenes stay playable
  await expect(page.locator('.error')).toHaveCount(0)
  await app.close()
})

// Centre pixel of each Scene list thumbnail, in list order.
const thumbs = (page: Page) =>
  page.locator('#scene-list img').evaluateAll((imgs: HTMLImageElement[]) =>
    imgs.map((img) => {
      const c = document.createElement('canvas')
      ;[c.width, c.height] = [img.naturalWidth, img.naturalHeight]
      if (!c.width) return null
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      return Array.from(g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3))
    }),
  )

test('the Scene list shows every Scene, seeks on click, follows playback and refreshes on save', async () => {
  const dir = threeScenes()
  const { app, page } = await launch({ project: dir })
  const items = page.locator('#scene-list button')
  await expect(items).toHaveText([/a\.html.*0\.50s · 15 F/, /b\.html.*0\.50s · 15 F/, /c\.html.*0\.50s · 15 F/])
  await expect.poll(() => thumbs(page)).toEqual([RED, GREEN, BLUE])
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'true')

  // Clicking the third Scene draws its first Frame.
  await page.getByRole('button', { name: /c\.html/ }).click()
  await expectAt(page, 30, 'c.html', BLUE)
  await expect(items.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('#scene-list [aria-current]')).toHaveCount(1)

  // The highlight follows a seek, and the list is keyboard reachable.
  await seekFrame(page, 20)
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true')
  await items.nth(0).focus()
  await page.keyboard.press('Enter')
  await expectAt(page, 0, 'a.html', RED)

  // A save refreshes that Scene's thumbnail and length; project.json re-orders the list.
  writeFileSync(join(dir, 'b.html'), sceneHtml('#ffff00', 1))
  await expect(items.nth(1)).toHaveText(/b\.html.*1\.00s · 30 F/)
  await expect.poll(() => thumbs(page)).toEqual([RED, [255, 255, 0], BLUE])
  // A broken Scene keeps its length, gets an error badge and drops its now-stale thumbnail.
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00', 1, 300))
  await expect(items.nth(1)).toHaveText(/b\.html.*1\.00s · 30 F/)
  await expect(items.nth(1).locator('.badge')).toBeVisible()
  await expect(items.nth(0).locator('.badge')).toBeHidden()
  const heights = await items.evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height))
  expect(new Set(heights).size, `item heights ${heights}`).toBe(1) // the badge fits beside the thumbnail
  await expect.poll(() => thumbs(page)).toEqual([RED, null, BLUE])
  writeProject(dir, ['c.html', 'a.html'])
  await expect(items).toHaveText([/c\.html/, /a\.html/])
  await app.close()
})

test('a long Scene list scrolls inside its window; the viewer and transport stay on screen', async () => {
  const dir = threeScenes()
  writeProject(dir, Array.from({ length: 12 }, (_, i) => 'abc'[i % 3] + '.html'))
  const { app, page } = await launch({ project: dir })
  await expect(page.locator('#scene-list button')).toHaveCount(12)
  const list = await page.locator('#scene-list').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(list.scroll).toBeGreaterThan(list.client)
  for (const el of ['#transport', '.scenes', '#settings']) {
    const bottom = await page.locator(el).evaluate((e) => e.getBoundingClientRect().bottom)
    expect(bottom, el).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
  }
  await app.close()
})

// Left edge, width and whether a thumbnail shows, for each Timeline Scene strip in order.
const strips = (page: Page) =>
  page.locator('#strips > div').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left, w: r.width, thumb: getComputedStyle(el).backgroundImage.startsWith('url(') }
    }),
  )
const trackWidth = (page: Page) => page.locator('#tl-track').evaluate((el) => el.getBoundingClientRect().width)

test('the Timeline lays Scenes out by length, seeks on click and drag, zooms and follows playback', async () => {
  const dir = threeScenes()
  // b.html draws its Scene time into the blue channel, so the pixel says which Scene time was drawn.
  writeFileSync(
    join(dir, 'b.html'),
    `<canvas id="c" width="200" height="200"></canvas><script>
      const g = document.getElementById('c').getContext('2d')
      window.TOTAL = 0.5
      window.renderAt = (t) => { g.fillStyle = 'rgb(0,255,' + Math.round(t * 200) + ')'; g.fillRect(0, 0, 200, 200) }
    </script>`,
  )
  const { app, page } = await launch({ project: dir })
  await expect(page.locator('#timeline')).toBeVisible()
  await expect.poll(async () => (await strips(page)).map((s) => s.thumb)).toEqual([true, true, true])
  const [a, b, c] = await strips(page)
  expect(Math.abs(a.w - b.w)).toBeLessThan(2)
  expect(Math.abs(b.w - c.w)).toBeLessThan(2)
  await expect(page.locator('#ruler span').first()).toHaveText('0s')

  // Clicking inside Scene 2 draws Scene 2 at the matching Scene time.
  const y = (await page.locator('#strips').boundingBox())!.y + 20
  await page.mouse.click(b.x + b.w / 2, y)
  await expect(page.locator('#scene-name')).toHaveText('b.html')
  const f = Number((await page.locator('#frame-no').textContent())!.slice(2))
  expect(f).toBeGreaterThanOrEqual(20)
  expect(f).toBeLessThanOrEqual(25)
  await expect.poll(() => pixel(page)).toEqual([0, 255, Math.round((f / 30 - 0.5) * 200)])
  await expect(page.locator('#strips > [aria-current]')).toHaveCount(1)
  await expect(page.locator('#strips > div').nth(1)).toHaveAttribute('aria-current', 'true')

  // Dragging the playhead from Scene 1 to Scene 3 scrubs there.
  await page.mouse.move(a.x + 5, y)
  await page.mouse.down()
  await page.mouse.move(b.x + 5, y)
  await page.mouse.move(c.x + c.w / 2, y)
  await expect(page.locator('#scene-name')).toHaveText('c.html')
  await page.mouse.up()
  await expectAt(page, Number((await page.locator('#frame-no').textContent())!.slice(2)), 'c.html', BLUE)

  // Zoom: buttons, Ctrl + wheel and the - key; Fit goes back.
  const fit = await trackWidth(page)
  const fitTicks = await page.locator('#ruler span').allTextContents()
  await page.locator('#zoom-in').click()
  await expect.poll(() => trackWidth(page)).toBeGreaterThan(fit * 1.2)
  await expect.poll(() => page.locator('#ruler span').allTextContents()).not.toEqual(fitTicks)
  const zoomedIn = await trackWidth(page)
  await page.locator('#zoom-out').click()
  await expect.poll(() => trackWidth(page)).toBeLessThan(zoomedIn)
  await page.mouse.move(a.x + 5, y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(() => trackWidth(page)).toBeGreaterThan(fit * 1.2)
  await page.keyboard.press('Minus')
  await page.keyboard.press('Minus')
  await expect.poll(() => trackWidth(page)).toBeCloseTo(fit, 0)
  await page.locator('#zoom-in').click()
  await page.locator('#zoom-fit').click()
  await expect.poll(() => trackWidth(page)).toBeCloseTo(fit, 0)

  // While playing zoomed in, the Timeline scrolls to keep the playhead in view.
  await page.locator('#zoom-in').click()
  await page.locator('#zoom-in').click()
  await expect.poll(() => trackWidth(page)).toBeGreaterThan(fit * 1.4)
  // A drag past the right edge scrolls the Timeline and seeks into time that was off screen.
  const scrollBox = (await page.locator('#tl-scroll').boundingBox())!
  await page.locator('#tl-scroll').evaluate((el) => (el.scrollLeft = 0))
  await page.mouse.move(scrollBox.x + 30, y)
  await page.mouse.down()
  // 1200 px past the edge: enough to reach c.html on CI's small screen too, where the Timeline sits beside the left
  // column (#66) and the track is zoomed to about 3x its width.
  for (let i = 1; i <= 30; i++) await page.mouse.move(scrollBox.x + scrollBox.width + 40 * i, y)
  const held = (await page.locator('#playhead').boundingBox())!
  expect(held.x + held.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width) // waits at the edge, on screen
  await page.mouse.up()
  await expect.poll(() => page.locator('#tl-scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(page.locator('#scene-name')).toHaveText('c.html')

  // A seek from elsewhere (the Scene list) also brings the playhead into view.
  await page.locator('#tl-scroll').evaluate((el) => (el.scrollLeft = 0))
  await page.getByRole('button', { name: /c\.html/ }).click()
  await expect.poll(() => page.locator('#tl-scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await seekFrame(page, 0)
  await expect.poll(() => page.locator('#tl-scroll').evaluate((el) => el.scrollLeft)).toBe(0) // the seek scrolled back
  await page.locator('#play').click()
  await expect.poll(() => page.locator('#tl-scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play') // played to the end
  const [ph, sc] = [await page.locator('#playhead').boundingBox(), await page.locator('#tl-scroll').boundingBox()]
  expect(ph!.x).toBeGreaterThanOrEqual(sc!.x)
  expect(ph!.x + ph!.width).toBeLessThanOrEqual(sc!.x + sc!.width)

  // A Scene that gets longer on save gets a longer strip.
  await page.locator('#zoom-fit').click()
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00', 1))
  await expect.poll(async () => {
    const [sa, sb] = await strips(page)
    return Math.round((sb.w / sa.w) * 10) / 10
  }).toBe(2)

  // A broken Scene's strip keeps its length and says so.
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00', 1, 300))
  await expect(page.locator('#strips > div').nth(1).locator('.badge')).toBeVisible()
  await expect(page.locator('#strips .badge')).toHaveCount(1)
  const [sa, sb] = await strips(page)
  expect(Math.round((sb.w / sa.w) * 10) / 10).toBe(2) // still its 1 s length
  // A save leaves the user's scroll alone: the playhead does not move, so neither does the view.
  await page.locator('#zoom-in').click()
  await page.locator('#tl-scroll').evaluate((el) => (el.scrollLeft = 0))
  writeFileSync(join(dir, 'c.html'), sceneHtml('#0000ff', 0.5))
  await page.waitForTimeout(1000)
  expect(await page.locator('#tl-scroll').evaluate((el) => el.scrollLeft)).toBe(0)
  await app.close()
})
