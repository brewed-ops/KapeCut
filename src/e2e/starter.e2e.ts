import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { answerSave, launch } from './launch'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The 2D canvas starter the KapeCut skill copies for every Scene (skills/kapecut).
const STARTER = resolve('skills/kapecut/starter-2d.html')
const FPS = 30
const TOTAL = 3 // the starter's window.TOTAL

type Size = { w: number; h: number }

const temps: string[] = []
const temp = (prefix: string) => (temps.push(mkdtempSync(join(tmpdir(), prefix))), temps.at(-1)!)
test.afterEach(() => temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const writeProject = (dir: string, size: Size, scene: string) =>
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size, fps: FPS, scenes: [scene] }))

// A Project holding the starter as its only Scene, its canvas set to the Design size as the skill tells Claude to.
function starterProject(size: Size) {
  const dir = temp('kapecut-e2e-')
  writeProject(dir, size, 'scene-1.html')
  const starter = readFileSync(STARTER, 'utf8')
  const tag = 'width="1080" height="1920"'
  if (!starter.includes(tag)) throw new Error(`starter has no ${tag}: update this test`)
  writeFileSync(join(dir, 'scene-1.html'), starter.replace(tag, `width="${size.w}" height="${size.h}"`))
  return dir
}

// Runs `use` on the app opened on `dir` once its Scene has opened, and always closes the app.
async function withApp(dir: string, out: string, use: (app: ElectronApplication, page: Page) => Promise<void>) {
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  try {
    // The Scene opened: the Scene list shows the starter's length, which only an opened Scene reports.
    await expect(page.locator('#scene-list .eyebrow')).toHaveText([`${TOTAL.toFixed(2)}s · ${TOTAL * FPS} F`])
    await expect(page.locator('.error')).toHaveCount(0)
    await use(app, page)
  } finally {
    await app.close()
  }
}

test('the starter Scene opens, plays and exports unchanged at 9:16, and draws a still under ?t=&scale=', async () => {
  const dir = temp('kapecut-e2e-')
  writeProject(dir, { w: 1080, h: 1920 }, 'starter-2d.html')
  copyFileSync(STARTER, join(dir, 'starter-2d.html'))
  const out = join(temp('kapecut-out-'), 'out.mp4')
  await withApp(dir, out, async (app, page) => {
    await page.keyboard.press('Space')
    await expect(page.locator('#frame-no')).not.toHaveText('F 0')
    await page.keyboard.press('Space')

    // Claude's still check: the page on its own at ?t=, a quarter size. At t = 1.5 the amber bar under the title is
    // fully drawn, its centre at (135, 268) in the 270x480 still; at t = 0 that pixel is background.
    const still = async (t: number) =>
      app.evaluate(async ({ BrowserWindow }, url) => {
        const win = new BrowserWindow({ show: false })
        await win.loadURL(url)
        const probe = `(async () => { await window.ready; await new Promise(requestAnimationFrame)
          const c = document.getElementById('c')
          return [c.width, c.height, ...c.getContext('2d').getImageData(135, 268, 1, 1).data] })()`
        const result = await win.webContents.executeJavaScript(probe)
        win.destroy()
        return result
      }, `${pathToFileURL(STARTER).href}?t=${t}&scale=0.25`)
    expect(await still(1.5)).toEqual([270, 480, 0xf0, 0xa7, 0x26, 255])
    expect(await still(0)).toEqual([270, 480, 0x12, 0x10, 0x0e, 255])

    await page.locator('#export').click()
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  })
  const stream = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }),
  ).streams[0]
  expect(stream).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920, nb_read_frames: String(TOTAL * FPS) })
})

test('the starter exports at another Export resolution: 720p draws it at 720x1280 through ?scale=', async () => {
  const dir = starterProject({ w: 1080, h: 1920 })
  const out = join(temp('kapecut-out-'), 'out.mp4')
  await withApp(dir, out, async (_app, page) => {
    await page.locator('#resolution').selectOption('720p')
    await page.locator('#export').click()
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  })
  const stream = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }),
  ).streams[0]
  expect(stream).toMatchObject({ codec_name: 'h264', width: 720, height: 1280, nb_read_frames: String(TOTAL * FPS) })
})

test('the starter opens at 16:9 and 1:1 once its canvas is set to the Design size', async () => {
  for (const size of [{ w: 1920, h: 1080 }, { w: 1080, h: 1080 }]) await withApp(starterProject(size), '', async () => {})
})
