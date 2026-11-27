import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const SCRIPT = join(__dirname, '../../scripts/install-mac.sh')
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

// A DMG holding a stand-in KapeCut.app, as electron-builder lays it out (the app at the volume's root). Its app is
// quarantined, as a browser download's is, so only the script's own xattr can clear the flag.
function fakeDmg(version: string, name = 'source.dmg') {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-dmg-'))
  dirs.push(dir)
  const app = join(dir, 'src', 'KapeCut.app', 'Contents')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'version'), version)
  execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Chrome;', join(app, 'version')])
  const dmg = join(dir, name) // not KapeCut.dmg, the name the script mounts its own copy under
  execFileSync('hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-volname', 'KapeCut', '-srcfolder', join(dir, 'src'), dmg], { timeout: 60_000 })
  return dmg
}

const install = (dmg: string, apps: string, env: NodeJS.ProcessEnv = {}) =>
  execFileSync('bash', [SCRIPT], {
    env: { ...process.env, KAPECUT_DMG_URL: `file://${dmg}`, KAPECUT_APPS: apps, KAPECUT_TEST: '1', ...env },
    encoding: 'utf8',
    timeout: 120_000,
  })

// An Intel Mac to the script: a sysctl ahead on PATH that says the Mac has no arm64
function intelPath() {
  const bin = mkdtempSync(join(tmpdir(), 'kapecut-intel-'))
  dirs.push(bin)
  writeFileSync(join(bin, 'sysctl'), '#!/bin/sh\necho 0\n', { mode: 0o755 })
  return { PATH: `${bin}:${process.env.PATH}` }
}

describe.runIf(process.platform === 'darwin')('scripts/install-mac.sh', () => {
  test('an Intel Mac installs the universal dmg (#16)', () => {
    const apps = mkdtempSync(join(tmpdir(), 'kapecut-apps-'))
    dirs.push(apps)
    install(fakeDmg('3', 'KapeCut-0.0.3-universal.dmg'), apps, intelPath())
    expect(readFileSync(join(apps, 'KapeCut.app', 'Contents', 'version'), 'utf8')).toBe('3')
  }, 180_000)

  test('an Intel Mac is stopped before an Apple silicon only dmg, with nothing installed', () => {
    const apps = mkdtempSync(join(tmpdir(), 'kapecut-apps-'))
    dirs.push(apps)
    expect(() => install(join(apps, 'KapeCut-0.0.2-arm64.dmg'), apps, intelPath())).toThrow(/Apple silicon \(M1 and later\) only/)
    expect(existsSync(join(apps, 'KapeCut.app'))).toBe(false)
  })

  test('puts KapeCut.app in Applications with no quarantine flag, so Gatekeeper lets it open', () => {
    const apps = mkdtempSync(join(tmpdir(), 'kapecut-apps-'))
    dirs.push(apps)
    install(fakeDmg('1'), apps)
    const app = join(apps, 'KapeCut.app')
    expect(readFileSync(join(app, 'Contents', 'version'), 'utf8')).toBe('1')
    expect(execFileSync('xattr', ['-lr', app], { encoding: 'utf8' })).not.toContain('com.apple.quarantine')
  }, 180_000)

  test('replaces an older KapeCut whole and leaves no disk image mounted', () => {
    const apps = mkdtempSync(join(tmpdir(), 'kapecut-apps-'))
    dirs.push(apps)
    mkdirSync(join(apps, 'KapeCut.app', 'Contents'), { recursive: true })
    writeFileSync(join(apps, 'KapeCut.app', 'Contents', 'stale'), 'old file')
    const dmg = fakeDmg('2')
    install(dmg, apps)
    expect(readFileSync(join(apps, 'KapeCut.app', 'Contents', 'version'), 'utf8')).toBe('2')
    expect(existsSync(join(apps, 'KapeCut.app', 'Contents', 'stale'))).toBe(false)
    // The script mounts its download as <temp>/KapeCut.dmg: none may be left attached.
    expect(execFileSync('hdiutil', ['info'], { encoding: 'utf8' })).not.toMatch(/image-path\s*:.*\/KapeCut\.dmg$/m)
  }, 180_000)
})
