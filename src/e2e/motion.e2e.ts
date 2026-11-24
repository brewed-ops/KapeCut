import { expect, test, type Page } from '@playwright/test'
import { boxOf } from './box'
import { launch } from './launch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Motion foundation (#77): every button kind answers a press with the motion tokens, and reduced motion moves nothing.

// One of each kind: main amber, labelled, icon-only, small in-row, and the Projects menu's summary.
const KINDS = ['#export', '#play', '#zoom-fit', '#zoom-in', '#file-list li:not([draggable]) button', '#projects summary']
// These darken instead of shrinking: a full-width Scene row, a draggable Audio row's button, a window caption button.
const TONE_KINDS = ['#scene-list button', '#file-list li[draggable] button', '#win-min']

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-motion-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Motion', size: { w: 108, h: 192 }, fps: 30, scenes: ['a.html'], audio: [] }))
  writeFileSync(join(dir, 'a.html'), '<canvas id="c" width="108" height="192"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>')
  writeFileSync(join(dir, 'v.txt'), '') // a Files row with its small in-row copy button
  writeFileSync(join(dir, 'v.wav'), '') // an Audio row: draggable onto the Timeline
  return dir
}

async function withApp(run: (page: Page) => Promise<void>) {
  const dir = project()
  const { app, page } = await launch({ project: dir })
  try {
    await expect(page.locator('#file-list button').first()).toBeVisible()
    // A press here is only a probe: no button acts on it (Export would open a save dialog, copy would write the clipboard).
    await page.evaluate(() => document.addEventListener('click', (e) => (e.preventDefault(), e.stopImmediatePropagation()), true))
    await run(page)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
}

// Holds the mouse down on the button's centre while `check` runs, then lets go.
async function pressing(page: Page, selector: string, check: () => Promise<void>) {
  await expect(page.locator(selector).first()).toBeVisible()
  const box = await boxOf(page.locator(selector).first())
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    await check()
  } finally {
    await page.mouse.up()
  }
}

const style = (page: Page, selector: string, prop: 'scale' | 'filter' | 'transitionProperty' | 'transitionDuration') =>
  page.locator(selector).first().evaluate((el, prop) => getComputedStyle(el)[prop], prop)

test('every button kind answers a press: shrinks to --press-scale and springs back, or darkens to --press-tone', async () => {
  await withApp(async (page) => {
    // A value no rule hard-codes: a button that ignores the token stays at its own scale (#71's lesson).
    await page.evaluate(() => document.documentElement.style.setProperty('--press-scale', '0.5'))
    for (const kind of KINDS) {
      await pressing(page, kind, async () => {
        await expect.poll(() => style(page, kind, 'scale'), { message: kind }).toBe('0.5')
      })
      await expect.poll(() => style(page, kind, 'scale'), { message: `${kind} released` }).toBe('none')
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--press-tone', '0.5'))
    for (const kind of TONE_KINDS) {
      await pressing(page, kind, async () => {
        await expect.poll(() => style(page, kind, 'filter'), { message: kind }).toBe('brightness(0.5)')
        expect(await style(page, kind, 'scale'), kind).toBe('none')
      })
    }
  })
})

test('reduced motion: a press darkens every button kind and moves nothing', async () => {
  await withApp(async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const kind of [...KINDS, ...TONE_KINDS]) {
      await pressing(page, kind, async () => {
        await expect.poll(() => style(page, kind, 'filter'), { message: kind }).toBe('brightness(0.85)')
        expect(await style(page, kind, 'scale'), kind).toMatch(/^(1|none)$/)
        expect(await style(page, kind, 'transitionProperty'), kind).toBe('opacity')
        expect(await style(page, kind, 'transitionDuration'), kind).toBe('0s') // a disabled button's opacity change does not fade on the press spring
      })
      await expect.poll(() => style(page, kind, 'filter'), { message: `${kind} released` }).toBe('none')
    }
  })
})
