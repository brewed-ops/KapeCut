import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Since #89 a launch only gets past the Setup window with the env scripts/ready-env.mjs sets up (fake home, dummy
// claude, KAPECUT_HIDDEN). A launch that drops it waits on the Setup window and times out with no clear error (#96).
const root = fileURLToPath(new URL('../../', import.meta.url))

// Comments and strings become spaces (newlines kept), so a paren or a '...process.env' inside them counts for nothing.
// shortcut: regex literals are not blanked, a quote, backtick or paren in one near a launch would confuse it; upgrade
// to the TypeScript parser if that ever happens.
const blank = (src: string) =>
  src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (s) => s.replace(/[^\n]/g, ' '))

// Opening minus closing brackets of any kind in s.
const nesting = (s: string) => (s.match(/[([{]/g)?.length ?? 0) - (s.match(/[)\]}]/g)?.length ?? 0)

// Every e2e launches through src/e2e/launch.ts (#97); the shot scripts launch on their own, as they call readyEnv()
// themselves and have no expect to wait with.
const LAUNCHERS = ['src/e2e/launch.ts', 'scripts/shot.mjs', 'scripts/shot-states.mjs', 'scripts/readme-shot.mjs', 'scripts/demo-footage.mjs', 'scripts/smoke-packaged.mjs']

test('only the launch helper and the shot scripts launch Electron, each spreading process.env first in its own env', () => {
  // shortcut: matches electron.launch( / _electron.launch( by name; a file importing _electron with no such call fails
  // below, so an alias cannot hide one. This file is skipped: its regexes name _electron.
  const files = ['src/e2e', 'scripts'].flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).filter((f) => /\.[cm]?[jt]s$/.test(f) && f !== 'launch-env.test.ts').map((f) => `${dir}/${f.replaceAll('\\', '/')}`),
  )
  const bad: string[] = []
  for (const file of files) {
    const src = blank(readFileSync(join(root, file), 'utf8'))
    const calls = [...src.matchAll(/(?<![\w$])_?electron\s*\.\s*launch\s*\(/g)]
    if (/(?<![\w$])_electron\b/.test(src) && calls.length === 0) bad.push(`${file}: imports _electron but no electron.launch( found`)
    // Outside Playwright's globalSetup the spread only carries the ready env if the script called readyEnv() first.
    if (file.startsWith('scripts/') && calls.length > 0 && !/\breadyEnv\(\)/.test(src)) bad.push(`${file}: launches without calling readyEnv()`)
    for (const m of calls) {
      const at = `${file}:${src.slice(0, m.index).split('\n').length}`
      if (!LAUNCHERS.includes(file)) bad.push(`${at}: launch through launch() in src/e2e/launch.ts`)
      let end = m.index + m[0].length
      for (let depth = 1; depth > 0; end++) {
        if (end >= src.length) {
          bad.push(`${at}: launch call never closes`)
          break
        }
        depth += nesting(src[end])
      }
      const call = src.slice(m.index + m[0].length, end)
      // Its own env: the key sits right inside the options object, and the spread comes first so later keys override it.
      // The house pattern is the inline spread, so a launch with no env (Playwright's default) is flagged too.
      const env = [...call.matchAll(/\benv\s*:\s*\{\s*\.\.\.process\.env\s*[,}]/g)].some((e) => nesting(call.slice(0, e.index)) === 1)
      if (!env) bad.push(`${at}: env must start with ...process.env (env: { ...process.env, ... })`)
    }
  }
  expect(files.length).toBeGreaterThan(0)
  expect(bad).toEqual([])
})
