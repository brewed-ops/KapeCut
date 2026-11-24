import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// e2e runs on macos-latest too (#136): these key presses pass on Windows and fail on a Mac.
const dir = fileURLToPath(new URL('.', import.meta.url))

const CONTROL = 'Control+ is Ctrl on a Mac and Meta+ is the Windows key elsewhere, use ControlOrMeta+'
const END = 'Home and End scroll on a Mac and leave the caret, use ArrowLeft or ArrowRight after select-all'

// shortcut: any quoted 'Control+' counts, so one in a comment or test title is flagged too, and a key held in a
// variable is missed; blank comments as launch-env.test.ts does if the first ever bites.
const RULES: [RegExp, string][] = [
  [/['"`](?:\w+\+)*(?:Control|Meta)\+/g, CONTROL],
  [/\b(?:press|down|up)\(\s*['"`][^'"`]*\b(?:Home|End)['"`]/g, END],
]

const unsafe = (file: string, src: string) =>
  RULES.flatMap(([re, fix]) => [...src.matchAll(re)].map((m) => `${file}:${src.slice(0, m.index).split('\n').length}: ${fix}`))

test('flags each Mac-unsafe key press with its file, line and Mac-safe replacement', () => {
  expect(unsafe('a.e2e.ts', "ok\nawait page.keyboard.press('Control+a')")).toEqual([`a.e2e.ts:2: ${CONTROL}`])
  expect(unsafe('a.e2e.ts', 'press("Control+z")')).toEqual([`a.e2e.ts:1: ${CONTROL}`])
  expect(unsafe('a.e2e.ts', "press('Shift+Control+z')")).toEqual([`a.e2e.ts:1: ${CONTROL}`])
  expect(unsafe('a.e2e.ts', "await box.press('End')")).toEqual([`a.e2e.ts:1: ${END}`])
  expect(unsafe('a.e2e.ts', 'press( "Shift+End", { delay: 5 })')).toEqual([`a.e2e.ts:1: ${END}`])
  expect(unsafe('a.e2e.ts', "keyboard.down('Home')")).toEqual([`a.e2e.ts:1: ${END}`])
  expect(unsafe('a.e2e.ts', 'press(`${mod}+End`)')).toEqual([`a.e2e.ts:1: ${END}`])
  expect(unsafe('a.e2e.ts', "press('Meta+v')")).toEqual([`a.e2e.ts:1: ${CONTROL}`])
  expect(unsafe('a.e2e.ts', "press('ControlOrMeta+a'); press('ArrowRight'); keyboard.down('Control')")).toEqual([])
})

test('no e2e file presses a Mac-unsafe key', () => {
  // This file is skipped: its fixtures hold the patterns.
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.ts') && f !== 'mac-keys.test.ts')
  expect(files.length).toBeGreaterThan(0)
  expect(files.flatMap((f) => unsafe(f, readFileSync(join(dir, f), 'utf8')))).toEqual([])
})
