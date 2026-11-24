import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const mains = readdirSync('src/main').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

// Main reads skills/ and resources/ by their place beside out/, so the installer must ship them unpacked, in that layout.
test('every repo path main reads ships in the installer, outside an asar', () => {
  const read: string[] = []
  for (const f of mains) {
    const src = readFileSync(`src/main/${f}`, 'utf8')
    const joins = [...src.matchAll(/join\(__dirname, (['"`])([^'"`]+)\1[,)]/g)].map((m) => m[2])
    expect(joins.length, `${f}: every __dirname is a plain join(__dirname, '<path>')`).toBe(src.match(/__dirname/g)?.length ?? 0)
    read.push(...joins.filter((p) => p.startsWith('../../')).map((p) => p.slice(6).split('/').slice(0, 2).join('/')))
  }
  expect([...new Set(read)].sort()).toEqual(['resources/logo', 'skills/kapecut'])
  expect(pkg.build.asar).toBe(false)
  for (const path of [...read, 'out']) expect(pkg.build.files, path).toContain(`${path}/**`)
})
