import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The K is drawn in three places (docs/design/logo.md): the mark SVG the icons render from, the logo SVG and the
// header. They must not drift apart, and the SVGs (which cannot read CSS variables) use only token colours.
const read = (path: string) => readFileSync(path, 'utf8')
const paths = (svg: string) => [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])

test('the header and the logo draw the same K as the mark', () => {
  const mark = paths(read('resources/logo/kapecut-mark.svg'))
  expect(mark).toEqual(['M10 12h9v40h-9z', 'M42 12h11L35 32l18 20H42L25 32z'])
  expect(paths(read('resources/logo/kapecut-logo.svg'))).toEqual(mark)
  const h1 = read('src/renderer/index.html').match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? ''
  expect(paths(h1)).toEqual(mark)
})

test('the logo SVGs use only the token colours', () => {
  const tokens = read('src/renderer/styles/tokens.css').toLowerCase()
  for (const file of ['kapecut-mark.svg', 'kapecut-logo.svg']) {
    // Every fill / stroke / *-color value, as an attribute or in a style, must be a token's 6-digit hex.
    const colours = [...read(`resources/logo/${file}`).matchAll(/(?:fill|stroke|color)\s*[=:]\s*"?([^";\s>]+)/gi)].map((m) => m[1])
    expect(colours.length, file).toBeGreaterThan(0)
    for (const c of colours) {
      expect(c, `${file}: ${c}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(tokens, `${file}: ${c}`).toContain(c.toLowerCase())
    }
  }
})
