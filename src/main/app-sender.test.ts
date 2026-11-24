import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, expect, it, vi } from 'vitest'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, fn: (e: unknown, ...args: unknown[]) => unknown) => handlers.set(c, fn),
    on: (c: string, fn: (e: unknown, ...args: unknown[]) => unknown) => handlers.set(c, fn),
  },
}))
const { handle, on } = await import('./app-sender')

const top = { url: 'kapecut://app/index.html', parent: null }
const event = (senderFrame: unknown) => ({ senderFrame }) as { senderFrame: unknown; returnValue?: unknown }
// What a message can come from besides the app page: a Scene frame, the window sent to another page (a Scene can set
// top.location), a frame already gone.
const strangers = [
  { url: 'kapecut://app/project/a.html', parent: top },
  { url: 'kapecut://app/project/a.html', parent: null }, // a Project page in the window: same origin, not the app
  { url: 'https://example.com/', parent: null },
  { url: 'kapecut://evil/index.html', parent: null },
  { url: 'file:///C:/kapecut/index.html', parent: null },
  null,
]

beforeEach(() => handlers.clear())

it('runs a handler for the app page and refuses every other sender', async () => {
  const fn = vi.fn((_e: unknown, n: number) => n + 1)
  handle('x', fn)
  expect(await handlers.get('x')!(event(top), 1)).toBe(2)
  for (const f of strangers) expect(() => handlers.get('x')!(event(f), 1)).toThrow('Refused')
  expect(fn).toHaveBeenCalledTimes(1)
})

it('every main and preload file reaches ipcMain only through this guard', () => {
  // shortcut: matches the name; an alias of electron's export would slip by. Comments mentioning it count, keep them out.
  const root = fileURLToPath(new URL('../', import.meta.url))
  const files = ['main', 'preload'].flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.ts') && !f.startsWith('app-sender')).map((f) => join(root, d, f)))
  expect(files).toContain(join(root, 'main', 'index.ts')) // the folders are the right ones
  expect(files.filter((f) => readFileSync(f, 'utf8').includes('ipcMain'))).toEqual([])
})

it('answers a sync message from the app page only; any other sender gets null', () => {
  on('y', (e) => (e.returnValue = 'dark'))
  const ok = event(top)
  handlers.get('y')!(ok)
  expect(ok.returnValue).toBe('dark')
  for (const f of strangers) {
    const e = event(f)
    handlers.get('y')!(e)
    expect(e.returnValue).toBeNull()
  }
})
