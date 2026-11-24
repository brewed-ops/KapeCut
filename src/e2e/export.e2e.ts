import { expect, test } from '@playwright/test'
import { answerSave, launch } from './launch'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Audio } from '../renderer/viewer/project'

// Sizes canvas#c for ?scale= as ADR 0001 says, so the Scene draws at the Export resolution. `c` is the canvas.
const scaled = (w: number, h: number) => `const k = Number(new URLSearchParams(location.search).get('scale') ?? 1)
  const c = document.getElementById('c')
  c.width = 2 * Math.round((${w} * k) / 2)
  c.height = 2 * Math.round((${h} * k) / 2)`

// A Project with one Scene lasting `total` seconds at 1080x1920, 30 fps.
function project(total: number) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 1080, h: 1920 }, fps: 30, scenes: ['one.html'] }))
  writeFileSync(
    join(dir, 'one.html'),
    `<canvas id="c"></canvas><script>
      ${scaled(1080, 1920)}
      const g = c.getContext('2d')
      g.scale(k, k) // then every draw call uses Design size coordinates
      window.TOTAL = ${total}
      window.renderAt = (t) => { g.fillStyle = '#12100e'; g.fillRect(0, 0, 1080, 1920); g.fillStyle = '#f0a726'; g.fillRect(0, t * 1000, 1080, 200) }
    </script>`,
  )
  return dir
}

// A Project of Scenes with the given lengths (seconds) at 320x240, 30 fps, each its own colour.
function scenes(lengths: number[]) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const files = lengths.map((_, i) => `s${i}.html`)
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 320, h: 240 }, fps: 30, scenes: files }))
  lengths.forEach((total, i) => writeFileSync(join(dir, files[i]), sceneHtml(total, ['#ff0000', '#00ff00', '#0000ff'][i % 3])))
  return dir
}
const sceneHtml = (total: number, color: string) => `<canvas id="c"></canvas><script>
  ${scaled(320, 240)}
  const g = c.getContext('2d')
  window.TOTAL = ${total}
  window.renderAt = () => { g.fillStyle = '${color}'; g.fillRect(0, 0, c.width, c.height) }
</script>`
// A 3 s Scene at Design size w x h that holds Frame 30 (t = 1) until openGate(), only while an Export runs (its button
// reads Cancel), so a viewer draw at t = 1 never hangs.
const heldScene = (w = 320, h = 240) => `<canvas id="c"></canvas><script>
  ${scaled(w, h)}
  window.TOTAL = 3
  let open; const gate = new Promise((r) => (open = r)); window.openGate = () => open()
  const exporting = () => parent.document.getElementById('export-label').textContent === 'Cancel'
  window.renderAt = async (t) => { if (t === 1 && exporting()) { window.held = true; await gate } }
</script>`

const probe = (out: string) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', out], { encoding: 'utf8' }),
  )

// [r, g, b] of the pixel at the left edge, row y, of video Frame n.
const pixelAt = (out: string, n: number, y = 0) => [
  ...execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select=eq(n\\,${n}),crop=2:2:0:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3),
]
const near = (px: number[], rgb: number[]) => px.every((v, i) => Math.abs(v - rgb[i]) < 40)

const scratchLeft = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('.kapecut-export-'))

test('EXPORT writes a 1 s Scene as a faststart H.264 MP4 with BT.709 tags', async () => {
  const dir = project(1)
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  await app.close()

  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }),
  ).streams[0]
  expect(probe).toMatchObject({
    codec_name: 'h264',
    width: 1080,
    height: 1920,
    nb_read_frames: '30',
    color_space: 'bt709',
    color_transfer: 'bt709',
    color_primaries: 'bt709',
  })
  // No audio in the Project: video only, no empty audio track.
  expect(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim()).toBe('video')
  const bytes = readFileSync(out).toString('latin1')
  expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'))
  expect(scratchLeft(dir)).toEqual([])
})

test('Export resolution: all four listed, 1080p by default; 720p draws the Scene at 720x1280', async () => {
  const dir = project(1)
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  const picker = page.locator('#resolution')
  await expect(picker.locator('option')).toHaveText([/^720p/, /^1080p/, /^1440p/, /^4K/])
  expect(await picker.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).title))).toEqual(['720x1280', '1080x1920', '1440x2560', '2160x3840'])
  await expect(picker).toHaveValue('1080p')
  await picker.selectOption('720p')
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  await app.close()

  expect(probe(out).streams[0]).toMatchObject({ codec_name: 'h264', width: 720, height: 1280, nb_read_frames: '30' })
  // The Scene drew in Design size coordinates scaled by 2/3: its 200 px amber bar ends at row 133, not at 200.
  expect(near(pixelAt(out, 0, 0), [240, 167, 38])).toBe(true)
  expect(near(pixelAt(out, 0, 140), [18, 16, 14])).toBe(true)
})

test('a Scene that ignores ?scale is refused before the save dialog, saying how to size its canvas', async () => {
  const dir = project(1)
  writeFileSync(
    join(dir, 'one.html'),
    `<canvas id="c" width="1080" height="1920"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>`,
  )
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#resolution').selectOption('720p')
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/one\.html: Scene canvas is 1080x1920, \?scale=0\.667 needs 720x1280/)
  await expect(page.locator('iframe[data-export]')).toHaveCount(0) // its Export pages are gone
  await expect(page.locator('#export')).toBeEnabled()
  await app.close()
  expect(existsSync(out)).toBe(false)
})

test('Export can be cancelled while it opens the Scenes at another resolution', async () => {
  const dir = project(1)
  // Never ready at ?scale=, so the Export waits on it; the viewer (no ?scale=) opens it as usual.
  writeFileSync(
    join(dir, 'one.html'),
    `<canvas id="c" width="1080" height="1920"></canvas><script>
      window.TOTAL = 1; window.renderAt = () => {}
      if (location.search.includes('scale=')) window.ready = new Promise(() => {})
    </script>`,
  )
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#resolution').selectOption('720p')
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText('Opening Scenes at 720x1280')
  await expect(page.locator('#export')).toHaveText(/Cancel/)
  await expect(page.locator('#resolution')).toBeDisabled()
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText('Export cancelled')
  await expect(page.locator('iframe[data-export]')).toHaveCount(0)
  await expect(page.locator('#export')).toHaveText(/Export/)
  await expect(page.locator('#resolution')).toBeEnabled()
  await app.close()
  expect(existsSync(out)).toBe(false)
})

// At the Design size the viewer's own page draws the Export; at any other size a page of its own does.
for (const [where, w, h, drawer] of [['Design size', 1080, 1920, 'scene'], ['another resolution', 320, 240, 'export']] as const) {
  test(`cancel leaves no half-written file and keeps the file it would have replaced (${where})`, async () => {
    const dir = scenes([3])
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w, h }, fps: 30, scenes: ['s0.html'] }))
    // Held mid-file until the test lets it go, so Cancel never lands after the last Frame or races the progress %.
    writeFileSync(join(dir, 's0.html'), heldScene(w, h))
    const out = join(mkdtempSync(join(tmpdir(), 'kapecut-out-')), 'out.mp4') // outside the Project, as e2e.md says
    writeFileSync(out, 'the user already had this file')
    const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
    const scene = page.locator(`iframe[data-${drawer}="s0.html"]`) // the page the Export draws from
    await page.locator('#export').click()
    await expect.poll(() => scene.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).held), { timeout: 15_000 }).toBe(true)
    await expect(page.locator('#export-status')).toHaveText('Exporting 33%') // Frames 0-29 of 90
    expect(scratchLeft(dirname(out))).toHaveLength(1) // the scratch file Cancel must remove
    await page.locator('#export').click()
    await scene.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).openGate())
    await expect(page.locator('#export-status')).toHaveText('Export cancelled')
    await app.close()
    expect(readFileSync(out, 'utf8')).toBe('the user already had this file')
    expect(scratchLeft(dirname(out))).toEqual([])
  })
}

test('missing ffmpeg gives a clear message', async () => {
  const dir = project(1)
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  // Gone since launch (the Setup window keeps the editor shut while it is missing at launch).
  await app.evaluate(() => void (process.env.PATH = ''))
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText('ffmpeg is not on PATH. Export encodes the MP4 with it. Install it, then restart KapeCut')
  await app.close()
  expect(existsSync(out)).toBe(false)
})

test('EXPORT joins every Scene in order into one MP4: summed Frames, same tags', async () => {
  const dir = scenes([0.5, 1, 0.34]) // 15 + 30 + 11 Frames
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  await app.close()

  const { streams, format } = probe(out)
  expect(streams[0]).toMatchObject({
    codec_name: 'h264',
    width: 1440, // 1080p, the default, is the short side: 320x240 scaled by 4.5
    height: 1080,
    nb_read_frames: '56',
    color_space: 'bt709',
    color_transfer: 'bt709',
    color_primaries: 'bt709',
  })
  expect(Number(format.duration)).toBeCloseTo(56 / 30, 2)
  // Each cut lands on the right Frame: 14 red | 15 green, 44 green | 45 blue.
  const cuts: [number, number[]][] = [[14, [255, 0, 0]], [15, [0, 255, 0]], [44, [0, 255, 0]], [45, [0, 0, 255]]]
  for (const [n, rgb] of cuts) expect(near(pixelAt(out, n), rgb), `Frame ${n}`).toBe(true)
  const bytes = readFileSync(out).toString('latin1')
  expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'))
  expect(scratchLeft(dir)).toEqual([])
})

test('a save during Export applies after it, never mid-file', async () => {
  const dir = scenes([0.5, 3, 0.5])
  const projectJson = (name: string) => JSON.stringify({ name, size: { w: 320, h: 240 }, fps: 30, scenes: ['s0.html', 's1.html', 's2.html'] })
  writeFileSync(join(dir, 'project.json'), projectJson('Before'))
  // The middle Scene holds its Frame 30 (t = 1: load draws 0 and the thumbnail 1.5, only Export draws 1) until the test
  // lets it go, so the Export is certainly still running when the saves arrive, however fast the machine.
  writeFileSync(
    join(dir, 's1.html'),
    `<canvas id="c"></canvas><script>
      ${scaled(320, 240)}
      const g = c.getContext('2d')
      window.TOTAL = 3
      let open; const gate = new Promise((r) => (open = r)); window.openGate = () => open()
      window.renderAt = async (t) => { if (t === 1) { window.held = true; await gate } g.fillStyle = '#00ff00'; g.fillRect(0, 0, c.width, c.height) }
    </script>`,
  )
  // Outside the Project folder: the Export's scratch files would otherwise reach the viewer as saves of their own.
  const out = join(mkdtempSync(join(tmpdir(), 'kapecut-out-')), 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  const middle = () => page.locator('iframe[data-export="s1.html"]') // the page the Export draws from
  await expect(page).toHaveTitle('Before - KapeCut')
  await page.locator('#export').click()
  await expect.poll(() => middle().evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).held), { timeout: 15_000 }).toBe(true)

  writeFileSync(join(dir, 'project.json'), projectJson('After'))
  // The viewer has the save. Had it run now, reading project.json would already have retitled the window: that
  // happens in the same task as the save arriving, so no wait is needed to see it.
  await expect(page.locator('#export-status')).toHaveText(/^Exporting \d+% · saves apply after Export$/)
  expect(await page.title()).toBe('Before - KapeCut')

  writeFileSync(join(dir, 's1.html'), sceneHtml(1, '#ffff00'))
  writeFileSync(join(dir, 's2.html'), sceneHtml(2, '#ffff00'))
  await middle().evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).openGate())
  await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  expect(probe(out).streams[0].nb_read_frames).toBe(String(15 + 90 + 15))
  expect(near(pixelAt(out, 15 + 90), [0, 0, 255])).toBe(true) // the last Scene as it was, not the saved yellow
  // Then the saves land.
  await expect(page).toHaveTitle('After - KapeCut')
  await expect(page.locator('#scene-list .eyebrow').nth(1)).toHaveText(/1\.00s · 30 F/)
  await expect(page.locator('#scene-list .eyebrow').nth(2)).toHaveText(/2\.00s · 60 F/)
  await app.close()
})

test('Export refuses an empty video or a broken project.json before the save dialog, and offers a name Windows accepts', async () => {
  const dir = scenes([0])
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  const asked = () => app.evaluate(() => (globalThis as any).asked as string[])
  await app.evaluate(({ dialog }) => {
    ;(globalThis as any).asked = []
    dialog.showSaveDialog = (async (_w: unknown, o: { defaultPath: string }) => ((globalThis as any).asked.push(o.defaultPath), { canceled: true })) as any
  })
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/video has no length/)

  writeFileSync(join(dir, 's0.html'), sceneHtml(0.5, '#ff0000'))
  writeFileSync(join(dir, 'project.json'), '{')
  await expect(page.locator('.error')).toContainText('project.json')
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/project\.json has an error/)
  expect(await asked()).toEqual([])

  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Client/Launch: v2', size: { w: 320, h: 240 }, fps: 30, scenes: ['s0.html'] }))
  await expect(page.locator('.error')).toHaveCount(0)
  await page.locator('#export').click()
  await expect.poll(asked).toEqual(['Client-Launch- v2.mp4'])
  await app.close()
  expect(existsSync(out)).toBe(false)
})

test('opening another Project while the save dialog is open is refused', async () => {
  const dir = scenes([0.5])
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(join(dir, 'out.mp4')) })
  await app.evaluate(({ dialog }) => {
    ;(globalThis as any).opened = 0
    ;(globalThis as any).asked = false
    dialog.showSaveDialog = (() => (((globalThis as any).asked = true), new Promise(() => {}))) as any // the user is still choosing
    dialog.showOpenDialog = (async () => ((globalThis as any).opened++, { canceled: true, filePaths: [] })) as any
  })
  await page.locator('#export').click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).asked)).toBe(true) // past the Scene reopen, at the dialog
  await page.locator('#projects > summary').click()
  await page.locator('#open-folder').click()
  await expect(page.locator('#export-status')).toHaveText('Cancel the Export before opening another Project')
  expect(await app.evaluate(() => (globalThis as any).opened)).toBe(0)
  await app.close()
})

test('an Export still queued behind a Scene reload already refuses opening another Project', async () => {
  const dir = scenes([0.5])
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(join(dir, 'out.mp4')) })
  await app.evaluate(({ dialog }) => {
    ;(globalThis as any).opened = 0
    dialog.showOpenDialog = (async () => ((globalThis as any).opened++, { canceled: true, filePaths: [] })) as any
  })
  // Claude saves the Scene; its reload holds the queue until the test opens the gate.
  writeFileSync(
    join(dir, 's0.html'),
    sceneHtml(0.5, '#00ff00').replace('window.renderAt = () => {', 'let open; const gate = new Promise((r) => (open = r)); window.openGate = () => open()\n  window.renderAt = async () => { await gate;'),
  )
  const frame = page.locator('iframe[data-scene="s0.html"]')
  await expect.poll(() => frame.evaluate((f: HTMLIFrameElement) => typeof (f.contentWindow as any).openGate).catch(() => null)).toBe('function')
  await page.locator('#export').click()
  await page.locator('#projects > summary').click()
  await page.locator('#open-folder').click()
  await expect(page.locator('#export-status')).toHaveText('Cancel the Export before opening another Project')
  expect(await app.evaluate(() => (globalThis as any).opened)).toBe(0)
  await frame.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).openGate())
  await app.close()
})

// Adds an audio list to the Project's project.json.
const withAudio = (dir: string, audio: Audio[]) =>
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')), audio }))

// 1080p is the Design size (the viewer's own pages draw), 720p opens every Scene again at ?scale=.
for (const resolution of ['1080p', '720p']) {
  test(`EXPORT at ${resolution} mixes the Audio file into one AAC track as long as the video, at its start`, async () => {
    const dir = project(2)
    // 0.3 s of a 1 kHz sine, a second in.
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.3', join(dir, 'tone.wav')])
    withAudio(dir, [{ file: 'tone.wav', start: 1, volume: 1 }])
    const out = join(dir, 'out.mp4')
    const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
    await page.locator('#resolution').selectOption(resolution)
    await page.locator('#export').click()
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
    await app.close()

    const all = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out], { encoding: 'utf8' })).streams
    expect(all.map((s: { codec_name: string }) => s.codec_name)).toEqual(['h264', 'aac'])
    expect(all[0].width).toBe(resolution === '720p' ? 720 : 1080)
    expect(Number(all[1].duration)).toBeCloseTo(Number(all[0].duration), 1)
    // The tone's first sound, found by silencedetect: where the opening silence ends.
    const log = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-map', '0:a', '-af', 'silencedetect=n=-50dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
    expect(Number(/silence_end: ([\d.]+)/.exec(log)?.[1])).toBeCloseTo(1, 1)
    expect(scratchLeft(dir)).toEqual([])
  })
}

test('a missing Audio file stops Export with its name before the Scenes reopen at another size or the save dialog', async () => {
  const dir = scenes([0.5])
  withAudio(dir, [{ file: 'gone.wav', start: 0, volume: 1 }])
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await app.evaluate(({ dialog }) => {
    ;(globalThis as any).asked = 0
    dialog.showSaveDialog = (async () => ((globalThis as any).asked++, { canceled: true })) as any
  })
  // Every status the Export shows, so the test sees whether it ever got as far as opening Scenes.
  await page.evaluate(() => {
    const status = document.getElementById('export-status')!
    ;(window as any).seen = []
    new MutationObserver(() => (window as any).seen.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true })
  })
  await page.locator('#export').click() // 320x240 at the default 1080p: the Scenes would reopen at ?scale=
  await expect(page.locator('#export-status')).toHaveText(/Audio file gone\.wav is missing from the Project/)
  expect(await page.evaluate(() => (window as any).seen.join('|'))).not.toMatch(/Opening Scenes/)
  expect(await app.evaluate(() => (globalThis as any).asked)).toBe(0)
  await app.close()
  expect(existsSync(out)).toBe(false)
  expect(scratchLeft(dir)).toEqual([])
})

test('an Audio file that is not sound stops Export with its name and leaves no file', async () => {
  const dir = scenes([0.5])
  // The good file's path is the start of the bad one's: the error must still name the bad one.
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.3', '-f', 'wav', join(dir, 'x.wav')])
  writeFileSync(join(dir, 'x.wav.old'), 'not a sound file')
  withAudio(dir, [{ file: 'x.wav', start: 0, volume: 1 }, { file: 'x.wav.old', start: 0, volume: 1 }])
  const out = join(mkdtempSync(join(tmpdir(), 'kapecut-out-')), 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/Audio file x\.wav\.old could not be read/, { timeout: 60_000 })
  await app.close()
  expect(readdirSync(dirname(out))).toEqual([])
})

test('an Audio file deleted while Frames encode stops Export with its name and leaves no file', async () => {
  const dir = scenes([3])
  writeFileSync(join(dir, 's0.html'), heldScene()) // so the file goes while Frames encode
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.3', join(dir, 'tone.wav')])
  withAudio(dir, [{ file: 'tone.wav', start: 0, volume: 1 }])
  const out = join(mkdtempSync(join(tmpdir(), 'kapecut-out-')), 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  const scene = page.locator('iframe[data-export="s0.html"]') // the page the Export draws from
  await page.locator('#export').click()
  await expect.poll(() => scene.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).held), { timeout: 15_000 }).toBe(true)
  rmSync(join(dir, 'tone.wav'))
  await scene.evaluate((f: HTMLIFrameElement) => (f.contentWindow as any).openGate())
  await expect(page.locator('#export-status')).toHaveText(/Audio file tone\.wav is missing from the Project/, { timeout: 60_000 })
  await app.close()
  expect(readdirSync(dirname(out))).toEqual([])
})

test('a WebGL Scene whose async renderAt waits before drawing exports its Frames, not blank ones', async () => {
  const dir = scenes([0.2])
  // No preserveDrawingBuffer: the buffer is gone once the page composites, so capture must follow the draw directly.
  writeFileSync(
    join(dir, 's0.html'),
    `<canvas id="c"></canvas><script>
      ${scaled(320, 240)}
      const gl = c.getContext('webgl')
      window.TOTAL = 0.2
      window.renderAt = async () => { await new Promise((r) => setTimeout(r, 5)); gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT) }
    </script>`,
  )
  const out = join(dir, 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  await app.close()
  for (const n of [0, 3, 5]) expect(near(pixelAt(out, n), [0, 255, 0]), `Frame ${n}`).toBe(true)
})
