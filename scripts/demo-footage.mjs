// Raw footage for the KapeCut demo film: drives the real app through the whole loop on the Lumen demo Project
// (scripts/readme-demo.mjs) and records it. An empty folder with a brief, the Scenes landing one by one as Claude would
// write them, play, a Note pinned on the lamp's light, Copy Prompt, the fix landing and the Note ticked off, Export.
// Writes <out>/footage.webm, <out>/marks.json (each step's time in the video, in seconds, and the boxes of what it
// touches, in page px) and <out>/lumen.mp4 (the exported ad). Usage: npm run footage:demo -- <out>
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readyEnv from './ready-env.mjs'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node
const out = resolve(process.argv[2] ?? '.scratch/demo-footage')
mkdirSync(out, { recursive: true })
const dropEnv = readyEnv()
const root = mkdtempSync(join(tmpdir(), 'kapecut-demo-'))
const staged = join(root, 'staged')
execFileSync(process.execPath, ['scripts/readme-demo.mjs', staged], { stdio: 'ignore' })
const dir = join(root, 'lumen-launch')
mkdirSync(dir)
for (const f of ['brief.md', 'click.wav']) copyFileSync(join(staged, f), join(dir, f))
const land = (f) => copyFileSync(join(staged, f), join(dir, f))
const W = 1440, H = 900, SCALE = 2 // recorded at 2x so the film can push in without blur
const userData = join(root, 'user')
const video = join(root, 'video')
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`, `--force-device-scale-factor=${SCALE}`],
  env: { ...process.env, KAPECUT_PROJECT: dir },
  recordVideo: { dir: video, size: { width: W * SCALE, height: H * SCALE } },
})
const exported = join(root, 'lumen.mp4')
await app.evaluate(({ dialog }, filePath) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath })
}, exported)
const marks = []
let t0
const box = async (page, sel) => (sel ? await page.locator(sel).first().boundingBox() : null)
const mark = async (page, name, ...sels) => {
  const boxes = {}
  for (const s of sels) boxes[s] = await box(page, s)
  marks.push({ name, t: (Date.now() - t0) / 1000, boxes })
}
const hold = (page, ms) => page.waitForTimeout(ms)
let page
try {
  page = await app.firstWindow()
  t0 = Date.now()
  // Not this machine's temp path: the page reloads whenever project.json changes, so this runs on every load.
  await page.addInitScript(() => {
    setInterval(() => {
      const el = document.getElementById('files-path')
      if (el && el.textContent !== '~/Videos/lumen-launch') el.textContent = '~/Videos/lumen-launch'
    }, 50)
  })
  await page.reload()
  await page.setViewportSize({ width: W, height: H })
  await page.locator('.set-up').waitFor({ timeout: 30_000 })
  await hold(page, 1500)
  await mark(page, 'empty', '#files', '#view', '#connect')

  // Connect Claude: the prompt is copied, then Claude's handshake lands in .kapecut/.
  await page.locator('#connect').click()
  await mark(page, 'connect', '#connect', '#toast')
  await hold(page, 1800)
  mkdirSync(join(dir, '.kapecut'), { recursive: true })
  copyFileSync(join(staged, '.kapecut', 'claude.json'), join(dir, '.kapecut', 'claude.json'))
  await hold(page, 1500)
  await mark(page, 'connected', '#connect', '#claude-status')

  // Claude writes the Project one Scene at a time: each Scene file, then project.json listing it.
  const project = JSON.parse(readFileSync(join(staged, 'project.json'), 'utf8'))
  for (let i = 0; i < project.scenes.length; i++) {
    land(project.scenes[i])
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...project, scenes: project.scenes.slice(0, i + 1) }, null, 2))
    await page.locator(`#scene-list li:nth-child(${i + 1})`).waitFor({ timeout: 30_000 }).catch(() => null)
    await mark(page, `scene:${project.scenes[i]}`, '#scene-list', '#strips')
    await hold(page, 1400)
  }
  await page.locator('#export:enabled').waitFor({ timeout: 30_000 })
  await hold(page, 1200)
  await mark(page, 'ready', '#scene-list', '#view', '#timeline')

  await page.locator('#play').click()
  await mark(page, 'play', '#play', '#view')
  await hold(page, 4300)
  await page.locator('#play').click()
  await page.locator('#scrub').evaluate((el) => ((el.value = '4.1'), el.dispatchEvent(new Event('input'))))
  await hold(page, 900)
  await mark(page, 'paused', '#marks', '#scrub')

  // A Note on the lamp's light: N, a click on the cone, the text.
  await page.keyboard.press('n')
  const m = await page.locator('#marks').boundingBox()
  const at = [m.x + (640 / 1080) * m.width, m.y + (1150 / 1920) * m.height]
  await hold(page, 500)
  await page.mouse.click(...at)
  await mark(page, 'pin', '#marks')
  marks.at(-1).point = { x: at[0], y: at[1] }
  await page.locator('#note-pop textarea').waitFor()
  await hold(page, 400)
  await page.keyboard.type('The light fades in too fast, slow it down', { delay: 45 })
  await hold(page, 300)
  await mark(page, 'typed', '#note-pop')
  await page.keyboard.press('Enter')
  await page.locator('#note-list li').first().waitFor()
  await hold(page, 900)
  await mark(page, 'noted', '#note-list', '#copy-prompt')

  await page.locator('#copy-prompt').click()
  await mark(page, 'copied', '#copy-prompt', '#toast')
  await hold(page, 2200)

  // Claude's fix: the light fades in over 2 s instead of 1.2 s, then the Note is set done in notes.json.
  const product = join(dir, 'product.html')
  writeFileSync(product, readFileSync(product, 'utf8').replace('tw(t, 0.6, 1.2)', 'tw(t, 0.6, 2.0)'))
  await mark(page, 'fixed', '#view', '#claude-status')
  await hold(page, 1800)
  const notes = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8'))
  notes.notes[0].done = true
  writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes, null, 2))
  await page.locator('#note-list .pin.done').waitFor({ timeout: 15_000 })
  await mark(page, 'done', '#note-list')
  await hold(page, 1800)

  await page.locator('#export').click()
  await mark(page, 'export', '#export', '#export-status')
  await page.locator('#export-status').filter({ hasText: /^Exported / }).waitFor({ timeout: 120_000 })
  await mark(page, 'exported', '#export-status')
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
renameSync(join(video, webm), join(out, 'footage.webm'))
copyFileSync(exported, join(out, 'lumen.mp4'))
writeFileSync(join(out, 'marks.json'), JSON.stringify({ size: { w: W, h: H }, scale: SCALE, marks }, null, 2))
rmSync(root, { recursive: true, force: true })
console.log(out)
