import { expect, test, type Page } from '@playwright/test'
import { answerSave, launch } from './launch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Apple design pass on Files, the Scene list, the drop overlay and Export (#81). Every check sets the motion token to a
// value no rule hard-codes (7 s) first, so a rule that ignores the token fails (#71's lesson), and the long run keeps
// the transition in flight while it is read.

// Three 320x240 Scenes; the middle one holds its Frame at t = 1 (load draws 0, the thumbnail 1.5) until the test lets it go.
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-motion81-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Motion', size: { w: 320, h: 240 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html'] }))
  const scene = (gate: boolean) => `<canvas id="c"></canvas><script>
    const k = Number(new URLSearchParams(location.search).get('scale') ?? 1)
    const c = document.getElementById('c')
    c.width = 2 * Math.round((320 * k) / 2)
    c.height = 2 * Math.round((240 * k) / 2)
    const g = c.getContext('2d')
    window.TOTAL = ${gate ? 3 : 0.5}
    let open; const gate = new Promise((r) => (open = r)); window.openGate = () => open()
    window.renderAt = async (t) => { if (${gate} && t === 1) { window.held = true; await gate } g.fillStyle = '#336699'; g.fillRect(0, 0, c.width, c.height) }
  </script>`
  writeFileSync(join(dir, 'a.html'), scene(false))
  writeFileSync(join(dir, 'b.html'), scene(true))
  writeFileSync(join(dir, 'c.html'), scene(false))
  writeFileSync(join(dir, 'notes.txt'), 'a Files row')
  return dir
}

async function withApp(run: (page: Page, dir: string) => Promise<void>) {
  const dir = project()
  // Outside the Project folder: the Export's scratch files would otherwise arrive as saves.
  const outDir = mkdtempSync(join(tmpdir(), 'kapecut-out-'))
  const out = join(outDir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  try {
    await expect(page.locator('#file-list li[data-file="notes.txt"]')).toBeVisible()
    await run(page, dir)
  } finally {
    await app.close()
    for (const d of [dir, outDir]) rmSync(d, { recursive: true, force: true, maxRetries: 10 })
  }
}

const token = (page: Page, name: string, value: string) => page.evaluate(([n, v]) => document.documentElement.style.setProperty(n, v), [name, value])
// The CSS transitions running on `selector` (or its ::before), as property names.
const running = (page: Page, selector: string, pseudo = '') =>
  page.evaluate(
    ([s, p]) =>
      document
        .getAnimations()
        .filter((a) => {
          const e = a.effect as KeyframeEffect
          return e.target === document.querySelector(s) && (e.pseudoElement ?? '') === p && a.playState === 'running'
        })
        .map((a) => (a as CSSTransition).transitionProperty)
        .sort(),
    [selector, pseudo],
  )
const finish = (page: Page) => page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
// A drag of files from disk over the window: only the type matters to the overlay.
const drag = (page: Page, type: 'dragover' | 'dragleave' | 'drop') =>
  page.evaluate((type) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'x.txt'))
    document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, type)

test('the current Scene highlight slides to the new row on the --dur-l spring, by translate only', async () => {
  await withApp(async (page) => {
    await token(page, '--dur-l', '7s')
    const list = page.locator('#scene-list')
    expect(await list.evaluate((el) => getComputedStyle(el, '::before').transitionDuration)).toMatch(/^7s/)
    await page.locator('#scene-list li > button:first-child').nth(2).click() // the rows never move, only the highlight
    await expect.poll(() => running(page, '#scene-list', '::before')).toEqual(['translate'])
    await finish(page)
    const at = await list.evaluate((el) => ({
      translate: getComputedStyle(el, '::before').translate,
      top: (el.querySelector('[aria-current]')!.parentElement as HTMLElement).offsetTop,
    }))
    expect(at.translate).toBe(`0px ${at.top}px`)
    // A row above that grows later (a thumbnail landing, fonts) pushes the current row down: the highlight follows.
    // A style rule, not an inline style, so a reload that rebuilds the rows (slow CI) keeps it.
    await page.evaluate(() => document.head.append(Object.assign(document.createElement('style'), { textContent: '#scene-list > li:first-child img { margin-top: 40px }' })))
    const place = () =>
      list.evaluate((el) => [el.style.getPropertyValue('--current-y'), `${(el.querySelector('[aria-current]')!.parentElement as HTMLElement).offsetTop}px`])
    await expect.poll(place).toEqual([`${at.top + 40}px`, `${at.top + 40}px`])
  })
})

test('a reload rebuilds the Scene list without dropping the highlight, so a moved current row slides', async () => {
  await withApp(async (page, dir) => {
    // Read the highlight the moment the rows are replaced, before render() marks the current one again.
    await page.evaluate(() => {
      const list = document.getElementById('scene-list')
      if (!list) throw new Error('#scene-list missing')
      ;(window as any).seen = []
      new MutationObserver(() => (window as any).seen.push(getComputedStyle(list, '::before').content)).observe(list, { childList: true })
    })
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Saved', size: { w: 320, h: 240 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html'] }))
    await expect(page).toHaveTitle('Saved - KapeCut')
    await expect.poll(() => page.evaluate(() => (window as any).seen)).not.toEqual([])
    expect(await page.evaluate(() => (window as any).seen)).not.toContain('none')
  })
})

test('a file dropped in enters Files with a short --dur-s motion; rows already listed stay still', async () => {
  await withApp(async (page, dir) => {
    await token(page, '--dur-s', '7s')
    writeFileSync(join(dir, 'logo.png'), 'png') // lands as a drop does: main copies, the watcher refreshes
    await expect(page.locator('#file-list li[data-file="logo.png"]')).toBeVisible()
    expect(await running(page, '#file-list li[data-file="logo.png"]')).toEqual(['opacity', 'translate'])
    expect(await running(page, '#file-list li[data-file="notes.txt"]')).toEqual([])
    // A second refresh mid-way (the watcher's change after an add) leaves the row moving, not snapped.
    writeFileSync(join(dir, 'z.txt'), 'z')
    await expect(page.locator('#file-list li[data-file="z.txt"]')).toBeVisible()
    expect(await running(page, '#file-list li[data-file="logo.png"]')).toEqual(['opacity', 'translate'])
    await finish(page)
    const row = page.locator('#file-list li[data-file="logo.png"]')
    expect(await row.evaluate((el) => [getComputedStyle(el).opacity, getComputedStyle(el).translate])).toEqual(['1', 'none'])
  })
})

test('the drop overlay fades and scales in from the window on --dur-m, and a leave mid-way reverses from where it is', async () => {
  await withApp(async (page) => {
    await token(page, '--dur-m', '7s')
    const overlay = page.locator('#drop-overlay')
    await expect(overlay).toBeHidden()
    await drag(page, 'dragover')
    await expect(overlay).toBeVisible()
    expect(await running(page, '#drop-overlay')).toEqual(['opacity', 'scale'])
    // It takes the drag over the Scene viewer, whose iframe would keep the events from this page.
    expect(await page.locator('#stage').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id
    })).toBe('drop-overlay')
    await page.waitForTimeout(400)
    await drag(page, 'dragleave')
    // Still on screen, fading back from its live value, not snapped to either end.
    await expect(overlay).toBeVisible()
    const opacity = Number(await overlay.evaluate((el) => getComputedStyle(el).opacity))
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThan(1)
    await drag(page, 'dragover') // and back again
    await drag(page, 'drop')
    await finish(page)
    await expect(overlay).toBeHidden()
  })
})

test('Export progress fills the Export button by scaleX, not width; done turns the status amber', async () => {
  await withApp(async (page) => {
    await token(page, '--accent', 'rgb(1, 2, 3)')
    await page.locator('#export').click()
    const middle = page.locator('iframe[data-export="b.html"]')
    await expect.poll(() => middle.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).held), { timeout: 15_000 }).toBe(true)
    const fill = page.locator('#export-progress')
    await expect(fill).toBeVisible()
    const box = await fill.evaluate((el) => ({ width: (el as HTMLElement).offsetWidth, button: el.parentElement!.clientWidth, transform: getComputedStyle(el).transform }))
    expect(box.width).toBe(box.button) // full width always; only the transform says how far
    const [, x] = /^matrix\(([\d.]+), 0, 0, 1, 0, 0\)$/.exec(box.transform) ?? []
    expect(Number(x)).toBeGreaterThan(0)
    expect(Number(x)).toBeLessThan(1)
    await middle.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).openGate())
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
    await expect(fill).toBeHidden()
    await expect(page.locator('#export-status')).toHaveCSS('color', 'rgb(1, 2, 3)')
  })
})

test('reduced motion: the Scene highlight, new Files rows, the drop overlay and Export progress only fade', async () => {
  await withApp(async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const prop = (selector: string, pseudo?: string) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el, p).transitionProperty, pseudo)
    expect(await prop('#scene-list', '::before')).toBe('opacity')
    expect(await prop('#file-list li')).toBe('opacity')
    // display flips after the fade, so leaving still fades
    for (const s of ['#export-progress', '#drop-overlay']) expect(await prop(s), s).toBe('opacity, display')
  })
})
