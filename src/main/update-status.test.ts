import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { releasePage } from './update-status'

test('releasePage opens only the Release of a plain version on the KapeCut repo', () => {
  expect(releasePage('9.9.9')).toBe('https://github.com/brewed-ops/KapeCut/releases/tag/v9.9.9')
  expect(releasePage('1.2.3-beta.1')).toBe('https://github.com/brewed-ops/KapeCut/releases/tag/v1.2.3-beta.1')
  for (const bad of ['', '9.9', 'v9.9.9', '9.9.9/../../evil', '9.9.9?x=1', '9.9.9#a', 'https://evil.example', '9.9.9\n'])
    expect(releasePage(bad), bad).toBeNull()
})

test('the Release page is on the repo the updater reads (package.json build.publish)', () => {
  const { owner, repo } = JSON.parse(readFileSync('package.json', 'utf8')).build.publish
  expect(releasePage('1.0.0')).toBe(`https://github.com/${owner}/${repo}/releases/tag/v1.0.0`)
})
