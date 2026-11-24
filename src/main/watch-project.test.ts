import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { watchProject } from './watch-project'

const until = async (check: () => boolean, ms = 3000) => {
  for (const start = Date.now(); !check(); await new Promise((r) => setTimeout(r, 20)))
    if (Date.now() - start > ms) throw new Error('timed out')
}

let stop = () => {}
let dir = ''
afterEach(() => {
  stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('watchProject', () => {
  it('reports one save of a Scene file once, by its path inside the Project', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kapecut-'))
    mkdirSync(join(dir, 'scenes'))
    writeFileSync(join(dir, 'scenes', 'a.html'), 'v1')
    const seen: string[] = []
    stop = watchProject(dir, (file) => seen.push(file), 50)
    await new Promise((r) => setTimeout(r, 50)) // let the OS watcher arm

    writeFileSync(join(dir, 'scenes', 'a.html'), 'v2')
    await until(() => seen.length > 0)
    await new Promise((r) => setTimeout(r, 150))
    expect(seen).toEqual(['scenes/a.html'])
  })

  it('does not throw when the Project folder is missing', () => {
    dir = join(tmpdir(), 'kapecut-missing-' + Date.now())
    expect(() => (stop = watchProject(dir, () => {}))).not.toThrow()
  })
})
