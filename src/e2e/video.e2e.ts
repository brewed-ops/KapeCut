import { expect, test } from '@playwright/test'
import { answerSave, launch } from './launch'
import { scenePixel } from './scene-pixel'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Video picture n is pure red, green or blue for n % 3 = 0, 1, 2. The channel a pixel shows, or -1 for anything else (the
// colour space round trip dims pure green to about 213, so no exact match).
const channel = (px: number[]) => (px.filter((v) => v > 150).length === 1 && px.every((v) => v > 150 || v < 60) ? px.findIndex((v) => v > 150) : -1)

// A Project whose one 1.5 s Scene draws video.mp4 (1 s, 30 fps, one colour per picture, B-frames, one keyframe) full
// canvas, so its last 15 Frames run past the video's end.
function videoProject() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const colour = (c: number) => `if(eq(mod(N\\,3)\\,${c})\\,255\\,0)`
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=1', '-vf',
    `format=rgb24,geq=r='${colour(0)}':g='${colour(1)}':b='${colour(2)}'`, '-c:v', 'libx264', '-g', '300', '-pix_fmt', 'yuv420p',
    join(dir, 'video.mp4')], { timeout: 30_000 })
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 320, h: 240 }, fps: 30, scenes: ['one.html'] }))
  writeFileSync(
    join(dir, 'one.html'),
    `<canvas id="c"></canvas><script src="/kc-video.js"></script><script>
      const k = Number(new URLSearchParams(location.search).get('scale') ?? 1)
      const c = document.getElementById('c')
      c.width = 2 * Math.round((320 * k) / 2)
      c.height = 2 * Math.round((240 * k) / 2)
      const g = c.getContext('2d')
      const video = kcVideo('video.mp4')
      window.TOTAL = 1.5
      window.ready = video.ready
      window.renderAt = async (t) => g.drawImage(await video.frameAt(t), 0, 0, c.width, c.height)
    </script>`,
  )
  return dir
}

// [r, g, b] of the top-left pixel of video Frame n.
const pixelAt = (out: string, n: number) => [
  ...execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select=eq(n\\,${n}),crop=2:2:0:0`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 30_000 }).subarray(0, 3),
]

test('a Scene drawing a Video file through kc-video.js exports its picture at every Frame, then holds the last', async () => {
  const dir = videoProject()
  const out = join(mkdtempSync(join(tmpdir(), 'kapecut-e2e-out-')), 'out.mp4')
  const { app, page } = await launch({ project: dir, onLaunch: answerSave(out) })
  await page.locator('#export').click()
  await expect(page.locator('#export-status')).toHaveText(/^Exported /, { timeout: 60_000 })
  await app.close()
  for (let n = 0; n < 45; n++) expect(channel(pixelAt(out, n)), `Frame ${n}: ${pixelAt(out, n)}`).toBe(Math.min(n, 29) % 3)
})

test('the viewer draws the Video file picture at a scrubbed time, forward and back', async () => {
  const { app, page } = await launch({ project: videoProject() })
  const seek = (f: number) =>
    page.locator('#scrub').evaluate((el: HTMLInputElement, t) => ((el.value = String(t)), el.dispatchEvent(new Event('input'))), f / 30)
  for (const f of [20, 4, 29, 0, 40, 13]) {
    await seek(f)
    await expect(page.locator('#frame-no')).toHaveText(`F ${f}`)
    await expect.poll(async () => channel((await scenePixel(page)) ?? []), `F ${f}`).toBe(Math.min(f, 29) % 3)
  }
  await app.close()
})
