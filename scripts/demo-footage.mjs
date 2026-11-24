// Raw footage for the KapeCut demo film, recorded at 2x in one run of the real app, in two parts:
// 1. UGC walkthrough (scripts/ugc-demo.mjs around <clip.mp4>): an empty folder with a brief and the clip, Connect, the
//    Scenes landing one by one as Claude would write them, play, a Note pinned on a caption that covers the face, Copy
//    Prompt, the fix landing and the Note ticked off, Export.
// 2. The Lumen 3D ad (scripts/readme-demo.mjs), shorter: opened from the Projects menu, its Scenes land, play, Export.
// Writes to <out>: footage.mp4 (H.264, a keyframe every 12 frames for seeking), marks.json (each step's time in seconds
// of footage.mp4 and the boxes of what it touches, in page px), ugc.mp4 and lumen.mp4 (the two Exports).
// Usage: npm run footage:demo -- <out> <clip.mp4>   (the clip: a vertical talking-head video, at least 16 s long)
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readyEnv from './ready-env.mjs'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node
const out = resolve(process.argv[2] ?? '.scratch/demo-footage')
const clip = process.argv[3] && resolve(process.argv[3])
if (!clip) throw new Error('Usage: npm run footage:demo -- <out> <clip.mp4>')
mkdirSync(out, { recursive: true })
const dropEnv = readyEnv()
const root = mkdtempSync(join(tmpdir(), 'kapecut-demo-'))
process.on('exit', () => rmSync(root, { recursive: true, force: true })) // a failed run too
const stagedUgc = join(root, 'staged-ugc')
const stagedLumen = join(root, 'staged-lumen')
execFileSync(process.execPath, ['scripts/ugc-demo.mjs', stagedUgc, clip], { stdio: 'ignore' })
execFileSync(process.execPath, ['scripts/readme-demo.mjs', stagedLumen], { stdio: 'ignore' })
const ugc = join(root, 'lumen-ugc')
const lumen = join(root, 'lumen-launch')
for (const [dir, staged, files] of [[ugc, stagedUgc, ['brief.md', 'speaker.mp4']], [lumen, stagedLumen, ['brief.md', 'click.wav']]]) {
  mkdirSync(dir)
  for (const f of files) copyFileSync(join(staged, f), join(dir, f))
}
const W = 1440, H = 900, SCALE = 2 // recorded at 2x so the film can push in without blur
const video = join(root, 'video')
const app = await electron.launch({
  args: ['.', `--user-data-dir=${join(root, 'user')}`, `--force-device-scale-factor=${SCALE}`],
  env: { ...process.env, KAPECUT_PROJECT: ugc },
  recordVideo: { dir: video, size: { width: W * SCALE, height: H * SCALE } },
})
// A hung run (an Export that never ends) closes the app and exits instead of holding the machine.
setTimeout(() => (console.error('demo-footage: 15 min deadline'), app.close().finally(() => process.exit(1))), 15 * 60_000).unref()
// The save dialog answers with the next Export's path.
const saveTo = (file) => app.evaluate(({ dialog }, filePath) => void (dialog.showSaveDialog = async () => ({ canceled: false, filePath })), file)
const marks = []
let t0
const box = async (page, sel) => (sel ? await page.locator(sel).first().boundingBox() : null)
const mark = async (page, name, ...sels) => {
  const t = (Date.now() - t0) / 1000 // before the boxes are read, which takes a few ms each
  const boxes = {}
  for (const s of sels) boxes[s] = await box(page, s)
  marks.push({ name, t, boxes })
}
const hold = (page, ms) => page.waitForTimeout(ms)

// Claude writes a Project one Scene at a time: each Scene file, then project.json listing it.
async function landScenes(page, dir, staged, support = []) {
  for (const f of support) copyFileSync(join(staged, f), join(dir, f))
  const project = JSON.parse(readFileSync(join(staged, 'project.json'), 'utf8'))
  for (let i = 0; i < project.scenes.length; i++) {
    copyFileSync(join(staged, project.scenes[i]), join(dir, project.scenes[i]))
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...project, scenes: project.scenes.slice(0, i + 1) }, null, 2))
    await page.locator(`#scene-list li:nth-child(${i + 1})`).waitFor({ timeout: 30_000 })
    await mark(page, `scene:${project.scenes[i]}`, '#scene-list', '#strips')
    await hold(page, 1400)
  }
  await page.locator('#export:enabled').waitFor({ timeout: 30_000 })
}
async function exportTo(page, file, name) {
  await saveTo(file)
  await page.locator('#export').click()
  await mark(page, `${name}:export`, '#export', '#export-status')
  await page.locator('#export-status').filter({ hasText: /^Exported / }).waitFor({ timeout: 180_000 })
  await mark(page, `${name}:exported`, '#export-status')
}

let page
try {
  page = await app.firstWindow()
  t0 = Date.now()
  // Not this machine's temp paths: the Files panel's folder and the Exported status show ~/Videos/<name> instead. An
  // observer rewrites them before they paint; the page reloads whenever project.json changes, so this runs on every load.
  await page.addInitScript(() => {
    const mask = () => {
      const path = document.getElementById('files-path')
      if (path?.textContent && !path.textContent.startsWith('~')) path.textContent = path.title = '~/Videos/' + path.textContent.split(/[\\/]/).pop()
      const status = document.getElementById('export-status')
      if (status?.textContent?.startsWith('Exported ') && !status.textContent.includes('~')) status.textContent = 'Exported ~/Videos/' + status.textContent.split(/[\\/]/).pop()
    }
    new MutationObserver(mask).observe(document, { subtree: true, childList: true, characterData: true })
  })
  await page.reload()
  await page.setViewportSize({ width: W, height: H })
  await page.locator('.set-up').waitFor({ timeout: 30_000 })
  // Sync flash: a magenta square in the top-left corner for 0.5 s. Its first frame in the recording gives the offset
  // between Date.now() and the video's clock (the recording starts before firstWindow resolves).
  await page.evaluate(() => new Promise((done) => {
    const sq = Object.assign(document.createElement('div'), { id: 'sync' })
    Object.assign(sq.style, { position: 'fixed', left: '0', top: '0', width: '10px', height: '10px', background: '#f0f', zIndex: '99999' })
    document.body.append(sq)
    requestAnimationFrame(() => requestAnimationFrame(done))
  }))
  await mark(page, 'sync')
  await hold(page, 500)
  await page.evaluate(() => document.getElementById('sync').remove())
  await hold(page, 1000)

  // 1. UGC walkthrough.
  await mark(page, 'ugc:empty', '#files', '#view', '#connect')
  await page.locator('#connect').click()
  await mark(page, 'ugc:connect', '#connect', '#toast')
  await hold(page, 1800)
  mkdirSync(join(ugc, '.kapecut'), { recursive: true })
  copyFileSync(join(stagedLumen, '.kapecut', 'claude.json'), join(ugc, '.kapecut', 'claude.json'))
  await hold(page, 1500)
  await mark(page, 'ugc:connected', '#connect', '#claude-status')
  await landScenes(page, ugc, stagedUgc, ['ugc.js'])
  await hold(page, 1200)
  await mark(page, 'ugc:ready', '#scene-list', '#view', '#timeline')

  await page.locator('#play').click()
  await mark(page, 'ugc:play', '#play', '#view')
  await hold(page, 7000)
  await page.locator('#play').click()
  await page.locator('#scrub').evaluate((el) => ((el.value = '7.6'), el.dispatchEvent(new Event('input')))) // the close-up, its caption on the mouth
  await hold(page, 900)
  await mark(page, 'ugc:paused', '#marks', '#scrub')

  // A Note on the caption: N, a click on it, the text.
  await page.keyboard.press('n')
  const m = await page.locator('#marks').boundingBox()
  const at = [m.x + (540 / 1080) * m.width, m.y + (1000 / 1920) * m.height]
  await hold(page, 500)
  await page.mouse.click(...at)
  await mark(page, 'ugc:pin', '#marks')
  marks.at(-1).point = { x: at[0], y: at[1] }
  await page.locator('#note-pop textarea').waitFor()
  await hold(page, 400)
  await page.keyboard.type('Caption covers the face, move it lower', { delay: 45 })
  await hold(page, 300)
  await mark(page, 'ugc:typed', '#note-pop')
  await page.keyboard.press('Enter')
  await page.locator('#note-list li').first().waitFor()
  await hold(page, 900)
  await mark(page, 'ugc:noted', '#note-list', '#copy-prompt')

  await page.locator('#copy-prompt').click()
  await mark(page, 'ugc:copied', '#copy-prompt', '#toast')
  await hold(page, 2200)

  // Claude's fix: the caption moves down off the face, then the Note is set done in notes.json.
  const cta = join(ugc, 'cta.html')
  await page.evaluate(() => (window.before = document.querySelector('iframe')?.contentDocument))
  writeFileSync(cta, readFileSync(cta, 'utf8').replace('const CAP_Y = 1000', 'const CAP_Y = 1560'))
  await mark(page, 'ugc:fixed', '#view', '#claude-status')
  // The Scene reloads and starts its video decoder again, black until then: wait for the new page to draw.
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe')?.contentDocument
    const c = doc !== window.before && doc?.querySelector('canvas')
    return !!c && c.getContext('2d').getImageData(c.width / 2, c.height / 4, 1, 1).data[0] > 0
  }, null, { timeout: 15_000 })
  await mark(page, 'ugc:redrawn', '#view')
  await hold(page, 1500)
  const notes = JSON.parse(readFileSync(join(ugc, 'notes.json'), 'utf8'))
  notes.notes[0].done = true
  writeFileSync(join(ugc, 'notes.json'), JSON.stringify(notes, null, 2))
  await page.locator('#note-list .pin.done').waitFor({ timeout: 15_000 })
  await mark(page, 'ugc:done', '#note-list')
  await hold(page, 1800)
  await exportTo(page, join(root, 'ugc.mp4'), 'ugc')
  await hold(page, 2000)

  // 2. The Lumen 3D ad: open its folder, Claude already connected there, the Scenes land, play, Export.
  mkdirSync(join(lumen, '.kapecut'), { recursive: true })
  copyFileSync(join(stagedLumen, '.kapecut', 'claude.json'), join(lumen, '.kapecut', 'claude.json'))
  await app.evaluate(({ dialog }, filePath) => void (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })), lumen)
  await page.locator('#projects summary').click()
  await mark(page, 'lumen:menu', '#projects')
  await hold(page, 700)
  await page.locator('#open-folder').click()
  await page.locator('#project').filter({ hasText: 'lumen-launch' }).waitFor({ timeout: 15_000 })
  await mark(page, 'lumen:open', '#project', '#files')
  await hold(page, 1200)
  await landScenes(page, lumen, stagedLumen, ['three.js', 'lumen.js'])
  await hold(page, 1000)
  await mark(page, 'lumen:ready', '#scene-list', '#view', '#timeline')
  await page.locator('#play').click()
  await mark(page, 'lumen:play', '#play', '#view')
  await hold(page, 8300)
  await exportTo(page, join(root, 'lumen.mp4'), 'lumen')
  await hold(page, 2000)
  await mark(page, 'end')
} catch (e) {
  await page?.screenshot({ path: join(out, 'fail.png') })
  throw e
} finally {
  await app.close()
  dropEnv()
}
const [webm] = readdirSync(video)
const raw = join(video, webm)
// The sync square's first frame: the first whose top-left corner is magenta (red and blue high, green low).
const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 1 << 28, timeout: 600_000 })
const corner = ffmpeg(['-i', raw, '-t', '20', '-vf', 'crop=8:8:4:4,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-fps_mode', 'passthrough', '-'])
const times = execFileSync('ffprobe', ['-v', 'error', '-read_intervals', '%+20', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', raw], { encoding: 'utf8', timeout: 120_000 }).trim().split(/\s+/).map(Number)
const first = times.findIndex((_, i) => corner[i * 3] > 200 && corner[i * 3 + 1] < 80 && corner[i * 3 + 2] > 200)
if (first < 0) throw new Error('sync square not found in the recording')
const offset = Math.round((times[first] - marks.find((x) => x.name === 'sync').t) * 1000) / 1000
for (const x of marks) x.t = Math.round((x.t + offset) * 1000) / 1000
ffmpeg(['-y', '-i', raw, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-g', '12', '-pix_fmt', 'yuv420p', '-an', join(out, 'footage.mp4')])
copyFileSync(join(root, 'ugc.mp4'), join(out, 'ugc.mp4'))
copyFileSync(join(root, 'lumen.mp4'), join(out, 'lumen.mp4'))
writeFileSync(join(out, 'marks.json'), JSON.stringify({ size: { w: W, h: H }, scale: SCALE, offset, marks }, null, 2))
console.log(out, `marks shifted by ${offset.toFixed(3)} s to the video's clock`)
