import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { writeSession } from './session-file'

const made: string[] = []
afterEach(() => made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
const folder = () => (made.push(mkdtempSync(join(tmpdir(), 'kapecut-session-'))), made.at(-1)!)
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
// These block the rename the way Windows does when another process holds the file; elsewhere the rename fails at once.
const onWindows = it.skipIf(process.platform !== 'win32')

it('writes session.json naming the open Project, with no temp file left', async () => {
  const userData = folder()
  const file = join(userData, 'session.json')
  await writeSession(file, 'C:\\a')
  await writeSession(file, 'D:\\Videos\\Lumen')
  expect(read(file)).toEqual({ version: 1, project: 'D:\\Videos\\Lumen' })
  expect(readdirSync(userData)).toEqual(['session.json'])
})

onWindows('the last Project opened wins, even when an earlier write is still retrying its rename', async () => {
  const file = join(folder(), 'session.json')
  mkdirSync(file) // the rename fails until this goes
  const done: string[] = []
  const a = writeSession(file, 'C:\\a').then(() => done.push('a'))
  const b = writeSession(file, 'C:\\b').then(() => done.push('b'))
  setTimeout(() => rmSync(file, { recursive: true }), 300)
  await Promise.all([a, b])
  expect(done).toEqual(['a', 'b'])
  expect(read(file)).toEqual({ version: 1, project: 'C:\\b' })
})

onWindows('a write that fails does not stop the next one', async () => {
  const file = join(folder(), 'session.json')
  mkdirSync(file)
  const failed = writeSession(file, 'C:\\a')
  const next = writeSession(file, 'C:\\b')
  await expect(failed).rejects.toThrow()
  rmSync(file, { recursive: true })
  await next
  expect(read(file)).toEqual({ version: 1, project: 'C:\\b' })
})

onWindows('a write that fails removes the old file, which names the Project open before', async () => {
  const file = join(folder(), 'session.json')
  writeFileSync(file, JSON.stringify({ version: 1, project: 'C:\\old' }))
  chmodSync(file, 0o444) // read-only: the rename over it fails
  await expect(writeSession(file, 'C:\\new')).rejects.toThrow()
  expect(existsSync(file)).toBe(false)
})
