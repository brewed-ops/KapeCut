import { expect, test, type Page } from '@playwright/test'
import { boxOf } from './box'
import { launch } from './launch'
import { wav } from './wav'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Transport and Timeline motion (#78): drags follow the pointer with no transition, the playhead and an Audio lane
// rubber-band past the Timeline's ends and spring back on the motion tokens, zoom keeps the time under the pointer.

// Three `total` s Scenes (1.5 s by default) and tone.wav from 0 s.
function project(total: number) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-tl-motion-'))
  const scenes = ['a.html', 'b.html', 'c.html']
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Motion', size: { w: 108, h: 192 }, fps: 30, scenes, audio: [{ file: 'tone.wav', start: 0 }] }))
  for (const s of scenes) writeFileSync(join(dir, s), `<canvas id="c" width="108" height="192"></canvas><script>window.TOTAL = ${total}; window.renderAt = () => {}</script>`)
  writeFileSync(join(dir, 'tone.wav'), wav(1))
  return dir
}

async function withApp(run: (page: Page, dir: string) => Promise<void>, total = 0.5) {
  const dir = project(total)
  const { app, page } = await launch({ project: dir })
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('#lanes .lane > svg')).toHaveCount(1) // tone.wav decoded
    // A small screen (macOS CI) opens the window narrower: the Timeline fits the new width on its ResizeObserver, a
    // frame or more later, so every test measures the track only once it fills the view (#29). NaN (retry) until it has
    // a width at all.
    await expect.poll(() => page.locator('#tl-scroll').evaluate((el) => {
      const [width, pad] = [document.getElementById('tl-track')?.getBoundingClientRect().width, parseFloat(getComputedStyle(el).paddingLeft)]
      return width ? Math.abs(width - (el.clientWidth - 2 * pad)) : NaN
    })).toBeLessThan(1)
    await run(page, dir)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
}

const box = (page: Page, selector: string) => boxOf(page.locator(selector).first())
// NaN while the lanes are laid out anew (no box yet), so a poll retries instead of throwing.
const laneX = async (page: Page) => (await page.locator('#lanes .lane').first().boundingBox())?.x ?? NaN
// The playhead line's centre on screen: where it is drawn right now, mid-transition included.
const playheadX = async (page: Page) => {
  const b = await box(page, '#playhead')
  return b.x + b.width / 2
}
// Where the playhead rests: at the Frame the transport is on (past the end, the last one), on the 1.5 s track.
const restX = async (page: Page) => {
  const [track, frame] = [await box(page, '#tl-track'), Number((await page.locator('#frame-no').textContent())!.slice(2))]
  return track.x + (frame / 30 / 1.5) * track.width
}
const duration = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).transitionDuration)
const setToken = (page: Page, name: string, value: string) => page.evaluate(([n, v]) => document.documentElement.style.setProperty(n, v), [name, value])

test('the playhead follows a drag with no transition, rubber-bands past both ends and springs back on --dur-m', async () => {
  await withApp(async (page) => {
    await setToken(page, '--dur-m', '3s') // a value no rule hard-codes, and long enough to watch the settle
    const track = await box(page, '#tl-track')
    const pad = 14 // .tl-scroll's padding: how far the playhead may stretch
    const y = (await box(page, '#strips')).y + 20
    await page.mouse.move(track.x + track.width / 2, y)
    await page.mouse.down()
    expect(await duration(page, '#playhead')).toBe('0s') // held: 1:1 under the pointer
    await page.mouse.move(track.x + track.width + 80, y, { steps: 4 })
    const end = await restX(page)
    const held = await playheadX(page)
    expect(held).toBeGreaterThan(end + 4) // past the end, it follows a little
    expect(held).toBeLessThan(track.x + track.width + pad - 6) // its 12 px head stays inside the view's padding
    await page.mouse.up()
    expect(await duration(page, '#playhead')).toBe('3s')
    expect(await playheadX(page)).toBeGreaterThan(end + 2) // springing back, not snapped
    // A new press mid-settle takes over at once: the playhead is at the press, not still on its way back.
    const at = track.x + track.width / 4
    await page.mouse.move(at, y)
    await page.mouse.down()
    expect(Math.abs((await playheadX(page)) - (await restX(page)))).toBeLessThan(1.5) // at the pressed Frame, no spring left
    // And past the start.
    await page.mouse.move(track.x - 80, y, { steps: 4 })
    expect(await playheadX(page)).toBeLessThan(track.x - 4)
    await page.mouse.up()
    await setToken(page, '--dur-m', '0.2s')
    await expect.poll(async () => Math.abs((await playheadX(page)) - track.x)).toBeLessThan(1.5) // back at the start
  })
})

test('zoomed in and scrolled just off the start, the stretched playhead stays in view', async () => {
  await withApp(async (page) => {
    await page.locator('#zoom-in').click()
    await page.locator('#tl-scroll').evaluate((el) => (el.scrollLeft = 10))
    const view = await box(page, '#tl-scroll')
    const y = (await box(page, '#strips')).y + 20
    await page.mouse.move(view.x + 100, y)
    await page.mouse.down()
    await page.mouse.move(view.x + 1, y, { steps: 4 })
    // The track's start is 4 px inside the view: no room to stretch, its head would leave the view.
    expect(await page.locator('#playhead').evaluate((el) => getComputedStyle(el).translate)).toMatch(/^(none|0px)$/)
    await page.mouse.up()
  })
})

test('an Audio lane dragged past the start rubber-bands with no transition, then springs back', async () => {
  await withApp(async (page, dir) => {
    await setToken(page, '--dur-m', '3s')
    const lane = await box(page, '#lanes .lane')
    const row = await box(page, '#lanes > div')
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    expect(await duration(page, '#lanes .lane')).toBe('0s')
    await page.mouse.move(lane.x - 40, lane.y + lane.height / 2, { steps: 4 })
    const held = (await box(page, '#lanes .lane')).x
    expect(held).toBeLessThan(row.x - 4)
    expect(held).toBeGreaterThan(row.x - 14)
    // It shows there, not clipped by its row: the point just left of the row is the block.
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.lane') !== null, [row.x - 3, lane.y + lane.height / 2])).toBe(true)
    await page.mouse.up()
    expect(await duration(page, '#lanes .lane')).toMatch(/^3s/)
    expect((await box(page, '#lanes .lane')).x).toBeLessThan(row.x - 2) // springing back
    // A press mid-settle catches the block where it shows; it does not jump to its rest first.
    await page.mouse.move(row.x + 60, lane.y + lane.height / 2)
    const showing = await laneX(page)
    await page.mouse.down()
    const caught = await laneX(page)
    expect(Math.abs(caught - showing)).toBeLessThan(1.5)
    expect(caught).toBeLessThan(row.x - 2)
    await page.mouse.up()
    await setToken(page, '--dur-m', '0.2s')
    await expect.poll(async () => Math.abs(await laneX(page) - row.x)).toBeLessThan(1)

    // Moved: from 0.5 s to past the start. It lands at 0 and the new block springs back from where the old one showed.
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    await page.mouse.move(lane.x + 60 + lane.width / 2, lane.y + lane.height / 2, { steps: 4 }) // the 1 s file is a third of the track
    await page.mouse.up()
    await expect(page.locator('#lanes .lane')).not.toHaveAttribute('aria-valuenow', '0') // laid out anew at its new start
    await expect.poll(async () => await laneX(page)).toBeGreaterThan(row.x + 20)
    await setToken(page, '--dur-m', '3s')
    const from = await box(page, '#lanes .lane')
    await page.mouse.move(from.x + 60, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(row.x - 100 + 60, from.y + from.height / 2, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(300) // the new block is laid out, a tenth into a 3 s settle
    expect((await box(page, '#lanes .lane')).x).toBeLessThan(row.x - 2)
    await setToken(page, '--dur-m', '0.2s')
    await expect.poll(async () => Math.abs(await laneX(page) - row.x)).toBeLessThan(1)

    // Settled, a later edit (Claude moves it to 1 s) lands in one step: no spring left over from the drag.
    await expect.poll(() => page.locator('#lanes .lane').evaluate((el) => el.getAnimations().length), { timeout: 10_000 }).toBe(0) // the 3 s spring ran out
    await setToken(page, '--dur-m', '3s')
    const file = join(dir, 'project.json')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), audio: [{ file: 'tone.wav', start: 1, volume: 1 }] }))
    await expect(page.locator('#lanes .lane')).toHaveAttribute('aria-valuenow', '1')
    const track = await box(page, '#tl-track')
    expect(Math.abs((await laneX(page)) - (track.x + track.width / 1.5))).toBeLessThan(2)
    // Running 0.5 s past the video's end, it is clipped there: the view does not scroll further.
    expect(await page.locator('#tl-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})

test('a save landing mid-drag does not drop the drag: the lane lands where it is let go', async () => {
  await withApp(async (page, dir) => {
    const lane = await box(page, '#lanes .lane')
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    // Claude saves Scene a twice as long (the Project 1.5 s to 2 s): its reload rebuilds the Scene list and the Timeline
    // lays out anew at a new scale, which waits for the release so the block stays under the pointer.
    await page.locator('#scene-list').evaluate((el) => new MutationObserver((_, o) => ((window as any).reloaded = true, o.disconnect())).observe(el, { childList: true }))
    writeFileSync(join(dir, 'a.html'), readFileSync(join(dir, 'a.html'), 'utf8').replace('window.TOTAL = 0.5', 'window.TOTAL = 1'))
    await expect.poll(() => page.evaluate(() => (window as any).reloaded)).toBe(true)
    // Ctrl + wheel while held zooms nothing: its scroll would be set for a layout that waits for the release.
    const track = await box(page, '#tl-track')
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await page.mouse.move(lane.x + 60 + lane.width / 2, lane.y + lane.height / 2, { steps: 4 }) // the 1 s file drawn: 0.5 s on
    await page.mouse.up()
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).audio[0].start).toBeCloseTo(0.5, 1)
    // The move's own edit lays the Timeline out: the lane at its new start, the strips at the new length.
    await expect.poll(() => page.locator('#lanes .lane').getAttribute('aria-valuenow').then(Number)).toBeCloseTo(0.5, 1)
    await expect.poll(async () => (await box(page, '#strips > div')).width / (await box(page, '#strips > div:nth-child(2)')).width).toBeCloseTo(2, 1)
    expect((await box(page, '#tl-track')).width).toBeCloseTo(track.width, 0) // not zoomed: two fits, a rounding apart at most
    const start = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).audio[0].start
    expect(Math.abs((await laneX(page)) - (track.x + (start / 2) * track.width))).toBeLessThan(2) // on the 2 s track
  })
})

test('a save landing while a lane is rubber-banded past the start: let go, it still springs back', async () => {
  await withApp(async (page, dir) => {
    await setToken(page, '--dur-m', '3s')
    const lane = await box(page, '#lanes .lane')
    const row = await box(page, '#lanes > div')
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    await page.mouse.move(lane.x - 40, lane.y + lane.height / 2, { steps: 4 })
    await page.locator('#scene-list').evaluate((el) => new MutationObserver((_, o) => ((window as any).reloaded = true, o.disconnect())).observe(el, { childList: true }))
    writeFileSync(join(dir, 'a.html'), readFileSync(join(dir, 'a.html'), 'utf8') + '\n')
    await expect.poll(() => page.evaluate(() => (window as any).reloaded)).toBe(true)
    await page.mouse.up() // the held-back layout runs now, on a new block
    await expect.poll(() => laneX(page), { timeout: 1000 }).toBeLessThan(row.x - 2) // springing back on a 3 s spring, not snapped
    await setToken(page, '--dur-m', '0.2s')
    await expect.poll(async () => Math.abs((await laneX(page)) - row.x)).toBeLessThan(1)
  })
})

test('dropped where a save mid-drag already put it, the lane is laid out there: no edit, no layout lost', async () => {
  await withApp(async (page, dir) => {
    const lane = await box(page, '#lanes .lane')
    const track = await box(page, '#tl-track')
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    await page.locator('#scene-list').evaluate((el) => new MutationObserver((_, o) => ((window as any).reloaded = true, o.disconnect())).observe(el, { childList: true }))
    const file = join(dir, 'project.json')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), audio: [{ file: 'tone.wav', start: 0.5, volume: 1 }] }))
    await expect.poll(() => page.evaluate(() => (window as any).reloaded)).toBe(true)
    await page.mouse.move(lane.x + 60 + (0.5 / 1.5) * track.width, lane.y + lane.height / 2, { steps: 4 }) // to 0.5 s
    await page.mouse.up()
    await expect(page.locator('#lanes .lane')).toHaveAttribute('aria-valuenow', '0.5')
    await expect.poll(async () => Math.abs((await laneX(page)) - (track.x + track.width / 3))).toBeLessThan(2)
  })
})

test('a save mid-drag moves the lane, the user lets go back at its old start: that start is written back', async () => {
  await withApp(async (page, dir) => {
    const lane = await box(page, '#lanes .lane')
    const track = await box(page, '#tl-track')
    const y = lane.y + lane.height / 2
    await page.mouse.move(lane.x + 60, y)
    await page.mouse.down()
    await page.locator('#scene-list').evaluate((el) => new MutationObserver((_, o) => ((window as any).reloaded = true, o.disconnect())).observe(el, { childList: true }))
    const file = join(dir, 'project.json')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), audio: [{ file: 'tone.wav', start: 0.5, volume: 1 }] }))
    await expect.poll(() => page.evaluate(() => (window as any).reloaded)).toBe(true)
    await page.mouse.move(lane.x + 60 + (0.3 / 1.5) * track.width, y, { steps: 4 }) // a drag, not a click
    await page.mouse.move(lane.x + 60, y, { steps: 4 }) // and back to 0 s
    await page.mouse.up()
    await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).audio[0].start).toBe(0)
    await expect(page.locator('#lanes .lane')).toHaveAttribute('aria-valuenow', '0')
  })
})

test('a click on a lane while a save moves it writes nothing: the lane goes where the save put it', async () => {
  await withApp(async (page, dir) => {
    const lane = await box(page, '#lanes .lane')
    const track = await box(page, '#tl-track')
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    await page.locator('#scene-list').evaluate((el) => new MutationObserver((_, o) => ((window as any).reloaded = true, o.disconnect())).observe(el, { childList: true }))
    const file = join(dir, 'project.json')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), audio: [{ file: 'tone.wav', start: 0.5, volume: 1 }] }))
    await expect.poll(() => page.evaluate(() => (window as any).reloaded)).toBe(true)
    await page.mouse.up()
    // The held-back layout runs on release from the page's own list, which a click's edit would have set first (saveAudio
    // changes it before its await): laid out at 0.5, nothing was written.
    await expect(page.locator('#lanes .lane')).toHaveAttribute('aria-valuenow', '0.5')
    await expect.poll(async () => Math.abs((await laneX(page)) - (track.x + track.width / 3))).toBeLessThan(2)
    expect(JSON.parse(readFileSync(file, 'utf8')).audio[0].start).toBe(0.5)
  })
})

test('rubber-banded and let go with no save, its spring done: a later edit moves the lane in one step', async () => {
  await withApp(async (page, dir) => {
    await setToken(page, '--dur-m', '0.3s')
    const lane = await box(page, '#lanes .lane')
    await page.mouse.move(lane.x + 60, lane.y + lane.height / 2)
    await page.mouse.down()
    await page.mouse.move(lane.x - 40, lane.y + lane.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => page.locator('#lanes .lane').evaluate((el) => el.getAnimations().length)).toBe(0) // sprung back
    await setToken(page, '--dur-m', '3s')
    const file = join(dir, 'project.json')
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), audio: [{ file: 'tone.wav', start: 1, volume: 1 }] }))
    await expect(page.locator('#lanes .lane')).toHaveAttribute('aria-valuenow', '1')
    const track = await box(page, '#tl-track')
    expect(Math.abs((await laneX(page)) - (track.x + track.width / 1.5))).toBeLessThan(2)
  })
})

test('on a long Project at fit, the stretched playhead stays inside the padding: the view never scrolls further', async () => {
  await withApp(async (page) => {
    const track = await box(page, '#tl-track')
    const y = (await box(page, '#strips')).y + 20
    const width = () => page.locator('#tl-scroll').evaluate((el) => el.scrollWidth)
    const before = await width()
    await page.mouse.move(track.x + track.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width + 200, y, { steps: 4 })
    expect(await playheadX(page)).toBeGreaterThan(track.x + track.width + 2) // stretched
    expect(await width()).toBe(before)
    await page.mouse.up()
  }, 60) // 3 min: a Frame is a fraction of a pixel, so the last Frame sits at the track's very end
})

test('reduced motion: past the end the playhead still stretches, and on release it snaps back', async () => {
  await withApp(async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setToken(page, '--dur-m', '3s')
    const track = await box(page, '#tl-track')
    const y = (await box(page, '#strips')).y + 20
    await page.mouse.move(track.x + track.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width + 80, y, { steps: 4 })
    const end = await restX(page)
    expect(await playheadX(page)).toBeGreaterThan(end + 4)
    await page.mouse.up()
    expect(Math.abs((await playheadX(page)) - end)).toBeLessThan(1.5)
  })
})

test('Ctrl + wheel zooms about the pointer: the time under it stays under it', async () => {
  await withApp(async (page) => {
    const timeAt = async (x: number) => {
      const t = await box(page, '#tl-track')
      return ((x - t.x) / t.width) * 1.5
    }
    const track = await box(page, '#tl-track')
    const x = Math.round(track.x + track.width * 0.6) // a mouse event lands on a whole pixel
    const before = await timeAt(x)
    await page.mouse.move(x, (await box(page, '#strips')).y + 20)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect.poll(async () => (await box(page, '#tl-track')).width).toBeGreaterThan(track.width * 1.5)
    expect(Math.abs((await timeAt(x)) - before) * ((await box(page, '#tl-track')).width / 1.5)).toBeLessThan(1) // under 1 px off
  })
})

test('play / pause and mute swap their icon at a glance, a cross-fade on the motion tokens', async () => {
  await withApp(async (page) => {
    const opacity = (selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).opacity)
    await expect.poll(() => opacity('#play .play')).toBe('1')
    expect(await opacity('#play .pause')).toBe('0')
    await page.locator('#play').click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Pause')
    await expect.poll(() => opacity('#play .pause')).toBe('1')
    await expect.poll(() => opacity('#play .play')).toBe('0')
    await page.keyboard.press('Space')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play')
    await expect.poll(() => opacity('#play .play')).toBe('1')

    await page.locator('#mute').click()
    await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => opacity('#mute .off')).toBe('1')
    await expect.poll(() => opacity('#mute .on')).toBe('0')
    await setToken(page, '--dur-fast', '3s')
    expect(await duration(page, '#mute .on')).toMatch(/^3s/)
  }, 5) // 15 s: playback never reaches the end and pauses itself mid-test
})
