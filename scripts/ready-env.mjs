// Every e2e and shot launch gets past the Setup window (#89) without touching the real home: this points USERPROFILE /
// HOME at a temp home holding a copy of skills/kapecut, and puts a dummy codex on PATH (CI has no Agent; the app only
// looks for one, and any Agent passes, ADR 0008). ffmpeg and Chrome or Edge come from the machine. Launches spread
// process.env, so they all inherit it. Playwright runs it as globalSetup (its return is the teardown); the shot
// scripts call it themselves.
// It also holds one lock per repo (in the git dir every worktree shares), so parallel agents' Electron runs queue
// instead of starving the machine into false timeouts.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// shortcut: two waiters taking over the same dead lock at once can both run; fine for a dev-machine queue.
export function holdLock(file, log = console.log) {
  for (let said = false; ; ) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' })
      return () => rmSync(file, { force: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let pid = 0
    let old = false
    try {
      pid = Number(readFileSync(file, 'utf8'))
      old = statSync(file).mtimeMs < Date.now() - 2 * 3600_000 // its pid may now belong to another process
    } catch {} // released between the two calls: try again
    // An empty file (pid 0) is a holder that has not written yet: wait. Junk or a dead or old holder: take it over.
    if (!Number.isInteger(pid) || (pid && (!alive(pid) || old))) rmSync(file, { force: true })
    else {
      if (!said && pid) log(`Waiting for another KapeCut e2e or shot run to finish (pid ${pid}, ${file})`)
      said ||= !!pid
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
}

export default function readyEnv() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const gitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
  const release = holdLock(resolve(root, gitDir, 'kapecut-e2e.lock'))
  const home = mkdtempSync(join(tmpdir(), 'kapecut-home-'))
  cpSync(fileURLToPath(new URL('../skills/kapecut', import.meta.url)), join(home, '.claude', 'skills', 'kapecut'), { recursive: true })
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex'), '', { mode: 0o755 })
  process.env.USERPROFILE = process.env.HOME = home
  process.env.PATH = bin + delimiter + (process.env.PATH ?? '')
  process.env.KAPECUT_DUMMY_BIN = bin // a PATH of only this: an Agent found, ffmpeg missing (the Setup prompt)
  process.env.KAPECUT_HIDDEN ||= '1' // no window on screen, no focus steal (#91); KAPECUT_HIDDEN=0 shows them for debugging
  return () => {
    try {
      rmSync(home, { recursive: true, force: true })
    } finally {
      release()
    }
  }
}
