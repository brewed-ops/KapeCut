import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { fileUnder } from './file-under'

const root = resolve('/projects/hello')

it('maps a URL path to a file inside the root', () => {
  expect(fileUnder(root, '/scene%201.html')).toBe(join(root, 'scene 1.html'))
  expect(fileUnder(root, '/assets/a.png')).toBe(join(root, 'assets', 'a.png'))
})

it('refuses paths that leave the root, the root itself, and malformed escapes', () => {
  expect(fileUnder(root, '/../secret.txt')).toBeNull()
  expect(fileUnder(root, '/%2e%2e%5csecret.txt')).toBeNull()
  expect(fileUnder(root, '/')).toBeNull()
  expect(fileUnder(root, '/%E0')).toBeNull()
})

it('refuses backslashes on every platform', () => {
  expect(fileUnder(root, '/a%5cb.html')).toBeNull()
})

it('refuses a link inside the root that points outside it, keeps one that stays inside', () => {
  const real = mkdtempSync(join(tmpdir(), 'kapecut-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'kapecut-outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'x')
  mkdirSync(join(real, 'assets'))
  writeFileSync(join(real, 'assets', 'a.png'), 'x')
  symlinkSync(outside, join(real, 'out'), 'junction') // a junction needs no admin rights on Windows
  symlinkSync(join(real, 'assets'), join(real, 'in'), 'junction')
  expect(fileUnder(real, '/out/secret.txt')).toBeNull()
  expect(fileUnder(real, '/in/a.png')).toBe(join(real, 'in', 'a.png'))
  expect(fileUnder(real, '/missing.wav')).toBe(join(real, 'missing.wav'))
})
