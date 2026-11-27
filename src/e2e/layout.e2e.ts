import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { HANDSHAKE } from '../renderer/agent/status'

// The editor grid of Kenneth's sketch (docs/design/sketch-2026-11-23.png, #66): left column header to bottom, Timeline
// right of it, the viewer window filling the middle column with the picture centred in it.

// A one-Scene Project at Design size w x h. No Agent handshake unless a test writes one (Connect shows its amber main face).
function project(w: number, h: number) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-layout-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Layout', size: { w, h }, fps: 30, scenes: ['a.html'] }))
  writeFileSync(join(dir, 'a.html'), `<canvas id="c" width="${w}" height="${h}"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>`)
  return dir
}

const near = (got: number, want: number, slack = 1) => expect(Math.abs(got - want), `${got} vs ${want}`).toBeLessThanOrEqual(slack)
const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).boundingBox()
  if (!b) throw new Error(`${selector} is not on screen`)
  return b
}

async function expectSketchGrid(page: Page) {
  const [side, view, win, stage, timeline, notes, bar, transport] = await Promise.all(
    ['.side', '#view', '#view > .window', '#stage', '#timeline', '.notes', '#view .titlebar', '#transport'].map((s) => box(page, s)),
  )
  // Left column from the top of the viewer row down to the Timeline's bottom.
  near(side.y, view.y)
  near(side.y + side.height, timeline.y + timeline.height)
  // Timeline beside the left column, under the viewer and Notes.
  expect(timeline.x).toBeGreaterThan(side.x + side.width)
  near(timeline.x, view.x)
  near(timeline.x + timeline.width, notes.x + notes.width)
  // The viewer window fills its cell; the picture is centred in it and inside it.
  near(win.x, view.x)
  near(win.width, view.width)
  near(win.height, view.height)
  near(stage.x + stage.width / 2, win.x + win.width / 2)
  expect(stage.x).toBeGreaterThanOrEqual(win.x)
  expect(stage.y + stage.height).toBeLessThanOrEqual(win.y + win.height)
  // As big as the room between the title bar and the transport allows, on one axis.
  const room = { w: win.width - 3 /* .window frame, 1.5px each side */, h: transport.y - (bar.y + bar.height) }
  near(Math.max(stage.width / room.w, stage.height / room.h), 1, 0.01)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

for (const [label, w, h] of [['9:16', 108, 192], ['16:9', 192, 108]] as const) {
  test(`${label}: left column runs header to bottom, Timeline beside it, the viewer window fills the middle with the picture centred`, async () => {
    const dir = project(w, h)
    const { app, page } = await launch({ project: dir })
    try {
      // The default window, and the sketch's proportions (docs/design/sketch-2026-11-23.png).
      for (const size of [{ width: 1280, height: 800 }, { width: 1903, height: 1015 }]) {
        await page.setViewportSize(size)
        await expect(() => expectSketchGrid(page)).toPass({ timeout: 5000 }) // fit() runs on the resize
      }
      // The picture under the marks is the Scene page, at its aspect ratio.
      const [marks, frame] = await Promise.all([box(page, '#marks'), box(page, '#stage iframe.current')])
      for (const k of ['x', 'y', 'width', 'height'] as const) near(frame[k], marks[k])
      near(marks.width / marks.height, w / h, 0.02)

      // A click at a known picture point lands on that Design-size point, in the wide window.
      await page.keyboard.press('n')
      await page.mouse.click(marks.x + marks.width * 0.25, marks.y + marks.height * 0.75)
      await page.locator('#note-pop textarea').fill('Here')
      await page.keyboard.press('Enter')
      await expect.poll(() => {
        try {
          return JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8')).notes[0].point
        } catch {
          return null
        }
      }).toEqual({ x: Math.round(w * 0.25), y: Math.round(h * 0.75) })
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })
}

// CI fonts render wider than local (#55), so this runs on every CI run at the smallest window the app allows.
for (const connected of [false, true]) {
  test(`smallest window, Agent ${connected ? 'connected' : 'not connected'}: no header, title-bar or panel-foot control overflows, wraps or leaves the window`, async () => {
    const dir = project(108, 192)
    if (connected) {
      mkdirSync(dirname(join(dir, HANDSHAKE)), { recursive: true })
      writeFileSync(join(dir, HANDSHAKE), JSON.stringify({ version: 1, connected: new Date().toISOString() }))
    }
    const { app, page } = await launch({ project: dir })
    try {
      // Asks for 1x1 and gets the window's minimum size: the narrowest a user can make it, not only its page.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1, 1))
      await expect.poll(() => page.evaluate(() => innerWidth <= 1000 && innerHeight <= 700)).toBe(true)
      await expect(page.locator('#connect')).toBeVisible() // the Agent check has reported: the widest header and title bar
      const bars = ['header', '#files .titlebar', '.scenes .titlebar', '.settings', '#view .titlebar', '.notes .titlebar', '#notes-foot', '#timeline .titlebar']
      await expect(async () => {
        const bad = await page.evaluate((bars) => {
          const found: string[] = []
          for (const selector of bars) {
            const bar = document.querySelector(selector)
            if (!(bar instanceof HTMLElement) || !bar.checkVisibility()) return [`${selector} is not on screen`]
            const outer = bar.getBoundingClientRect()
            for (const el of [bar, ...bar.querySelectorAll('*')]) {
              if (!(el instanceof HTMLElement) || !el.checkVisibility()) continue
              const r = el.getBoundingClientRect()
              if (r.width <= 1 && r.height <= 1) continue // a screen-reader-only label (1px, clipped)
              const name = `${el.tagName.toLowerCase()}#${el.id}.${el.className} "${el.textContent?.trim().slice(0, 30)}"`
              // A label styled to give way with an ellipsis (a long Scene name) may truncate.
              if (el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis') found.push(`${name} scrolls: ${el.scrollWidth} > ${el.clientWidth}`)
              if (r.left < 0 || r.right > innerWidth) found.push(`${name} leaves the window: ${r.left}..${r.right} of ${innerWidth}`)
              if (r.left < outer.left - 0.5 || r.right > outer.right + 0.5) found.push(`${name} leaves its bar: ${r.left}..${r.right} of ${outer.left}..${outer.right}`)
              // A label squeezed onto a second line grows its bar instead of overflowing it.
              for (const text of el.childNodes) {
                if (text.nodeType !== Node.TEXT_NODE || !text.textContent?.trim()) continue
                const range = document.createRange()
                range.selectNodeContents(text)
                const lines = new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
                if (lines > 1) found.push(`${name} wraps onto ${lines} lines`)
              }
            }
          }
          return found
        }, bars)
        expect(bad).toEqual([])
      }).toPass({ timeout: 5000 }) // fit() runs on the resize
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })
}

test('1280 wide, 9:16: Connect shows its full label; Settings is a card at the foot of the left column; lists scroll in the app look', async () => {
  const dir = project(108, 192)
  const { app, page } = await launch({ project: dir })
  try {
    // The window never shrinks below the smallest size the layout is tested at (1000x700), where the transport would clip.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize())).toEqual([1000, 700])
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('#connect .label.off')).toBeVisible()
    await expect(page.locator('#connect .label.off')).toHaveText('Connect your agent')
    const [connect, tools] = await Promise.all([box(page, '#connect'), box(page, '#note-tools')])
    expect(connect.x + connect.width).toBeLessThan(tools.x)

    // A framed, rounded card whose bottom is the left column's bottom.
    const [side, card] = await Promise.all([box(page, '.side'), box(page, '#settings')])
    near(card.x, side.x)
    near(card.width, side.width)
    near(card.y + card.height, side.y + side.height)
    // In the window style: the Scenes window's frame and radius.
    const look = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const css = getComputedStyle(el)
        return { border: css.borderTopWidth, color: css.borderTopColor, radius: css.borderTopLeftRadius }
      })
    expect(await look('#settings')).toEqual(await look('.scenes'))
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Thin scrollbars in the frame colour, not the white platform default.
    for (const list of ['#scene-list', '#file-list', '#note-list']) {
      const bar = await page.locator(list).evaluate((el) => {
        const css = getComputedStyle(el)
        return { width: css.scrollbarWidth, colored: css.scrollbarColor !== 'auto' }
      })
      expect(bar, list).toMatchObject({ width: 'thin', colored: true })
    }
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
})
