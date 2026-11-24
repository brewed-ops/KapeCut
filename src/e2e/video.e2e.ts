import { expect, test, type Page } from '@playwright/test'
import { answerSave, launch } from './launch'
import { scenePixel } from './scene-pixel'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Video picture n is pure red, green or blue for n % 3 = 0, 1, 2. The channel a pixel shows, or -1 for anything else (the
// colour space round trip dims pure green to about 213, so no exact match).
const channel = (px: number[]) => (px.filter((v) => v > 150).length === 1 && px.every((v) => v > 150 || v < 60) ? px.findIndex((v) => v > 150) : -1)
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', ...args], { timeout: 60_000, maxBuffer: 1 << 26 })
const PICTURES = 150 // 5 s at 30 fps, a keyframe every 30, so a jump restarts mid-file

// A Project in a temp folder whose one Scene of `total` seconds draws video.mp4 full canvas.
function videoProject(total: number) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const colour = (c: number) => `if(eq(mod(N\\,3)\\,${c})\\,255\\,0)`
  ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=64x64:r=30:d=${PICTURES / 30}`, '-vf', `format=rgb24,geq=r='${colour(0)}':g='${colour(1)}':b='${colour(2)}'`,
    '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', join(dir, 'video.mp4')])
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 320, h: 240 }, fps: 30, scenes: ['one.html'] }))
  writeFileSync(
    join(dir, 'one.html'),
    `<canvas id="c"></canvas><script src="/kc-video.js"></script><script>
      const k = Number(new URLSearchParams(location.search).get('scale') ?? 1)
      const c = document.getElementById('c')
      c.width = 2 * Math.round((320 * k) / 2)
      c.height = 2 * Math.round((240 * k) / 2)
      const g = c.getContext('2d')
      const video = (window.video = kcVideo('video.mp4'))
      window.TOTAL = ${total}
      window.ready = video.ready
      window.renderAt = async (t) => g.drawImage(await video.frameAt(t), 0, 0, c.width, c.height)
    </script>`,
  )
  return dir
}

const seek = (page: Page, f: number) =>
  page.locator('#scrub').evaluate((el: HTMLInputElement, t) => ((el.value = String(t)), el.dispatchEvent(new Event('input'))), f / 30)

test('a Scene drawing a Video file through kc-video.js exports its picture at every Frame, then holds the last', async () => {
  const dir = videoProject(5.5) // its last 15 Frames run past the video's end
  const out = join(mkdtempSync(join(tmpdir(), 'kapecut-e2e-out-')), 'out.mp4')
  try {
    const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
    await page.locator('#export').click()
    await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
    await app.close()
    // [r, g, b] of the top-left pixel of every Frame, in one pass.
    const raw = ffmpeg(['-i', out, '-vf', 'crop=2:2:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const frames = Array.from({ length: raw.length / 12 }, (_, n) => [...raw.subarray(n * 12, n * 12 + 3)])
    expect(frames).toHaveLength(165)
    frames.forEach((px, n) => expect(channel(px), `Frame ${n}: ${px}`).toBe(Math.min(n, PICTURES - 1) % 3))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(out, '..'), { recursive: true, force: true })
  }
})

test('the viewer draws the Video file picture at a scrubbed time: forward, a jump past 3 s, back, past the end', async () => {
  const dir = videoProject(5.5)
  try {
    const { app, page } = await launch({ project: dir })
    for (const f of [20, 4, 140, 29, 0, 160, 13]) {
      await seek(page, f)
      await expect(page.locator('#frame-no')).toHaveText(`F ${f}`)
      await expect.poll(async () => channel((await scenePixel(page)) ?? []), `F ${f}`).toBe(Math.min(f, PICTURES - 1) % 3)
    }
    await app.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a Video file stored on its side with a rotation tag draws upright and reports its upright size', async () => {
  const dir = videoProject(1)
  // Stored 64x32, left half red, right half blue, tagged to show turned a quarter: upright it is 32x64, one colour over the other.
  const flat = join(dir, 'flat.mp4')
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=1[a];color=c=blue:s=32x32:d=1[b];[a][b]hstack', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', flat])
  ffmpeg(['-y', '-display_rotation', '90', '-i', flat, '-c', 'copy', join(dir, 'video.mp4')])
  try {
    const { app, page } = await launch({ project: dir })
    const scene = page.frameLocator('iframe.current').locator('#c')
    await expect.poll(() => scene.evaluate(() => [(window as any).video.width, (window as any).video.height]).catch(() => null)).toEqual([32, 64])
    const at = async (x: number, y: number) =>
      channel(await scene.evaluate((c: HTMLCanvasElement, [x, y]) => Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]))
    // Upright, red and blue sit one above the other: top and bottom rows differ, left and right match.
    await expect.poll(async () => [await at(10, 10), await at(310, 10), await at(10, 230)].join()).toMatch(/^(0,0,2|2,2,0)$/)
    await app.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
