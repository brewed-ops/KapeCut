import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BACKGROUND, ground, readSettings, withIdleMinutes, withTheme, writeSettings, type Settings } from './settings'

it("the window's ground is --bg of each palette in tokens.css", () => {
  const tokens = readFileSync(new URL('../renderer/styles/tokens.css', import.meta.url), 'utf8')
  const bg = (block: RegExp) => tokens.match(block)?.[1].match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1].toLowerCase()
  expect(bg(/^:root\s*\{([^}]*)\}/m)).toBe(BACKGROUND.dark)
  expect(bg(/^:root\[data-theme='light'\]\s*\{([^}]*)\}/m)).toBe(BACKGROUND.light)
  expect(bg(/^:root\[data-theme='glass'\]\s*\{([^}]*)\}/m)).toBe(BACKGROUND.glass)
  expect([ground('glass', true), ground('dark', false), ground('light', true), ground('system', true), ground('system', false)]).toEqual(['#eef1f6', '#12100e', '#f4efe6', '#12100e', '#f4efe6'])
})

const made: string[] = []
afterEach(() => made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
const folder = () => (made.push(mkdtempSync(join(tmpdir(), 'kapecut-settings-'))), made.at(-1)!)
const DEFAULTS: Settings = { idleMinutes: 15, theme: 'dark' }

it('gives the defaults for a missing file, bad JSON or a value out of range', () => {
  const file = join(folder(), 'settings.json')
  expect(readSettings(file)).toEqual(DEFAULTS)
  for (const text of ['{', 'null', '[]', '{"version":1}', ...[0, 121, 1.5, '"15"', -3, 'null'].map((n) => `{"version":1,"idleMinutes":${n}}`), '{"version":2,"idleMinutes":30}']) {
    writeFileSync(file, text)
    expect(readSettings(file), text).toEqual(DEFAULTS)
  }
})

it('reads the idle minutes, 1 to 120', () => {
  const file = join(folder(), 'settings.json')
  for (const n of [1, 30, 120]) {
    writeFileSync(file, JSON.stringify({ version: 1, idleMinutes: n }))
    expect(readSettings(file)).toEqual({ ...DEFAULTS, idleMinutes: n })
  }
})

it('reads the theme, dark by default; a bad theme does not lose the idle minutes', () => {
  const file = join(folder(), 'settings.json')
  for (const theme of ['dark', 'light', 'glass', 'system']) {
    writeFileSync(file, JSON.stringify({ version: 1, idleMinutes: 9, theme }))
    expect(readSettings(file)).toEqual({ idleMinutes: 9, theme })
  }
  for (const theme of ['Light', '', 'auto', 1, null]) {
    writeFileSync(file, JSON.stringify({ version: 1, idleMinutes: 9, theme }))
    expect(readSettings(file), String(theme)).toEqual({ idleMinutes: 9, theme: 'dark' })
  }
})

it('takes idle minutes 1 to 120 and a theme of dark, light, glass or system, keeping the rest; refuses anything else', () => {
  expect(withIdleMinutes(DEFAULTS, 7)).toEqual({ idleMinutes: 7, theme: 'dark' })
  for (const bad of [0, 121, 2.5, '30', null, NaN]) expect(() => withIdleMinutes(DEFAULTS, bad)).toThrow('1 to 120')
  expect(withTheme({ ...DEFAULTS, idleMinutes: 7 }, 'light')).toEqual({ idleMinutes: 7, theme: 'light' })
  expect(withTheme(DEFAULTS, 'glass')).toEqual({ idleMinutes: 15, theme: 'glass' })
  expect(withTheme(DEFAULTS, 'system')).toEqual({ idleMinutes: 15, theme: 'system' })
  for (const bad of ['Light', 'auto', '', 1, null, undefined, { toString: () => 'dark' }]) expect(() => withTheme(DEFAULTS, bad)).toThrow('Theme must be dark, light, glass or system')
})

it('writes the Settings whole, with no temp file left', async () => {
  const dir = folder()
  const file = join(dir, 'settings.json')
  const next = withTheme(withIdleMinutes(DEFAULTS, 7), 'light')
  expect(await writeSettings(file, next)).toEqual(next)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, idleMinutes: 7, theme: 'light' })
  expect(readSettings(file)).toEqual(next)
  expect(readdirSync(dir)).toEqual(['settings.json'])
})

it('the last change wins when writes overlap', async () => {
  const file = join(folder(), 'settings.json')
  await Promise.all([3, 4, 5].map((n) => writeSettings(file, withIdleMinutes(DEFAULTS, n))))
  expect(readSettings(file)).toEqual({ ...DEFAULTS, idleMinutes: 5 })
})
