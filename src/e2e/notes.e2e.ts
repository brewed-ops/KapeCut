import { expect, test, type Page } from '@playwright/test'
import { boxesOf } from './box'
import { launch } from './launch'
import { pngPixel } from './scene-pixel'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sceneHtml = (color: string) => `<canvas id="c" width="200" height="200"></canvas><script>
  const g = document.getElementById('c').getContext('2d')
  window.TOTAL = 0.5
  window.renderAt = () => { g.fillStyle = '${color}'; g.fillRect(0, 0, 200, 200) }
</script>`

function twoScenes() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html', 'b.html'] }))
  writeFileSync(join(dir, 'a.html'), sceneHtml('#ff0000'))
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00'))
  return dir
}

// The tests keep a profile across their relaunches (and read session.json in it): removed after each test.
const profiles: string[] = []
const profile = () => (profiles.push(mkdtempSync(join(tmpdir(), 'kapecut-user-'))), profiles.at(-1)!)
test.afterEach(() => Promise.all(profiles.splice(0).map((d) => rm(d, { recursive: true, force: true, maxRetries: 10 }).catch(() => {}))))

async function open(dir: string, userData: string) {
  const { app, page } = await launch({ project: dir, userData })
  // On CI's small screen the OS shrinks the window after it opens: wait for the Frame to stop moving, or a stroke drawn
  // mid-resize lands off its target (#68: "37 vs 40").
  const box = () => page.locator('#marks').boundingBox().then((b) => JSON.stringify(b))
  try {
    await expect.poll(async () => (await box()) === (await page.waitForTimeout(250), await box())).toBe(true)
  } catch (e) {
    await app.close() // the caller never got the app
    throw e
  }
  return { app, page }
}

const seekFrame = async (page: Page, f: number) => {
  await page.locator('#scrub').evaluate((el: HTMLInputElement, t) => {
    el.value = String(t)
    el.dispatchEvent(new Event('input'))
  }, f / 30)
  await expect(page.locator('#frame-no')).toHaveText(`F ${f}`)
}

// Screen position of Design-size pixel (x, y) on the Frame.
async function onFrame(page: Page, x: number, y: number) {
  const r = (await page.locator('#marks').boundingBox())!
  return [r.x + (x / 200) * r.width, r.y + (y / 200) * r.height] as const
}

const readNotes = (dir: string) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8'))
  } catch {
    return null
  }
}

const near = (got: number, want: number) => expect(Math.abs(got - want), `${got} vs ${want}`).toBeLessThanOrEqual(1)
const ISO = /^\d{4}-\d\d-\d\dT/

test('done Notes: Claude marks one live, the user marks and undoes, a filter hides them, a shortened Scene flags one', async () => {
  const dir = twoScenes()
  const userData = profile()
  const T = '2026-11-23T10:00:00.000Z'
  const note = (n: number, text: string, scene: string, frame: number, f: number) => ({
    n, text, done: false, scene, sceneTime: f / 30, time: frame / 30, frame, point: { x: 100, y: 100 }, created: T, updated: T,
  })
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 3, notes: [note(1, 'Bigger', 'a.html', 5, 5), note(2, 'Warmer', 'b.html', 20, 5)] }))
  const { app, page } = await open(dir, userData)
  const items = page.locator('#note-list li')
  await expect(items).toHaveCount(2)
  // Scene page loads, and every fetch: a Scene reload starts with a HEAD of its file, a Notes reload with a GET of notes.json.
  await page.evaluate(() => {
    const w = window as any
    w.loads = 0
    w.fetches = []
    for (const f of document.querySelectorAll('iframe')) f.addEventListener('load', () => w.loads++)
    const fetch = w.fetch
    w.fetch = (url: string, init?: RequestInit) => (w.fetches.push(`${init?.method ?? 'GET'} ${url}`), fetch(url, init))
  })
  const fetched = () => page.evaluate(() => (window as any).fetches as string[])

  // The user is typing an edit to Note 2 when Claude writes done on Note 1, and drops Note 2 from its copy as well.
  await page.getByRole('button', { name: 'Edit Note 2' }).click()
  await page.locator('#note-pop textarea').fill('Warmer, more orange')
  const claude = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8'))
  claude.notes[0].done = true
  claude.notes.splice(1) // the user owns the list: Note 2 and the edit to it stay
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(claude, null, 2))
  await expect(items.nth(0).locator('.pin.done svg')).toBeVisible({ timeout: 1000 })
  await expect(items.nth(0)).toHaveClass(/done/)
  await expect(items).toHaveCount(2)
  expect(await fetched()).toEqual(['GET /project/notes.json']) // the Notes reloaded, no Scene did
  await expect(page.locator('#note-pop textarea')).toHaveValue('Warmer, more orange')
  await page.keyboard.press('Enter')
  await expect.poll(() => readNotes(dir)?.notes.map((n: { done: boolean; text: string }) => [n.text, n.done])).toEqual([
    ['Bigger', true],
    ['Warmer, more orange', false],
  ])
  await seekFrame(page, 5)
  await expect(page.locator('#marks .pin.done')).toBeVisible() // the check on the Frame too

  // The app's own write reached no one: a Scene file saved after it reloads that Scene, and by then main would have sent
  // notes.json (its watcher timer was set first). Still only the reload and the save's two merge reads, no Notes reload.
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00'))
  await expect.poll(() => page.evaluate(() => (window as any).loads)).toBe(1)
  expect((await fetched()).filter((f) => f.endsWith('notes.json'))).toEqual(Array(3).fill('GET /project/notes.json'))

  // The user undoes Claude's done and marks Note 2 done; done Notes dim, the filter hides them, on the Frame too.
  await page.getByRole('button', { name: 'Undo Note 1 done' }).click()
  await expect(items.nth(0)).not.toHaveClass(/done/)
  // A double click sets done and undoes it: two writes, the second undoing the first, never done twice.
  const before = readNotes(dir).notes[1].updated
  await page.getByRole('button', { name: 'Set Note 2 done' }).dblclick()
  await expect.poll(() => readNotes(dir)?.notes[1]).toMatchObject({ done: false, updated: expect.not.stringMatching(before) })
  await expect(items.nth(1)).not.toHaveClass(/done/)
  await page.getByRole('button', { name: 'Set Note 2 done' }).click()
  await expect(items.nth(1)).toHaveClass(/done/)
  await expect.poll(() => readNotes(dir)?.notes.map((n: { done: boolean }) => n.done)).toEqual([false, true])
  await seekFrame(page, 20)
  await expect(page.locator('#marks .pin.done')).toBeVisible()
  await page.locator('#hide-done').click()
  await expect(page.locator('#hide-done')).toHaveAttribute('aria-pressed', 'true')
  await expect(items).toHaveCount(1)
  await expect(items.nth(0)).toContainText('Bigger')
  await expect(page.locator('#marks .pin')).toHaveCount(0)
  await expect(page.locator('#note-lane .marker')).toHaveText(['1']) // the Timeline hides it too
  await page.getByRole('button', { name: 'Set Note 1 done' }).click() // now every Note is done and hidden
  await expect(items).toHaveCount(0)
  await expect(page.locator('#notes-empty')).toBeVisible()
  await expect(page.locator('#notes-empty')).toContainText('Every Note is done')
  await page.locator('#hide-done').click()
  await expect(items).toHaveCount(2)
  await expect(page.locator('#notes-empty')).toBeHidden()
  await page.getByRole('button', { name: 'Undo Note 1 done' }).click()
  await expect(items.nth(0)).not.toHaveClass(/done/)

  // Claude adds a span Note over b.html's last 10 Frames (Project Frames 20 to 29), numbered past next: it is kept.
  const withSpan = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8'))
  withSpan.notes.push({ ...note(3, 'Slower ending', 'b.html', 20, 5), point: undefined, range: { start: 20 / 30, end: 1 } })
  withSpan.next = 4
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(withSpan))
  await expect(items).toHaveCount(3)
  await expect(items.nth(2)).not.toHaveClass(/flagged/)

  // Claude shortens a.html to 3 Frames: Note 1 (Scene Frame 5) is flagged and sits on a.html's last Frame. The span
  // follows b.html (now Frames 8 to 17 of 18), so it still fits.
  writeFileSync(join(dir, 'a.html'), sceneHtml('#ff0000').replace('TOTAL = 0.5', 'TOTAL = 0.1'))
  await expect(items.nth(0)).toHaveClass(/flagged/)
  await expect(items.nth(0).locator('.eyebrow')).toContainText('past its Scene end')
  await expect(items.nth(1)).not.toHaveClass(/flagged/)
  await expect(items.nth(2).locator('.eyebrow')).toContainText('span 0.27-0.60s')
  await expect(items.nth(2)).not.toHaveClass(/flagged/)
  // Then b.html to 12 Frames: the span keeps its 10 Frames, so it runs past the Project end (15 Frames) and is flagged.
  writeFileSync(join(dir, 'b.html'), sceneHtml('#00ff00').replace('TOTAL = 0.5', 'TOTAL = 0.4'))
  await expect(items.nth(2)).toHaveClass(/flagged/)
  await expect(items.nth(2).locator('.eyebrow')).toContainText('past the Project end')
  await items.nth(0).locator('.jump').click()
  await expect(page.locator('#frame-no')).toHaveText('F 2')
  await expect(page.locator('#marks > .pin')).toHaveText('1')

  // A notes.json from a newer KapeCut: a message, and the app never writes over it.
  const future = JSON.stringify({ version: 2, notes: [] })
  writeFileSync(join(dir, 'notes.json'), future)
  await expect(page.locator('#notes-status')).toContainText('version 2')
  await expect(page.getByRole('button', { name: 'Set Note 1 done' })).toBeDisabled() // mergeNotes refuses it too (Vitest)
  await expect(page.getByRole('button', { name: 'Edit Note 1' })).toBeDisabled()
  expect(readFileSync(join(dir, 'notes.json'), 'utf8')).toBe(future)
  // Claude puts a readable file back: the Notes come back on.
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(claude))
  await expect(page.getByRole('button', { name: 'Edit Note 1' })).toBeEnabled()
  await expect(page.locator('#notes-status')).toBeHidden()
  await app.close()
})

test('point and box Notes: notes.json, PNGs, pins on their Frame, list jump, edit, delete, reopen', async () => {
  const dir = twoScenes()
  const userData = profile()
  let { app, page } = await open(dir, userData)
  await expect(page.locator('#notes-empty')).toBeVisible()
  await page.evaluate(() => {
    ;(window as any).loads = 0
    for (const f of document.querySelectorAll('iframe')) f.addEventListener('load', () => (window as any).loads++)
  })

  // Point Note on Frame 5 (a.html), started with the N key.
  await seekFrame(page, 5)
  await page.keyboard.press('n')
  await page.mouse.click(...(await onFrame(page, 50, 60)))
  await page.locator('#note-pop textarea').fill('Bigger')
  await page.keyboard.press('Enter')
  await expect(page.locator('#note-pop')).toBeHidden()
  await expect(page.locator('#note')).toBeFocused() // so the next N starts a Note, not typing into the hidden box

  // Box Note on Frame 20 (b.html, Scene time 5/30), started with the Note button, dragged.
  await seekFrame(page, 20)
  await page.locator('#note').click()
  await page.mouse.move(...(await onFrame(page, 20, 30)))
  await page.mouse.down()
  await page.mouse.move(...(await onFrame(page, 80, 60)))
  await page.mouse.move(...(await onFrame(page, 120, 90)))
  await page.mouse.up()
  await page.locator('#note-pop textarea').fill('Warmer')
  await page.locator('#note-pop button', { hasText: 'Save' }).click()

  await expect.poll(() => readNotes(dir)?.notes?.length).toBe(2)
  const file = readNotes(dir)
  expect(file).toMatchObject({ version: 1, next: 3 })
  const [one, two] = file.notes
  expect(Object.keys(one)).toEqual(['n', 'text', 'done', 'scene', 'sceneTime', 'time', 'frame', 'point', 'image', 'created', 'updated'])
  expect(one).toMatchObject({ n: 1, text: 'Bigger', done: false, scene: 'a.html', frame: 5, image: 'notes/note-1.png', created: expect.stringMatching(ISO) })
  expect(one.sceneTime).toBeCloseTo(5 / 30, 5)
  expect(one.time).toBeCloseTo(5 / 30, 5)
  near(one.point.x, 50)
  near(one.point.y, 60)
  expect(two).toMatchObject({ n: 2, text: 'Warmer', scene: 'b.html', frame: 20, image: 'notes/note-2.png' })
  expect(two.sceneTime).toBeCloseTo(5 / 30, 5)
  expect(two.time).toBeCloseTo(20 / 30, 5)
  ;[two.box.x, two.box.y, two.box.w, two.box.h].forEach((v, i) => near(v, [20, 30, 100, 60][i]))
  expect(two.point).toBeUndefined()

  // Each PNG is the Frame at Design size with its mark drawn: accent on the mark, the Scene's colour elsewhere.
  const ACCENT = [240, 167, 38]
  expect(await pngPixel(page, 'notes/note-1.png', 50, 52)).toEqual([200, 200, ...ACCENT]) // inside the pin, above its number
  expect(await pngPixel(page, 'notes/note-1.png', 180, 180)).toEqual([200, 200, 255, 0, 0])
  expect(await pngPixel(page, 'notes/note-2.png', 70, 30)).toEqual([200, 200, ...ACCENT]) // top edge of the box
  expect(await pngPixel(page, 'notes/note-2.png', 180, 180)).toEqual([200, 200, 0, 255, 0])

  // Every Note has a marker on the Timeline.
  await expect(page.locator('#note-lane .marker')).toHaveText(['1', '2'])

  // Our own writes never reload a Scene.
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as any).loads)).toBe(0)

  // Marks draw only on their own Frame.
  await expect(page.locator('#marks .box')).toBeVisible()
  await expect(page.locator('#marks .box')).toHaveText('2')
  await expect(page.locator('#marks .pin')).toHaveCount(1) // the box's own number
  await seekFrame(page, 21)
  await expect(page.locator('#marks .pin')).toHaveCount(0)

  // The list: number, Scene, time, text; a click jumps to the Note's Frame.
  const items = page.locator('#note-list .jump')
  await expect(items).toHaveText([/1.*Bigger.*a\.html · 0\.17s · point/, /2.*Warmer.*b\.html · 0\.17s · box/])
  await items.nth(0).click()
  await expect(page.locator('#frame-no')).toHaveText('F 5')
  await expect(page.locator('#marks > .pin')).toHaveText('1')

  // Edit and delete update notes.json; the deleted Note's picture goes too.
  await page.getByRole('button', { name: 'Edit Note 1' }).click()
  await page.locator('#note-pop textarea').fill('Much bigger')
  await page.keyboard.press('Enter')
  await expect.poll(() => readNotes(dir)?.notes[0]?.text).toBe('Much bigger')
  expect(readNotes(dir).notes[0].updated >= readNotes(dir).notes[0].created).toBe(true)
  await page.getByRole('button', { name: 'Delete Note 2' }).click()
  await expect.poll(() => readNotes(dir)?.notes.map((n: { n: number }) => n.n)).toEqual([1])
  await expect.poll(() => existsSync(join(dir, 'notes/note-2.png'))).toBe(false) // deleted after notes.json stops naming it

  // Keyboard only: N, then Enter puts a point in the middle. Its number is 3, never the deleted 2.
  await seekFrame(page, 25)
  await page.keyboard.press('n')
  await expect(page.locator('#note')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')
  await expect(page.locator('#note-pop-title')).toHaveText(/^Note 3 /)
  await page.locator('#note-pop textarea').fill('Centre')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // a double Enter adds the Note once
  // With the status, so a failed save names its cause (#137: a locked notes.json was a 500).
  const saved = async () => [readNotes(dir)?.notes.map((n: { n: number }) => n.n), await page.locator('#notes-status').textContent()]
  await expect.poll(saved).toEqual([[1, 3], ''])
  await page.waitForTimeout(500) // a second add from the double Enter would land by now
  expect(readNotes(dir).notes.map((n: { n: number }) => n.n)).toEqual([1, 3])
  expect(readNotes(dir).notes[1].point).toEqual({ x: 100, y: 100 })
  expect(existsSync(join(dir, 'notes/note-3.png'))).toBe(true)
  const leftovers = [...readdirSync(dir), ...readdirSync(join(dir, 'notes'))].filter((f) => f.endsWith('.tmp'))
  expect(leftovers).toEqual([])

  // Claude marks Note 1 done while the app is open; the user's next edit keeps it.
  const claude = readNotes(dir)
  claude.notes[0].done = true
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(claude))
  await page.getByRole('button', { name: 'Edit Note 3' }).click()
  await page.locator('#note-pop textarea').fill('Centre, bolder')
  await page.keyboard.press('Enter')
  await expect.poll(() => readNotes(dir)?.notes[1]?.text).toBe('Centre, bolder')
  expect(readNotes(dir).notes[0].done).toBe(true)
  await app.close()

  // Notes survive closing and reopening the Project.
  ;({ app, page } = await open(dir, userData))
  await expect(page.locator('#note-list .jump')).toHaveText([/^Much bigger/, /3.*Centre, bolder/]) // Note 1 is done: a check
  await expect(page.getByRole('img', { name: 'Note 1 done' })).toBeVisible()
  await app.close()

  // Claude drops a.html: Note 1 keeps its Scene, draws on no other Scene's Frame, and says its Scene is gone.
  // Note 3 (b.html, Scene time 10/30) follows b.html to the front.
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['b.html'] }))
  ;({ app, page } = await open(dir, userData))
  await expect(page.locator('#note-list .jump')).toHaveText([/1.*Scene not in the Project/, /3.*Centre/])
  await seekFrame(page, 5)
  await expect(page.locator('#marks .pin')).toHaveCount(0)
  await page.locator('#note-list .jump').nth(1).click()
  await expect(page.locator('#frame-no')).toHaveText('F 10')
  await expect(page.locator('#marks > .pin')).toHaveText('3')
  await app.close()
})

// Screen x of Project time t on the Timeline, and a y on its Scene strips.
async function onTimeline(page: Page, t: number) {
  const r = (await page.locator('#tl-track').boundingBox())!
  const s = (await page.locator('#strips').boundingBox())!
  return [r.x + t * r.width, s.y + s.height / 2] as const // the video is 1 s long
}

test('pencil stroke and span Notes: notes.json shapes, stroke on Frame and PNG, Timeline marker and bar, jumps, done dimmed', async () => {
  const dir = twoScenes()
  const userData = profile()
  let { app, page } = await open(dir, userData)
  await expect(page.locator('#notes-empty')).toBeVisible()

  // Pencil stroke on Frame 5 (a.html), started with P.
  await seekFrame(page, 5)
  await page.keyboard.press('p')
  await expect(page.locator('#pen')).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(...(await onFrame(page, 20, 20)))
  await page.mouse.down()
  await page.mouse.move(...(await onFrame(page, 60, 40)))
  await page.mouse.move(...(await onFrame(page, 100, 100)))
  await page.mouse.up()
  await page.locator('#note-pop textarea').fill('Path')
  await page.keyboard.press('Enter')
  await expect(page.locator('#note-pop')).toBeHidden()

  // Span over Frames 6 to 24, dragged on the Timeline in Note mode: it crosses the cut at Frame 15.
  await page.keyboard.press('n')
  await page.mouse.move(...(await onTimeline(page, 6.5 / 30)))
  await page.mouse.down()
  await page.mouse.move(...(await onTimeline(page, 15.5 / 30)))
  await expect(page.locator('#note-lane .span.draft')).toBeVisible() // the span shows while it is dragged
  await page.mouse.move(...(await onTimeline(page, 24.5 / 30)))
  await page.mouse.up()
  await expect(page.locator('#note-pop-title')).toHaveText('Note 2 · a.html · 0.20s · span 0.20-0.83s')
  await page.locator('#note-pop textarea').fill('Slower')
  await page.keyboard.press('Enter')

  await expect.poll(() => readNotes(dir)?.notes?.length).toBe(2)
  const [one, two] = readNotes(dir).notes
  expect(one).toMatchObject({ n: 1, text: 'Path', scene: 'a.html', frame: 5, image: 'notes/note-1.png' })
  expect(one.stroke).toHaveLength(3)
  one.stroke.forEach((p: { x: number; y: number }, i: number) => {
    near(p.x, [20, 60, 100][i])
    near(p.y, [20, 40, 100][i])
  })
  expect(two).toMatchObject({ n: 2, text: 'Slower', scene: 'a.html', frame: 6 })
  expect(Object.keys(two)).toEqual(['n', 'text', 'done', 'scene', 'sceneTime', 'time', 'frame', 'range', 'scenes', 'created', 'updated'])
  expect(two.scenes).toEqual(['a.html', 'b.html']) // it crosses the cut
  expect(two.range.start).toBeCloseTo(6 / 30, 5)
  expect(two.range.end).toBeCloseTo(25 / 30, 5) // where Frame 24 ends

  // The stroke on the PNG: on the line, the pin at its first point, the Scene elsewhere.
  const ACCENT = [240, 167, 38]
  expect(await pngPixel(page, 'notes/note-1.png', 40, 30)).toEqual([200, 200, ...ACCENT]) // mid first segment
  expect(await pngPixel(page, 'notes/note-1.png', 80, 70)).toEqual([200, 200, ...ACCENT]) // mid second segment
  expect(await pngPixel(page, 'notes/note-1.png', 20, 12)).toEqual([200, 200, ...ACCENT]) // the pin, above its number
  expect(await pngPixel(page, 'notes/note-1.png', 180, 20)).toEqual([200, 200, 255, 0, 0])

  // The stroke draws on its own Frame only; a span draws nothing on the Frame.
  await seekFrame(page, 5)
  await expect(page.locator('#marks .stroke polyline')).toBeVisible()
  await expect(page.locator('#marks .stroke')).toHaveText('1')
  await seekFrame(page, 6)
  await expect(page.locator('#marks > *')).toHaveCount(0)

  // Timeline: a marker for the stroke, a bar across the span over the cut.
  await expect(page.locator('#note-lane .marker')).toHaveText(['1'])
  await expect(page.locator('#note-lane .span')).toHaveText(['2'])
  const [bar, { x: cut }, track] = await boxesOf(page, '#note-lane .span', '#strips > div:nth-child(2)', '#tl-track')
  expect(bar.x).toBeLessThan(cut)
  expect(bar.x + bar.width).toBeGreaterThan(cut)
  near(bar.x - track.x, (6 / 30) * track.width)
  near(bar.width, (19 / 30) * track.width)

  // The list marks the span's Note while the Frame on screen is in it: Frame 24 is its last, 25 is past it.
  await seekFrame(page, 24)
  await expect(page.locator('#note-list li').nth(1)).toHaveClass(/here/)
  await seekFrame(page, 25)
  await expect(page.locator('#note-list li').nth(1)).not.toHaveClass(/here/)

  // Clicking a marker or the bar jumps to its Note; the list lists the span.
  await seekFrame(page, 0)
  await page.locator('#note-lane .marker').click()
  await expect(page.locator('#frame-no')).toHaveText('F 5')
  await page.locator('#note-lane .span').click({ position: { x: bar.width - 4, y: bar.height / 2 } }) // near its end
  await expect(page.locator('#frame-no')).toHaveText('F 6')
  await expect(page.locator('#note-list .jump')).toHaveText([/1.*Path.*stroke/, /2.*Slower.*span 0.20-0.83s/])
  await app.close()

  // Claude marks the stroke Note done: its marker is dimmed, the span's is not.
  const claude = readNotes(dir)
  claude.notes[0].done = true
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(claude))
  ;({ app, page } = await open(dir, userData))
  await expect(page.locator('#note-lane .marker')).toHaveClass(/done/)
  await expect(page.locator('#note-lane .marker')).toHaveCSS('opacity', '0.4')
  await expect(page.locator('#note-lane .span')).toHaveCSS('opacity', '1')
  // On its Frame the fixed stroke's line is gone: only its check pin stays.
  await page.locator('#note-lane .marker').click()
  await expect(page.locator('#frame-no')).toHaveText('F 5')
  await expect(page.locator('#marks .pin.done')).toHaveCount(1)
  await expect(page.locator('#marks polyline')).toHaveCount(0)

  // Escape in the middle of a span drag cancels it: moving on and letting go adds no Note.
  await page.keyboard.press('n')
  await page.mouse.move(...(await onTimeline(page, 2.5 / 30)))
  await page.mouse.down()
  await page.mouse.move(...(await onTimeline(page, 8.5 / 30)))
  await expect(page.locator('#note-lane .span.draft')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.move(...(await onTimeline(page, 10.5 / 30)))
  await page.mouse.up()
  await expect(page.locator('#note-pop')).toBeHidden()
  await expect(page.locator('#note-lane .draft')).toHaveCount(0)

  // A pencil tap that wobbles under 4 px draws no stroke; the pencil stays on.
  await page.keyboard.press('p')
  await page.mouse.move(...(await onFrame(page, 50, 50)))
  await page.mouse.down()
  await page.mouse.move(...(await onFrame(page, 51, 51)))
  await page.mouse.up()
  await expect(page.locator('#note-pop')).toBeHidden()
  await expect(page.locator('#pen')).toHaveAttribute('aria-pressed', 'true')

  // Switching tools in the middle of a box drag drops the drag: letting go adds nothing.
  await page.keyboard.press('n')
  await page.mouse.move(...(await onFrame(page, 20, 20)))
  await page.mouse.down()
  await page.mouse.move(...(await onFrame(page, 90, 90)))
  await page.keyboard.press('p')
  await page.mouse.up()
  await expect(page.locator('#note-pop')).toBeHidden()

  // Keyboard only: N, [ on Frame 3, two arrows, ] adds a span over Frames 3 to 5.
  await seekFrame(page, 3)
  await page.keyboard.press('n')
  await page.keyboard.press('[')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#note-lane .span.draft')).toBeVisible()
  await page.keyboard.press(']')
  await expect(page.locator('#note-pop-title')).toHaveText('Note 3 · a.html · 0.10s · span 0.10-0.20s')
  await page.locator('#note-pop textarea').fill('Snappier')
  await page.keyboard.press('Enter')
  await expect.poll(() => readNotes(dir)?.notes?.length).toBe(3)
  expect(readNotes(dir).notes[2].range).toEqual({ start: 3 / 30, end: 6 / 30 })
  expect(readNotes(dir).notes[2].scenes).toBeUndefined() // inside one Scene
  await app.close()
})

test('a span follows its start Scene on re-order, flagged once the Scenes it crossed are no longer neighbours', async () => {
  const dir = twoScenes()
  writeFileSync(join(dir, 'c.html'), sceneHtml('#0000ff'))
  const order = (...scenes: string[]) =>
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes }))
  order('a.html', 'b.html', 'c.html')
  // The span over the a to b cut, as the app writes it: a.html Frames 10 to 14, b.html Frames 0 to 4.
  const T = '2026-11-23T10:00:00.000Z'
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 2, notes: [{
    n: 1, text: 'Smoother cut', done: false, scene: 'a.html', sceneTime: 10 / 30, time: 10 / 30, frame: 10,
    range: { start: 10 / 30, end: 20 / 30 }, scenes: ['a.html', 'b.html'], created: T, updated: T,
  }] }))
  const userData = profile()
  const { app, page } = await open(dir, userData)
  const item = page.locator('#note-list li')
  const bar = page.locator('#note-lane .span')
  await expect(bar).toHaveText(['1'])

  // c, a, b: a.html starts at Frame 15, so the bar is Frames 25 to 34, still on the a to b cut at Frame 30.
  order('c.html', 'a.html', 'b.html')
  await expect(item.locator('.eyebrow')).toContainText('span 0.83-1.17s')
  const [track, box, { x: cut }] = await boxesOf(page, '#tl-track', '#note-lane .span', '#strips > div:nth-child(3)') // cut: b.html's strip
  near(box.x - track.x, (25 / 45) * track.width)
  near(box.width, (10 / 45) * track.width)
  expect(box.x).toBeLessThan(cut)
  expect(box.x + box.width).toBeGreaterThan(cut)
  await expect(item).not.toHaveClass(/flagged/)
  await bar.click()
  await expect(page.locator('#frame-no')).toHaveText('F 25')

  // b, c, a: a.html is last, b.html no longer follows it.
  order('b.html', 'c.html', 'a.html')
  await expect(item).toHaveClass(/flagged/)
  await expect(item.locator('.eyebrow')).toContainText('Scenes around this span changed')

  // Back to a, b, c: neighbours again, no flag. Then a.html leaves: like any Note whose Scene is gone, no bar.
  order('a.html', 'b.html', 'c.html')
  await expect(item).not.toHaveClass(/flagged/)
  order('b.html', 'c.html')
  await expect(item.locator('.eyebrow')).toContainText('Scene not in the Project')
  await expect(bar).toHaveCount(0)
  await seekFrame(page, 12) // inside the span as drawn: it is nowhere now, so its row is never marked as here
  await expect(item).not.toHaveClass(/here/)
  await app.close()
})

test('Copy Prompt copies the fix prompt for the open Notes only, counts them live, and is off with none open', async () => {
  const dir = twoScenes()
  const userData = profile()
  const T = '2026-11-23T10:00:00.000Z'
  const note = (n: number, done: boolean) => ({
    n, text: `Text of Note ${n}`, done, scene: 'a.html', sceneTime: 0, time: 0, frame: 0, point: { x: 100, y: 100 }, created: T, updated: T,
  })
  const notes = (...done: boolean[]) => ({ version: 1, next: done.length + 1, notes: done.map((d, i) => note(i + 1, d)) })
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes(true, false, false)))
  const { app, page } = await open(dir, userData)
  const copy = page.getByRole('button', { name: /^Copy Prompt/ })
  await expect(copy).toHaveText('Copy Prompt · 2 open')
  await expect(copy).toBeEnabled()

  // A clipboard that refuses: the header's message line says why, and the next good copy clears it.
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
  const status = page.locator('#export-status')
  // The OS clipboard is stubbed, not main's handler, so the handler's own checks (#126) stay as shipped.
  await app.evaluate(({ clipboard }) => {
    ;(globalThis as { realWrite?: typeof clipboard.writeText }).realWrite = clipboard.writeText
    clipboard.writeText = () => {
      throw new Error('clipboard busy')
    }
  })
  await copy.click()
  await expect(status).toHaveText('Could not copy the prompt: clipboard busy')
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = (globalThis as { realWrite?: typeof clipboard.writeText }).realWrite!
    clipboard.writeText('')
  })
  await copy.click()
  await expect(page.getByRole('status').filter({ has: page.locator('#toast') })).toContainText('Prompt copied')
  await expect(status).toHaveText('')
  const prompt = await clipboard()
  expect(prompt).toContain('follow fix-notes.md')
  expect(prompt).toContain(`Project folder (open in KapeCut now): ${dir}\n`)
  expect(prompt).toContain(`read ${join(realpathSync(userData), 'session.json')} and confirm`)
  expect(prompt).toContain('Fix these open Notes in notes.json: 2, 3.') // not done Note 1
  expect(prompt).not.toContain('Text of Note') // numbers only: Note text stays in notes.json

  // Done and Copy Prompt in one go: the copy waits for the save, so Note 2 is not in it.
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await page.evaluate(() => {
    ;(document.querySelector('[aria-label="Set Note 2 done"]') as HTMLElement).click()
    document.getElementById('copy-prompt')!.click()
  })
  await expect.poll(clipboard).toContain('Fix these open Notes in notes.json: 3.')
  await expect(copy).toHaveText('Copy Prompt · 1 open')

  // An unreadable notes.json: no count, off. Then Claude marks Notes done on disk: the count follows, off with none open.
  writeFileSync(join(dir, 'notes.json'), '{ not json')
  await expect(copy).toHaveText('Copy Prompt')
  await expect(copy).toBeDisabled()
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes(true, true, false)))
  await expect(copy).toHaveText('Copy Prompt · 1 open')
  await expect(copy).toBeEnabled()
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes(true, true, true)))
  await expect(copy).toHaveText('Copy Prompt')
  await expect(copy).toBeDisabled()
  await app.close()
})

// Apple design pass (#79). The transitions running on an element (not its children): what, from, to, how long.
const motion = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) =>
    el
      .getAnimations()
      .map((a) => {
        const t = a as CSSTransition
        const [from, to] = (t.effect as KeyframeEffect).getKeyframes()
        return { prop: t.transitionProperty, from: String(from[t.transitionProperty]), to: String(to[t.transitionProperty]), duration: t.effect!.getTiming().duration }
      })
      .sort((a, b) => a.prop.localeCompare(b.prop)),
  )
const popMotion = (page: Page) => motion(page, '#note-pop')

test('the Note popover grows out of its Mark on the token spring and closes back into it, reversing mid-way', async () => {
  const dir = twoScenes()
  const userData = profile()
  const { app, page } = await open(dir, userData)
  const pop = page.locator('#note-pop')
  // A value no rule hard-codes, so the popover is proven to read the token (#71).
  await page.evaluate(() => document.documentElement.style.setProperty('--dur-m', '777ms'))

  await seekFrame(page, 5)
  await page.keyboard.press('n')
  await page.mouse.click(...(await onFrame(page, 50, 60)))
  await expect(pop).toBeVisible()
  const grow = await popMotion(page)
  expect(grow.map((m) => m.prop).sort()).toEqual(['opacity', 'scale'])
  for (const m of grow) expect(m.duration, m.prop).toBe(777)
  expect(grow.find((m) => m.prop === 'opacity')!.from).toBe('0')
  // The origin is the Mark: the draft pin's centre, in the popover's own unscaled box.
  const [origin, pin] = await page.evaluate(() => {
    const p = document.getElementById('note-pop')!
    const parent = (p.offsetParent as HTMLElement).getBoundingClientRect()
    const r = document.querySelector('#marks .draft')!.getBoundingClientRect()
    const left = parent.left + (p.offsetParent as HTMLElement).clientLeft + p.offsetLeft
    const top = parent.top + (p.offsetParent as HTMLElement).clientTop + p.offsetTop
    return [getComputedStyle(p).transformOrigin.split(' ').map(parseFloat), [r.left + r.width / 2 - left, r.top + r.height / 2 - top]]
  })
  near(origin[0], pin[0])
  near(origin[1], pin[1])
  await expect.poll(() => popMotion(page)).toEqual([]) // settled open
  await page.locator('#note-cancel').click()
  const shrink = await popMotion(page)
  expect(shrink.map((m) => m.prop).sort()).toEqual(['opacity', 'scale'])
  expect(shrink.find((m) => m.prop === 'opacity')!.to).toBe('0')
  expect(await pop.evaluate((p: HTMLElement) => p.inert)).toBe(true) // a shrinking form takes no Tab or Enter
  await expect(pop).toBeHidden()
  expect(await page.locator('#marks .draft').count()).toBe(0)

  // Opened, then closed at once: the close starts from the scale on screen, not from the open end, and nothing queues.
  await page.keyboard.press('n')
  const [live, back] = await page.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) // keyboard point in the middle of the Frame
    const p = document.getElementById('note-pop')!
    await new Promise((r) => setTimeout(r, 120))
    const live = getComputedStyle(p).scale
    document.getElementById('note-cancel')!.click()
    const back = p.getAnimations().map((a) => {
      const t = a as CSSTransition
      return { prop: t.transitionProperty, from: String((t.effect as KeyframeEffect).getKeyframes()[0][t.transitionProperty]) }
    })
    return [live, back.filter((m) => m.prop === 'scale')]
  })
  expect(Number(live)).toBeGreaterThan(0)
  expect(Number(live)).toBeLessThan(1)
  expect(back).toEqual([{ prop: 'scale', from: live }])
  await expect(pop).toBeHidden()

  // Closed, then opened again at the same Mark mid-shrink (Edit on the same Note): it reverses too, never restarts.
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  await page.locator('#note-pop textarea').fill('Bigger')
  await page.keyboard.press('Enter')
  await expect(pop).toBeHidden()
  await page.locator('#note-list .edit').click()
  await expect.poll(() => popMotion(page)).toEqual([])
  const [shrunk, again] = await page.evaluate(async () => {
    const p = document.getElementById('note-pop')!
    document.getElementById('note-cancel')!.click()
    await new Promise((r) => setTimeout(r, 120))
    const live = getComputedStyle(p).scale
    ;(document.querySelector('#note-list .edit') as HTMLElement).click()
    const again = p.getAnimations().map((a) => {
      const t = a as CSSTransition
      return { prop: t.transitionProperty, from: String((t.effect as KeyframeEffect).getKeyframes()[0][t.transitionProperty]) }
    })
    return [live, again.filter((m) => m.prop === 'scale')]
  })
  expect(Number(shrunk)).toBeLessThan(1)
  expect(again).toEqual([{ prop: 'scale', from: shrunk }])
  await expect(pop).toBeVisible()
  await expect(pop).not.toHaveClass(/closing/)
  await app.close()
})

// The same, as [property, duration] pairs.
const moving = async (page: Page, selector: string) => (await motion(page, selector)).map((m) => [m.prop, m.duration])

test('adding a Note, setting it done and copying the prompt each say so in text and in motion', async () => {
  const dir = twoScenes()
  const userData = profile()
  const { app, page } = await open(dir, userData)
  const status = page.locator('#notes-told')
  // Slow enough to still be running when read, and a value no rule hard-codes (#71).
  await page.evaluate(() => document.documentElement.style.setProperty('--dur-s', '30s'))

  await seekFrame(page, 5)
  await page.keyboard.press('n')
  await page.mouse.click(...(await onFrame(page, 50, 60)))
  await page.locator('#note-pop textarea').fill('Bigger')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Note 1 added')
  expect(await moving(page, '#note-list li')).toEqual([['opacity', 30000], ['scale', 30000]]) // the new row grows in
  // A later save redraws the list: only the Note just added grows in, once.
  await page.locator('#note').click()
  await page.mouse.click(...(await onFrame(page, 150, 150)))
  await page.locator('#note-pop textarea').fill('Warmer')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Note 2 added')
  expect(await moving(page, '#note-list li >> nth=0')).toEqual([])
  expect(await moving(page, '#note-list li >> nth=1')).toEqual([['opacity', 30000], ['scale', 30000]])

  await page.getByRole('button', { name: 'Set Note 1 done' }).click()
  await expect(status).toHaveText('Note 1 done')
  expect(await moving(page, '#note-list li >> nth=0 >> .pin')).toEqual([['opacity', 30000], ['scale', 30000]]) // the check pops in
  expect(await moving(page, '#note-list li >> nth=1 >> .pin')).toEqual([])
  await page.getByRole('button', { name: 'Undo Note 1 done' }).click()
  await expect(status).toHaveText('Note 1 open again')
  await expect(page.locator('.notes .titlebar .file')).toBeHidden() // the news stands in for "notes.json"
  await expect(status).toHaveText('') // for a moment
  await expect(page.locator('.notes .titlebar .file')).toBeVisible()

  await page.evaluate(() => document.documentElement.style.removeProperty('--dur-s'))
  const copy = page.locator('#copy-prompt')
  const had = await app.evaluate(({ clipboard }) => clipboard.readText())
  await copy.click()
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), had)
  await expect(copy).toHaveText('Copied')
  await expect(copy.locator('.ok')).toBeVisible() // a check in place of the copy icon
  await expect(copy.locator('.icon')).toBeHidden()
  await expect(copy).toHaveText('Copy Prompt · 2 open') // and back
  await expect(copy.locator('.icon')).toBeVisible()

  // Copied, then a Note set done: the clipboard is stale, so the count shows at once, not after the hold.
  await copy.click()
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), had)
  await expect(copy).toHaveText('Copied')
  await page.getByRole('button', { name: 'Set Note 1 done' }).click()
  await expect(copy).toHaveText('Copy Prompt · 1 open', { timeout: 1000 })

  await page.getByRole('button', { name: 'Delete Note 2' }).click()
  await expect(status).toHaveText('Note 2 deleted')
  await app.close()
})

test('reduced motion: the popover, a new Note, a done check and Copied only fade, nothing scales', async () => {
  const dir = twoScenes()
  const userData = profile()
  const { app, page } = await open(dir, userData)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--dur-s', '30s')
    document.documentElement.style.setProperty('--dur-m', '30s')
  })
  const pop = page.locator('#note-pop')
  const scale = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).scale)

  await page.keyboard.press('n')
  await page.keyboard.press('Enter') // a point in the middle of the Frame
  await expect(pop).toBeVisible()
  expect(await moving(page, '#note-pop')).toEqual([['opacity', 30000]])
  expect(await scale('#note-pop')).toMatch(/^(1|none)$/)
  // Fully open first: a close mid-fade reverses over only the part faded in, too short to read.
  await page.evaluate(() => document.documentElement.style.setProperty('--dur-m', '1ms'))
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  await expect.poll(() => moving(page, '#note-pop')).toEqual([])
  await page.evaluate(() => document.documentElement.style.setProperty('--dur-m', '30s'))
  await page.locator('#note-pop textarea').fill('Bigger')
  await page.keyboard.press('Enter')
  await expect(page.locator('#notes-told')).toHaveText('Note 1 added')
  expect(await moving(page, '#note-pop')).toEqual([['opacity', 30000]]) // fading out
  expect(await scale('#note-pop')).toMatch(/^(1|none)$/)
  expect(await moving(page, '#note-list li')).toEqual([['opacity', 30000]])
  expect(await scale('#note-list li')).toMatch(/^(1|none)$/)

  await page.getByRole('button', { name: 'Set Note 1 done' }).click()
  await expect(page.locator('#notes-told')).toHaveText('Note 1 done')
  expect(await moving(page, '#note-list .pin')).toEqual([['opacity', 30000]])
  expect(await scale('#note-list .pin')).toMatch(/^(1|none)$/)
  await page.getByRole('button', { name: 'Undo Note 1 done' }).click()
  await expect(page.locator('#notes-told')).toHaveText('Note 1 open again')

  const had = await app.evaluate(({ clipboard }) => clipboard.readText())
  await page.locator('#copy-prompt').click()
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), had)
  await expect(page.locator('#copy-prompt')).toHaveText('Copied')
  expect(await moving(page, '#copy-prompt .ok')).toEqual([['opacity', 30000]])
  expect(await scale('#copy-prompt .ok')).toMatch(/^(1|none)$/)
  await app.close()
})
