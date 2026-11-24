import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Typography (#82): every text role takes its tracking and leading from one token in tokens.css.

// [selector, token for letter-spacing (null: the font's own 0), token for line-height]: one element per role.
const ROLES: [string, string | null, string][] = [
  ['header h1', '--track-display', '--lead-display'],
  ['#export', null, '--lead-label'],
  ['body', null, '--lead-body'],
  ['#time', '--track-mono', '--lead-label'],
  ['#note', null, '--lead-label'],
  ['#project', null, '--lead-label'],
  ['#note-list .jump', null, '--lead-dense'],
]

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-type-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Type', size: { w: 108, h: 192 }, fps: 30, scenes: ['a.html'] }))
  writeFileSync(join(dir, 'a.html'), '<canvas id="c" width="108" height="192"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>')
  const T = '2026-11-23T10:00:00.000Z'
  const note = { n: 1, text: 'Tighter', done: false, scene: 'a.html', sceneTime: 0, time: 0, frame: 0, point: { x: 50, y: 50 }, created: T, updated: T }
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 2, notes: [note] }))
  return dir
}

// Every role whose computed tracking or leading is not its token's value at its own font size, as a readable line.
const offTokens = (page: Page) =>
  page.evaluate((roles) => {
    const root = getComputedStyle(document.documentElement)
    const bad: string[] = []
    for (const [selector, track, lead] of roles) {
      const el = document.querySelector(selector)
      if (!el?.checkVisibility()) {
        bad.push(`${selector} is not on screen`)
        continue
      }
      const s = getComputedStyle(el)
      const size = parseFloat(s.fontSize)
      const wantTrack = track ? parseFloat(root.getPropertyValue(track)) * size : 0 // tracking tokens are em
      const wantLead = parseFloat(root.getPropertyValue(lead)) * size // leading tokens are unitless
      const gotTrack = s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing)
      if (Math.abs(gotTrack - wantTrack) > 0.01) bad.push(`${selector} letter-spacing ${gotTrack}px, ${track} is ${wantTrack}px`)
      if (Math.abs(parseFloat(s.lineHeight) - wantLead) > 0.01) bad.push(`${selector} line-height ${s.lineHeight}, ${lead} is ${wantLead}px`)
    }
    return bad
  }, ROLES)

test('every text role takes its tracking and leading from the type tokens, and a token change moves them all', async () => {
  const dir = project()
  const { app, page } = await launch({ project: dir })
  try {
    await expect(page.locator('#note-list .jump')).toBeVisible()
    expect(await offTokens(page)).toEqual([])

    // A value no rule could hold by accident, per token: each role must follow its own.
    await page.evaluate(() => {
      const next: Record<string, string> = {
        '--track-display': '-0.05em', '--track-mono': '0.21em',
        '--track-caps': '0.25em', '--track-eyebrow': '0.4em', '--lead-display': '0.9', '--lead-label': '1.7', '--lead-dense': '1.9', '--lead-body': '2.3',
      }
      for (const [k, v] of Object.entries(next)) document.documentElement.style.setProperty(k, v)
    })
    expect(await offTokens(page)).toEqual([])
    // The edit reached the page: 0.21em on the 11px time.
    await expect(page.locator('#time')).toHaveCSS('letter-spacing', '2.31px')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
})
