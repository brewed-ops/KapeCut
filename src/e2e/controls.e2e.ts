import { expect, test, type Page } from '@playwright/test'
import { launch } from './launch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Compact controls (#71): every button, select, pill and input takes its size from the control-size tokens in
// tokens.css, so one token edit resizes them all.

const H = 'var(--control-h)'
const ICON_H = 'var(--control-h-icon)'
const SMALL_H = 'var(--control-h-small)'
const PAD = 'var(--control-pad-x)'
const PAD_S = 'var(--control-pad-x-small)'
const GAP = 'var(--control-gap)'
const ICON = 'var(--control-icon)'
const FONT = 'var(--control-font)'

// [selector, what is measured, the CSS length it must equal]. height and width are the drawn box; the rest computed style.
const CHECKS: [string, string, string][] = [
  // header
  ['#export', 'height', 'var(--control-h-export)'],
  ['#export', 'paddingLeft', PAD],
  ['#export', 'fontSize', FONT],
  ['#resolution', 'height', H],
  ['#resolution', 'paddingLeft', PAD],
  ['#resolution', 'fontSize', FONT],
  ['#claude-status', 'height', H],
  ['#claude-status', 'columnGap', GAP],
  ['.win-buttons button', 'height', ICON_H],
  ['.win-buttons svg', 'width', ICON],
  ['#projects summary', 'height', H],
  ['#projects summary', 'paddingLeft', PAD],
  ['#projects summary svg', 'width', ICON],
  ['#projects .menu button', 'height', H],
  ['#projects .menu button', 'paddingLeft', PAD_S],
  // viewer title bar and transport
  ['#connect', 'height', H],
  ['#connect', 'paddingLeft', PAD],
  ['#connect', 'fontSize', FONT],
  ['#connect svg', 'width', ICON],
  ['#note', 'height', H],
  ['#pen', 'height', H],
  ['#note', 'paddingLeft', PAD],
  ['#note', 'columnGap', GAP],
  ['#note', 'fontSize', FONT],
  ['#note svg', 'width', ICON],
  ['.tools', 'columnGap', GAP],
  ['#back', 'height', ICON_H],
  ['#back', 'width', ICON_H],
  ['#play', 'height', ICON_H],
  ['#play', 'width', ICON_H],
  ['#fwd', 'height', ICON_H],
  ['#fwd', 'width', ICON_H],
  ['#back svg', 'width', ICON],
  ['#transport', 'columnGap', GAP],
  // Note popover
  ['#note-cancel', 'height', H],
  ['#note-cancel', 'paddingLeft', PAD_S],
  ['#note-cancel', 'fontSize', FONT],
  ['#note-pop .primary', 'height', H],
  ['#note-pop .primary', 'paddingLeft', PAD],
  // Notes
  ['#hide-done', 'height', SMALL_H],
  ['#hide-done', 'width', SMALL_H],
  ['#hide-done svg', 'width', ICON],
  ['#note-list .acts button', 'height', SMALL_H],
  ['#note-list .acts button', 'paddingLeft', PAD_S],
  ['#note-list .acts', 'columnGap', GAP],
  ['#copy-prompt', 'height', H],
  ['#copy-prompt', 'columnGap', GAP],
  ['#copy-prompt', 'fontSize', FONT],
  ['#copy-prompt svg', 'width', ICON],
  // Files
  ['#files-add', 'height', SMALL_H],
  ['#files-add', 'width', SMALL_H],
  ['#file-list button', 'height', SMALL_H],
  ['#file-list button', 'width', SMALL_H],
  ['#file-list button svg', 'width', 'var(--control-icon-small)'],
  // Timeline
  ['#mute', 'height', ICON_H],
  ['#mute', 'width', ICON_H],
  ['#zoom-out', 'height', ICON_H],
  ['#zoom-out', 'width', ICON_H],
  ['#zoom-in', 'height', ICON_H],
  ['#zoom-in', 'width', ICON_H],
  ['#zoom-fit', 'height', ICON_H],
  ['#zoom-fit', 'paddingLeft', PAD_S],
  ['#zoom-fit', 'fontSize', FONT],
  ['.zoom', 'columnGap', GAP],
  ['#zoom-in svg', 'width', ICON],
  // Settings card and panel
  ['#settings', 'height', `calc(${H} + 12px)`],
  ['#settings', 'columnGap', GAP],
  ['#settings', 'fontSize', FONT],
  ['#settings-recent button', 'height', H],
  ['#settings-recent button', 'paddingLeft', PAD_S],
  ['#settings svg', 'width', ICON],
  ['#idle-minutes', 'height', H],
  ['#idle-minutes', 'paddingLeft', PAD_S],
  ['#idle-minutes', 'fontSize', FONT],
]

// The smallest window: the Claude status is only its dot, Connect only its icon.
const NARROW: [string, string, string][] = [
  ['#claude-status', 'height', H],
  ['#claude-status', 'width', H],
  ['#connect', 'height', H],
  ['#connect', 'paddingLeft', PAD_S],
]

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-controls-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Controls', size: { w: 108, h: 192 }, fps: 30, scenes: ['a.html'], audio: [{ file: 'v.wav', start: 0 }] }))
  writeFileSync(join(dir, 'a.html'), '<canvas id="c" width="108" height="192"></canvas><script>window.TOTAL = 1; window.renderAt = () => {}</script>')
  writeFileSync(join(dir, 'v.wav'), '') // a Files row with its copy and add-to-Timeline buttons
  const T = '2026-11-23T10:00:00.000Z'
  const note = { n: 1, text: 'Bigger', done: false, scene: 'a.html', sceneTime: 0, time: 0, frame: 0, point: { x: 50, y: 50 }, created: T, updated: T }
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 2, notes: [note] }))
  return dir
}

// Every control drawn at once: the Projects menu, Settings and the Note popover open, a Files row and a Note listed.
async function openEverything(page: Page) {
  await page.locator('#projects summary').click()
  await expect(page.locator('#projects .menu button').first()).toBeVisible()
  await page.locator('#note').click()
  await page.locator('#marks').click()
  await expect(page.locator('#note-cancel')).toBeVisible()
  // The popover grows from its Mark (#79): its buttons are measured at full size, once it has settled.
  await page.locator('#note-pop').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => null))) /* a cancelled one rejects */)
  await expect(page.locator('#file-list button').first()).toBeVisible()
  await expect(page.locator('#note-list .acts button').first()).toBeVisible()
  // The clicks after it closed the <details> menu: reopen it without a click. Settings last and without a click, as its
  // modal panel blocks clicks on the rest and a click would close the Note popover.
  await page.evaluate(() => {
    ;(document.querySelector('#projects') as HTMLDetailsElement).open = true
    document.querySelector<HTMLDialogElement>('#settings-panel')?.showModal()
  })
  // Popovers grow in (#80): measure them at rest, not mid-scale.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
}

// Every check that does not hold, as a readable line.
const offTokens = (page: Page, checks = CHECKS) =>
  page.evaluate((checks) => {
    const probe = document.body.appendChild(document.createElement('div'))
    const bad: string[] = []
    for (const [selector, what, css] of checks) {
      probe.style.width = css
      const want = probe.getBoundingClientRect().width
      const els = [...document.querySelectorAll(selector)].filter((el) => el.checkVisibility())
      if (!els.length) bad.push(`${selector} is not on screen`)
      for (const el of els) {
        const r = el.getBoundingClientRect()
        const got = what === 'height' ? r.height : what === 'width' ? r.width : parseFloat(getComputedStyle(el)[what as 'paddingLeft'])
        if (Math.abs(got - want) > 0.5) bad.push(`${selector} ${what} is ${got}, ${css} is ${want}`)
      }
    }
    probe.remove()
    return bad
  }, checks)

// The smallest window the app allows (1000x700).
async function expectNarrow(page: Page) {
  await page.setViewportSize({ width: 1000, height: 700 })
  await expect(async () => expect(await offTokens(page, NARROW)).toEqual([])).toPass({ timeout: 5000 })
}

test('every control takes its size from the control-size tokens, and a token change resizes them all', async () => {
  const dir = project()
  const userData = mkdtempSync(join(tmpdir(), 'kapecut-user-'))
  const other = mkdtempSync(join(tmpdir(), 'kapecut-other-'))
  writeFileSync(join(userData, 'recent-projects.json'), JSON.stringify([other])) // a recent Project row in Settings
  const { app, page } = await launch({ project: dir, userData })
  try {
    await expectNarrow(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openEverything(page)
    // Compact, but a mouse still hits them: the issue's sizes.
    const tokens = { h: '28px', 'h-export': '32px', 'h-icon': '26px', 'h-small': '22px', 'pad-x': '12px', 'pad-x-small': '8px', gap: '6px', icon: '14px', 'icon-small': '12px', font: '12px' }
    expect(await page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, getComputedStyle(document.documentElement).getPropertyValue(`--control-${k}`).trim()])), Object.keys(tokens))).toEqual(tokens)
    expect(await offTokens(page)).toEqual([])

    // One edit per token, every control follows.
    await page.evaluate(() => {
      const next = { h: 40, 'h-export': 46, 'h-icon': 36, 'h-small': 30, 'pad-x': 20, 'pad-x-small': 14, gap: 11, icon: 19, 'icon-small': 17, font: 13 }
      for (const [k, v] of Object.entries(next)) document.documentElement.style.setProperty(`--control-${k}`, `${v}px`)
    })
    expect(await offTokens(page)).toEqual([])
    await expectNarrow(page)
  } finally {
    await app.close()
    for (const d of [dir, userData, other]) rmSync(d, { recursive: true, force: true, maxRetries: 10 })
  }
})
