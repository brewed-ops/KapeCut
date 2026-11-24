import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ICONS, icon } from './icons'

const dir = __dirname
const sources = (readdirSync(dir, { recursive: true }) as string[])
  .filter((f) => /\.(ts|html)$/.test(f) && !/\.test\.ts$/.test(f) && f !== 'icons.ts')
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

test('icons.ts is the only renderer file that draws an icon (the logo and the waveform excepted)', () => {
  for (const [f, src] of sources) {
    const rest = src.replace(/<h1><svg[\s\S]*?<\/svg>/, '').replace('<path d="${wave.d}" />', '')
    expect(rest.match(/<(path|circle|ellipse|rect|line|polyline|polygon)\b.*/g), f).toBeNull()
  }
})

// TS calls are checked by typecheck (icon() takes IconState); the pages' placeholders are plain strings, so here.
test('every icon a page names is in the set', () => {
  const used = sources.flatMap(([, src]) => [...src.matchAll(/data-icon="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))
  expect(used.length).toBeGreaterThan(15)
  for (const state of used) expect(ICONS, state).toHaveProperty(state.split('.')[0])
})

test('icon() stacks states as groups CSS can toggle', () => {
  expect(icon(['play.play', 'pause.pause'])).toBe(`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><g class="play">${ICONS.play}</g><g class="pause">${ICONS.pause}</g></svg>`)
  expect(icon('add', 'off')).toBe(`<svg class="ico off" viewBox="0 0 24 24" aria-hidden="true">${ICONS.add}</svg>`)
})
