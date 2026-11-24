import { expect, test, type Page } from '@playwright/test'
import { boxesOf, boxOf } from './box'
import { launch } from './launch'
import { wav } from './wav'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const scene = `<canvas id="c" width="108" height="192"></canvas><script>
  const g = document.getElementById('c')?.getContext('2d')
  window.TOTAL = 0.5
  window.renderAt = () => { if (!g) throw new Error('canvas#c missing'); g.fillStyle = '#336699'; g.fillRect(0, 0, 108, 192) }
</script>`

// Three 0.5 s 9:16 Scenes (1.5 s), tone.wav and img/logo.png in the folder; project.json names sub/old.wav.
function project(sub = '') {
  const dir = join(mkdtempSync(join(tmpdir(), 'kapecut-files-')), sub)
  mkdirSync(dir, { recursive: true })
  const audio = [{ file: 'sub/old.wav', start: 0 }]
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Files', size: { w: 108, h: 192 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html'], audio }))
  ;['a', 'b', 'c'].forEach((s) => writeFileSync(join(dir, `${s}.html`), scene))
  for (const d of ['sub', 'img']) mkdirSync(join(dir, d))
  writeFileSync(join(dir, 'sub', 'old.wav'), wav(1))
  writeFileSync(join(dir, 'tone.wav'), wav(1))
  writeFileSync(join(dir, 'img', 'logo.png'), 'png')
  return dir
}

/** A drop of files from disk on `selector`: an <input type=file> gives the Files real paths, as an Explorer drop does. */
async function dropFiles(page: Page, selector: string, paths: string[]) {
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('input'), { type: 'file', multiple: true, id: 'e2e-files', hidden: true })))
  await page.locator('#e2e-files').setInputFiles(paths)
  await page.evaluate((selector) => {
    const input = document.querySelector<HTMLInputElement>('#e2e-files')
    const el = document.querySelector(selector)
    if (!input?.files || !el) throw new Error(`#e2e-files or ${selector} missing from the page`)
    const dt = new DataTransfer()
    for (const f of input.files) dt.items.add(f)
    input.remove()
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, selector)
}

/** Drags audio file `file` from the Files panel onto the Timeline at Project time t (of the 1.5 s video). drop: false stops over it. */
async function dragAudio(page: Page, file: string, t: number, drop = true) {
  const track = (await page.locator('#tl-track').boundingBox())!
  const strips = (await page.locator('#strips').boundingBox())!
  const at = { file, x: track.x + (track.width * t) / 1.5, y: strips.y + strips.height / 2, drop }
  await page.evaluate(({ file, x, y, drop }) => {
    const item = document.querySelector(`#file-list li[data-file="${file}"]`)
    const over = document.getElementById('tl-scroll')
    if (!item || !over) throw new Error(`${file} in Files or #tl-scroll missing from the page`)
    const dt = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
    for (const type of ['dragenter', 'dragover', ...(drop ? ['drop'] : [])])
      over.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }))
    if (drop) item.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }))
  }, at)
}

const audioOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).audio as { file: string; start: number; volume: number }[]
const names = (page: Page) => page.locator('#file-list .name')
const lane = (page: Page, i: number) => page.locator('#lanes .lane').nth(i)
// Set on Scene a's page; gone once that page reloads.
const markScene = (page: Page) => page.evaluate(() => ((document.querySelector('#stage iframe') as any).contentWindow.kept = true))
const sceneKept = (page: Page) => page.evaluate(() => (document.querySelector('#stage iframe') as any).contentWindow.kept === true)

test('Files sits above the Scenes with the Project folder path; Note and Pencil show their label and key', async () => {
  const dir = project('a-Project-folder-with-a-name-far-too-long-for-the-left-column')
  const { app, page } = await launch({ project: dir })
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    const [files, scenes] = await Promise.all([page.locator('#files').boundingBox(), page.locator('.scenes').boundingBox()])
    expect(files!.y + files!.height).toBeLessThanOrEqual(scenes!.y)
    // The path main opened (it resolves KAPECUT_PROJECT), whole on hover; on screen one line clipped with an ellipsis.
    const opened = resolve(dir)
    const path = page.locator('#files-path')
    await expect(path).toBeVisible()
    await expect(path).toHaveText(opened)
    await expect(path).toHaveAttribute('title', opened)
    const cut = await path.evaluate((el) => {
      const css = getComputedStyle(el)
      return { over: el.scrollWidth > el.clientWidth, ellipsis: css.textOverflow, clipped: css.overflowX }
    })
    expect(cut).toEqual({ over: true, ellipsis: 'ellipsis', clipped: 'hidden' })

    // The buttons whole inside the title bar, the Scene name whole beside them, no page scroll.
    const fits = async () => {
      const [tools, bar] = await Promise.all([page.locator('#note-tools').boundingBox(), page.locator('#view .titlebar').boundingBox()])
      expect(tools!.x + tools!.width).toBeLessThanOrEqual(bar!.x + bar!.width)
      expect(await page.locator('#scene-name').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
    for (const [id, label, key] of [['note', 'Note', 'N'], ['pen', 'Pencil', 'P']]) {
      await expect(page.locator(`#${id} .label`)).toBeVisible()
      await expect(page.locator(`#${id} .label`)).toHaveText(label)
      await expect(page.locator(`#${id}`)).toHaveAttribute('aria-keyshortcuts', key) // the key is in the tooltip, not on the button
    }
    await fits()
    // A small app window: the labels give way (still in the titles), nothing is clipped.
    await page.setViewportSize({ width: 1000, height: 700 })
    await expect(page.locator('#note .label')).toBeHidden()
    await fits()

    // N and P still pick them.
    await page.keyboard.press('n')
    await expect(page.locator('#note')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('p')
    await expect(page.locator('#pen')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#note')).toHaveAttribute('aria-pressed', 'false')
  } finally {
    await app.close()
  }
})

test('Files lists the Project with kinds and follows the folder; a file dropped anywhere is copied in', async () => {
  const dir = project()
  const { app, page } = await launch({ project: dir })
  try {
    // Every file but project.json and the Scene pages, before anything is dropped.
    await expect(names(page)).toHaveText(['img/logo.png', 'sub/old.wav', 'tone.wav'])
    await expect(page.locator('#file-list .kind')).toHaveText(['image', 'audio', 'audio'])
    await markScene(page)
    const src = mkdtempSync(join(tmpdir(), 'kapecut-drop-'))
    writeFileSync(join(src, 'beep.wav'), wav(1))
    writeFileSync(join(src, 'Geist.woff2'), 'font')
    writeFileSync(join(src, 'data.json'), '{}')

    // On the Scenes panel, then the viewer: copied, a clash gets a suffix, never a "not a folder" refusal.
    await dropFiles(page, '#scene-list', [join(src, 'beep.wav')])
    await expect(names(page)).toHaveText(['beep.wav', 'img/logo.png', 'sub/old.wav', 'tone.wav'])
    expect(readFileSync(join(dir, 'beep.wav'))).toEqual(wav(1))
    await dropFiles(page, '#stage', [join(src, 'beep.wav')])
    await expect(names(page)).toHaveText(['beep-2.wav', 'beep.wav', 'img/logo.png', 'sub/old.wav', 'tone.wav'])
    await expect(page.locator('#files-status')).toHaveText('Added beep-2.wav')
    await expect(page.locator('#export-status')).toBeEmpty()
    expect(await sceneKept(page)).toBe(true) // a sound file is not used by any Scene, so it reloads none

    // Any kind, several at once, on the Files panel.
    await dropFiles(page, '#files', [join(src, 'Geist.woff2'), join(src, 'data.json')])
    await expect(page.locator('#file-list li[data-file="Geist.woff2"] .kind')).toHaveText('font')
    await expect(page.locator('#file-list li[data-file="data.json"] .kind')).toHaveText('other')
    // Only audio drags onto the Timeline.
    await expect(page.locator('#file-list li[data-file="data.json"]')).not.toHaveAttribute('draggable', 'true')
    await expect(page.locator('#file-list li[data-file="tone.wav"]')).toHaveAttribute('draggable', 'true')

    // Live from the folder: a file Claude writes shows, a deleted one goes.
    writeFileSync(join(dir, 'img', 'bg.jpg'), 'jpg')
    await expect(page.locator('#file-list li[data-file="img/bg.jpg"] .kind')).toHaveText('image')
    rmSync(join(dir, 'img', 'bg.jpg'))
    await expect(page.locator('#file-list li[data-file="img/bg.jpg"]')).toHaveCount(0)

    // A page Claude then adds to project.json's Scenes leaves Files for the Scenes list.
    writeFileSync(join(dir, 'd.html'), scene)
    await expect(page.locator('#file-list li[data-file="d.html"] .kind')).toHaveText('other')
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Files', size: { w: 108, h: 192 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html', 'd.html'] }))
    await expect(page.locator('#scene-list li')).toHaveCount(4)
    await expect(page.locator('#file-list li[data-file="d.html"]')).toHaveCount(0)

    // A file already in the Project is not copied again, and the panel says so.
    await dropFiles(page, '#files', [join(dir, 'img', 'logo.png')])
    await expect(page.locator('#files-status')).toHaveText('Already in the Project: img/logo.png')

    // A row copies the path a Scene names it by.
    const copy = page.getByRole('button', { name: 'Copy the path img/logo.png' })
    const copyIcon = await copy.innerHTML()
    await copy.click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('img/logo.png')
    await expect.poll(() => copy.innerHTML()).not.toBe(copyIcon) // a check for a moment, then the copy icon again
    await expect.poll(() => copy.innerHTML()).toBe(copyIcon)
  } finally {
    await app.close()
  }
})

test('audio dragged from Files onto the Timeline lands at the drop Frame and plays; a lane moves by drag and is removed', async () => {
  const dir = project()
  const { app, page } = await launch({ project: dir })
  try {
    await expect(page.locator('#lanes .lane')).toHaveCount(1)
    await markScene(page)

    // A drag over the Timeline shows where it would land.
    await dragAudio(page, 'tone.wav', 1 + 0.5 / 30, false)
    await expect(page.locator('#drop-at')).toBeVisible()
    await dragAudio(page, 'tone.wav', 1 + 0.5 / 30)
    await expect(page.locator('#drop-at')).toBeHidden()
    await expect.poll(() => audioOf(dir)).toEqual([{ file: 'sub/old.wav', start: 0, volume: 1 }, { file: 'tone.wav', start: 1, volume: 1 }])
    await expect(lane(page, 1).locator('svg path')).toHaveAttribute('d', /L/)
    // A 9:16 stage over two Audio lanes is at its narrowest (the viewer window fills its column, #66): the Scene name
    // still shows whole, with the N and P buttons. The small-window case is in the layout test above.
    await expect(page.locator('#scene-name')).toHaveText('a.html')
    expect(await page.locator('#scene-name').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.locator('#note')).toBeVisible()
    // The name sits above the waveform, not over it.
    const [name, wave] = await boxesOf(page, '#lanes .lane span', '#lanes .lane > svg')
    expect(name.y + name.height).toBeLessThanOrEqual(wave.y + 1)

    // It plays: seek past its start, play, and it is scheduled 0.1 s in.
    await page.evaluate(() => {
      const log: number[] = ((window as any).starts = [])
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (when?: number, offset?: number) {
        log.push(offset ?? 0)
        return start.call(this, when, offset)
      }
    })
    await page.locator('#scrub').evaluate((el: HTMLInputElement) => ((el.value = String(33 / 30)), el.dispatchEvent(new Event('input'))))
    await page.keyboard.press('Space')
    // old.wav (1 s from 0) has ended by then; tone.wav starts 0.1 s in, plus the output latency.
    await expect.poll(() => page.evaluate(() => (window as any).starts)).toEqual([expect.any(Number)])
    const [offset] = await page.evaluate(() => (window as any).starts)
    expect(offset).toBeGreaterThanOrEqual(0.1 - 1e-9)
    expect(offset).toBeLessThan(0.25)
    await page.keyboard.press('Space')

    // Drag the lane right by 0.2 s: its start moves to a Frame there. Far left clamps at 0.
    const box = await boxOf(lane(page, 1))
    const pps = (await page.locator('#tl-track').boundingBox())!.width / 1.5
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 40 + 0.2 * pps, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => audioOf(dir)[1].start).toBeCloseTo(1.2, 1)
    expect(Math.abs(audioOf(dir)[1].start * 30 - Math.round(audioOf(dir)[1].start * 30))).toBeLessThan(1e-6)
    const moved = await boxOf(lane(page, 1))
    await page.mouse.move(moved.x + 40, moved.y + moved.height / 2)
    await page.mouse.down()
    await page.mouse.move(moved.x - 2 * pps, moved.y + moved.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => audioOf(dir)[1].start).toBe(0)

    // Removing drops it from project.json and keeps the file. The keyboard removes too.
    await page.getByRole('button', { name: 'Remove tone.wav from the Timeline' }).click()
    await expect.poll(() => audioOf(dir)).toEqual([{ file: 'sub/old.wav', start: 0, volume: 1 }])
    await expect(page.locator('#lanes .lane')).toHaveCount(1)
    expect(existsSync(join(dir, 'tone.wav'))).toBe(true)
    await lane(page, 0).focus()
    await page.keyboard.press('ArrowRight') // one Frame later
    await expect.poll(() => audioOf(dir)[0].start).toBeCloseTo(1 / 30, 6)
    await page.keyboard.press('Delete')
    await expect.poll(() => audioOf(dir)).toEqual([])
    await expect(page.locator('#lanes .lane')).toHaveCount(0)
    expect(existsSync(join(dir, 'sub', 'old.wav'))).toBe(true)
    await expect(names(page)).toHaveText(['img/logo.png', 'sub/old.wav', 'tone.wav']) // off the Timeline, still in Files

    // The app's own project.json writes reloaded no Scene.
    expect(await sceneKept(page)).toBe(true)
  } finally {
    await app.close()
  }
})

test('the keyboard adds an audio file at the playhead', async () => {
  const dir = project()
  const { app, page } = await launch({ project: dir })
  try {
    // Held arrow keys as the session's first writes: every press lands, and the screen ends where the disk does (the
    // first write's re-read of project.json must not put an older list back on screen).
    await lane(page, 0).focus()
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight', { delay: 0 })
    await expect.poll(() => audioOf(dir)[0].start).toBeCloseTo(8 / 30, 6)
    await expect(lane(page, 0)).toHaveAttribute('aria-valuenow', String(8 / 30))

    await page.locator('#scrub').evaluate((el: HTMLInputElement) => ((el.value = String(15 / 30)), el.dispatchEvent(new Event('input'))))
    await page.getByRole('button', { name: 'Add tone.wav to the Timeline at the playhead' }).press('Enter')
    await expect.poll(() => audioOf(dir).at(-1)).toEqual({ file: 'tone.wav', start: 0.5, volume: 1 })
    await expect(lane(page, 0)).toHaveAttribute('aria-valuenow', String(8 / 30)) // the earlier edit is still on screen
  } finally {
    await app.close()
  }
})
