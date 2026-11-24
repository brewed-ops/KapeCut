import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('Settings starts disabled: a click before wireSettings listens would open nothing (#150)', () => {
  const button = readFileSync('src/renderer/index.html', 'utf8').match(/<button id="settings"[^>]*>/)?.[0]
  expect(button).toMatch(/\sdisabled[\s>]/)
})
