import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// Motion foundation (#77): every timing lives in tokens.css, and only transform and opacity animate.
const css = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

test('tokens.css has the motion tokens', () => {
  const tokens = css('tokens.css')
  for (const name of ['--dur-press', '--dur-fast', '--dur-s', '--dur-m', '--dur-l', '--ease-spring', '--ease-out', '--press-scale', '--press-tone', '--ease-spring-bounce', '--dur-bounce', '--pop-scale'])
    expect(tokens, name).toMatch(new RegExp(`${name}\\s*:`))
})

test('app.css has no hard-coded duration or easing curve', () => {
  const app = css('app.css')
  expect(app.match(/\b\d*\.?\d+m?s\b/g)).toBeNull()
  expect(app.match(/cubic-bezier\(|linear\(|steps\(/g)).toBeNull()
  // Keyframes run to their end and cannot be reversed mid-way, and the reduced-motion block only reins in transitions.
  expect(app.match(/@keyframes|animation(?:-name)?\s*:/g)).toBeNull()
})

test('only transform and opacity animate', () => {
  const props = [...css('app.css').matchAll(/transition(-property)?\s*:\s*([^;}]+)/g)].flatMap((m) =>
    m[2]
      .split(',')
      // display never animates: with allow-discrete it only waits for a fade to end before it flips (#81). A
      // transition-property list takes the behaviour from transition-behavior beside it. overlay is the same for a
      // modal <dialog>: it stays in the top layer until its fade ends (#114).
      .filter((part) => !(/^\s*(display|overlay)\b/.test(part) && (m[1] || part.includes('allow-discrete'))))
      .map((part) => part.trim().split(/\s+/)[0]),
  )
  expect(props.length).toBeGreaterThan(0)
  for (const p of props) expect(['transform', 'scale', 'translate', 'opacity', 'none'], p).toContain(p)
})

test('display transitions only where a rule for the same selector makes it discrete', () => {
  const rules = [...css('app.css').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
  // A transition-property list leans on its rule's transition-behavior; the shorthand says allow-discrete itself.
  const discrete = new Set(rules.filter((r) => /\ballow-discrete\b/.test(r.body)).map((r) => r.selector))
  const withDisplay = rules.filter((r) => /transition(?:-property)?\s*:[^;}]*\b(display|overlay)\b/.test(r.body))
  expect(withDisplay.length).toBeGreaterThan(0)
  for (const r of withDisplay) expect(discrete, r.selector).toContain(r.selector)
})

test('the renderer sets no transition or animation from script, so app.css stays the one place motion lives', () => {
  const dir = new URL('..', import.meta.url)
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) expect(readFileSync(new URL(f.replaceAll('\\', '/'), dir), 'utf8'), f).not.toMatch(/\.transition\w*\s*=|\.animate\(|transition\w*['"]?\s*[:,]/)
})
