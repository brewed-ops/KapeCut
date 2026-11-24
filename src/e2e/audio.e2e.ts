import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'
import { wav } from './wav'
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scene = (color: string) => `<canvas id="c" width="200" height="200"></canvas><script>
  const g = document.getElementById('c').getContext('2d')
  window.TOTAL = 0.5
  window.renderAt = () => { g.fillStyle = '${color}'; g.fillRect(0, 0, 200, 200) }
</script>`

// Three 0.5 s Scenes; tone.wav starts with Scene b, bad.wav is not audio, gone.wav does not exist, late.wav starts
// after the video ends (and does not exist either).
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-audio-'))
  const audio = [
    { file: 'tone.wav', start: 0.5 },
    { file: 'bad.wav', start: 0 },
    { file: 'gone.wav', start: 1 },
    { file: 'late.wav', start: 5 },
  ]
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html'], audio }))
  ;['a', 'b', 'c'].forEach((s, i) => writeFileSync(join(dir, `${s}.html`), scene(['#ff0000', '#00ff00', '#0000ff'][i])))
  writeFileSync(join(dir, 'tone.wav'), wav(1))
  writeFileSync(join(dir, 'bad.wav'), 'not a sound file')
  return dir
}

const lane = (page: Page, i: number) => page.locator('#lanes > div').nth(i).locator('> div')

test('one lane per Audio file with its waveform at its start; a bad file marks only its own lane', async () => {
  const dir = project()
  const { app, page } = await launch({ project: dir })
  try {
    await expect(page.locator('#lanes > div')).toHaveCount(4)
    await expect(lane(page, 0).locator('svg path')).toHaveAttribute('d', /L/)
    await expect(lane(page, 0)).toContainText('tone.wav')
    // tone.wav starts where Scene b does (the strip sits 2 px inside its start).
    // NaN while a lane is being re-laid (no box yet), so the poll retries instead of throwing.
    const left = async (el: ReturnType<Page['locator']>) => (await el.boundingBox())?.x ?? NaN
    await expect.poll(async () => Math.abs((await left(lane(page, 0))) - ((await left(page.locator('#strips > div').nth(1))) - 2))).toBeLessThan(2)
    await expect(lane(page, 0).locator('.badge')).toBeHidden()
    await expect(lane(page, 1).locator('.badge')).toBeVisible()
    await expect(lane(page, 1)).toContainText('bad.wav: not a sound file')
    await expect(lane(page, 2).locator('.badge')).toBeVisible()
    await expect(lane(page, 2)).toContainText('gone.wav: not found')
    await expect(lane(page, 3).locator('.badge')).toBeVisible() // its error shows though it starts past the end
    await expect(lane(page, 3)).toContainText('after the video ends')
    await expect(page.locator('#strips .badge')).toHaveCount(0) // no Scene is marked
    await expect(page.locator('#stage .error')).toBeHidden()

    // The video still plays.
    await page.keyboard.press('Space')
    await expect.poll(async () => Number((await page.locator('#frame-no').textContent())!.slice(2))).toBeGreaterThan(5)

    // Fixing an Audio file clears its lane's error; an edit to the audio list re-lays the lanes.
    // Whole, in one rename: a save event mid-write would decode half a file.
    const fixed = join(mkdtempSync(join(tmpdir(), 'kapecut-wav-')), 'bad.wav')
    writeFileSync(fixed, wav(1))
    renameSync(fixed, join(dir, 'bad.wav'))
    await expect(lane(page, 1).locator('.badge')).toBeHidden()
    await expect(lane(page, 1).locator('svg')).toHaveCount(1)
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html'], audio: [{ file: 'tone.wav', start: 0 }] }))
    await expect(page.locator('#lanes > div')).toHaveCount(1)
    await expect.poll(async () => Math.abs((await left(lane(page, 0))) - ((await left(page.locator('#strips > div').first())) - 2))).toBeLessThan(2)
  } finally {
    await app.close()
  }
})

test('Audio starts at the transport time, stops on pause and follows a seek; mute is a named toggle', async () => {
  const { app, page } = await launch({ project: project() })
  try {
    await expect(page.locator('#lanes .lane > svg')).toHaveCount(1) // tone.wav decoded
    // Record what the app asks each Audio source to do.
    await page.evaluate(() => {
      // Project time stands still for the rest of this test, so it checks what the Audio is told, not time passing
      // (transport.test.ts does that): the 0.7 s left after 24/30 ran out before a slow runner pressed pause, and the
      // pause press then played again from 0. The transport reads performance.now; Audio runs on its own clock.
      const t0 = performance.now()
      performance.now = () => t0
      const log: (string | number)[][] = ((window as any).audioLog = [])
      const proto = AudioBufferSourceNode.prototype
      const [start, stop] = [proto.start, proto.stop]
      proto.start = function (when?: number, offset?: number) {
        log.push(['start', offset ?? 0])
        return start.call(this, when, offset)
      }
      proto.stop = function (when?: number) {
        log.push(['stop'])
        return stop.call(this, when)
      }
    })
    const log = () => page.evaluate(() => (window as any).audioLog as (string | number)[][])
    await page.locator('#scrub').evaluate((el: HTMLInputElement) => ((el.value = String(24 / 30)), el.dispatchEvent(new Event('input'))))
    await page.keyboard.press('Space')
    await expect.poll(log).toHaveLength(1)
    expect((await log())[0][0]).toBe('start')
    // 0.3 s into tone.wav, which starts at 0.5, plus the machine's output latency (0 to ~0.1 s; 0.042 here).
    const offset = (await log())[0][1] as number
    expect(offset).toBeGreaterThanOrEqual(24 / 30 - 0.5 - 1e-9)
    expect(offset).toBeLessThan(24 / 30 - 0.5 + 0.15)
    await page.keyboard.press('Space')
    await expect.poll(log).toEqual([expect.anything(), ['stop']])

    // A seek before tone.wav starts: it is scheduled from its own start.
    await page.locator('#scrub').evaluate((el: HTMLInputElement) => ((el.value = '0.1'), el.dispatchEvent(new Event('input'))))
    await page.keyboard.press('Space')
    await expect.poll(async () => (await log())[2]).toEqual(['start', 0])
    await page.keyboard.press('Space')

    const mute = page.getByRole('button', { name: 'Mute audio' })
    await expect(mute).toHaveAttribute('aria-pressed', 'false')
    await mute.click()
    await expect(mute).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await app.close()
  }
})
