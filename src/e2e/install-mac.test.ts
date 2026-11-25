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
function fakeDmg(version: string) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-dmg-'))
  dirs.push(dir)
  const app = join(dir, 'src', 'KapeCut.app', 'Contents')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'version'), version)
  execFileSync('xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Chrome;', join(app, 'version')])
  const dmg = join(dir, 'source.dmg') // not KapeCut.dmg, the name the script mounts its own copy under
  execFileSync('hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-volname', 'KapeCut', '-srcfolder', join(dir, 'src'), dmg], { timeout: 60_000 })
  return dmg
}

const install = (dmg: string, apps: string) =>
  execFileSync('bash', [SCRIPT], {
    env: { ...process.env, KAPECUT_DMG_URL: `file://${dmg}`, KAPECUT_APPS: apps, KAPECUT_TEST: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  })

describe.runIf(process.platform === 'darwin')('scripts/install-mac.sh', () => {
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
