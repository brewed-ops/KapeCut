import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
// @ts-expect-error the script is plain .mjs with no types
import { holdLock } from '../../scripts/ready-env.mjs'

// Parallel agents each ran the full e2e at once and starved the machine into false failures (retro, 2026-11-24):
// readyEnv() holds one lock per repo, so Electron runs from every worktree queue instead.
const lockFile = () => join(mkdtempSync(join(tmpdir(), 'kapecut-lock-')), 'e2e.lock')

test('takes a free lock and gives it back', () => {
  const file = lockFile()
  const release = holdLock(file, () => {})
  expect(readFileSync(file, 'utf8')).toBe(String(process.pid))
  release()
  expect(existsSync(file)).toBe(false)
})

test('waits while another live process holds it', () => {
  const file = lockFile()
  // The holder is a grandchild left to the OS: a child of ours that exits stays a zombie (still "alive" to kill 0) on
  // macOS and Linux until our event loop reaps it, and holdLock blocks that loop.
  const pid = spawnSync(process.execPath, ['-e', "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { detached: true, stdio: 'ignore' }); c.unref(); console.log(c.pid)"]).stdout.toString().trim()
  writeFileSync(file, pid)
  const said: string[] = []
  const start = Date.now()
  holdLock(file, (m: string) => said.push(m))()
  expect(Date.now() - start).toBeGreaterThan(1000)
  expect(said.join()).toContain(pid)
})

test.each([
  ['whose holder died', () => String(spawnSync(process.execPath, ['-e', '']).pid), 0],
  ['holding junk', () => 'not a pid', 0],
  ['older than 2 h (its pid may be reused)', () => String(process.ppid), 3 * 3600],
])('takes over a lock %s', (_, holder, ageSeconds) => {
  const file = lockFile()
  writeFileSync(file, holder())
  if (ageSeconds) utimesSync(file, Date.now() / 1000 - ageSeconds, Date.now() / 1000 - ageSeconds)
  const start = Date.now()
  holdLock(file, () => {})()
  expect(Date.now() - start).toBeLessThan(500)
})
