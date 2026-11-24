import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// #95: one base-layer rule hides [hidden]; per-element copies and :not([hidden]) guards must not come back.
const app = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const BASE = /@layer base\s*\{\s*\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}\s*\}/
const rules = [...app.replace(BASE, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
const sets = (body: string, re: RegExp) => body.split(';').some((d) => re.test(d))

test('app.css hides [hidden] once, in the base layer', () => {
  expect(app).toMatch(BASE)
  expect(rules.filter((r) => r.selector.includes('[hidden]') && sets(r.body, /^\s*display\s*:/)).map((r) => r.selector)).toEqual([])
})

test('no rule guards with :not([hidden]), except the editor hiding behind Setup', () => {
  const guarded = rules.filter((r) => r.selector.includes(':not([hidden])')).map((r) => r.selector)
  expect(guarded).toEqual(['body:has(> #setup:not([hidden])) > main'])
})

// An unlayered display !important still loses to the base rule, so it could only look like it shows a hidden element.
test('no other display !important', () => {
  expect(rules.filter((r) => sets(r.body, /^\s*display\s*:[^;]*!important/)).map((r) => r.selector)).toEqual([])
})
