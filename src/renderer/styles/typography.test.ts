import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// Typography (#82, apple-design section 15): tracking and leading come from one token per role in tokens.css.
const css = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = css('tokens.css')
const token = (name: string) => parseFloat(tokens.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1] ?? 'NaN')

test('tracking is size-specific: tight on display headlines, wider the smaller and more caps the label', () => {
  expect(token('--track-display')).toBeLessThan(0)
  expect(token('--track-mono')).toBeGreaterThan(0)
  expect(token('--track-caps')).toBeGreaterThan(token('--track-mono'))
  expect(token('--track-eyebrow')).toBeGreaterThan(token('--track-caps'))
})

test('leading tracks size inversely: tight on headlines, looser on body, dense between', () => {
  expect(token('--lead-display')).toBeLessThan(token('--lead-label'))
  expect(token('--lead-label')).toBeLessThan(token('--lead-dense'))
  expect(token('--lead-dense')).toBeLessThan(token('--lead-body'))
})

test('app.css sets no raw letter-spacing or line-height', () => {
  const app = css('app.css')
  for (const [, prop, value] of app.matchAll(/(letter-spacing|line-height)\s*:\s*([^;}]+)/g))
    expect(value.trim(), prop).toMatch(prop === 'letter-spacing' ? /^var\(--track-[\w-]+\)$/ : /^var\(--lead-[\w-]+\)$/)
})

test('every font shorthand names its leading, so none falls back to the font\'s own "normal"', () => {
  const fonts = [...css('app.css').matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'inherit')
  expect(fonts.length).toBeGreaterThan(0)
  for (const f of fonts) expect(f).toMatch(/\/var\(--lead-[\w-]+\) /)
})

test('every rule that sizes its text names its leading, so small wrapping text never keeps the body\'s', () => {
  // Bodies only: [^{}]* stops at an @container or @media opening brace, so a nested rule never swallows its prelude.
  const rules = [...css('app.css').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((body) => /font-size\s*:/.test(body))
  expect(rules.length).toBeGreaterThan(0)
  for (const body of rules) expect(body).toMatch(/line-height\s*:\s*var\(--lead-/)
})
