import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ffmpegNewEnough, ffmpegVersion, findOnPath, hashFolder, installSkill, mergePath, skillState, withInstallDirs } from './setup-checks'

const made: string[] = []
afterEach(() => made.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
const folder = () => (made.push(mkdtempSync(join(tmpdir(), 'kapecut-checks-'))), made.at(-1)!)
const skill = (dir: string) => {
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), 'the skill')
  writeFileSync(join(dir, 'sub', 'starter.html'), 'a starter')
  return dir
}

it('reads the version from the first line of ffmpeg -version', () => {
  expect(ffmpegVersion('ffmpeg version 7.1-essentials_build-www.gyan.dev Copyright (c) 2000-2024\nbuilt with gcc')).toBe('7.1-essentials_build-www.gyan.dev')
  expect(ffmpegVersion('not ffmpeg at all')).toBeNull()
})

it('takes ffmpeg 4.4 or newer, and git builds (a commit or a date) as new', () => {
  for (const v of ['4.4', '4.4.2-0ubuntu0.22.04.1', 'n4.4.1', '5', '6.1.1', '7.1-essentials_build-www.gyan.dev', '10.0', 'N-112345-g1a2b3c4d5e', '2024-03-01-git-1a2b3c-full_build-www.gyan.dev'])
    expect(ffmpegNewEnough(v), v).toBe(true)
  for (const v of ['4.3.1', '4.2.7-0ubuntu0.1', 'n3.4', '2.8.17', 'git-unknown', ''])
    expect(ffmpegNewEnough(v), v).toBe(false)
})

it('finds a program on PATH without running it, a .cmd shim included on Windows', () => {
  const empty = folder()
  const bin = folder()
  const name = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  writeFileSync(join(bin, name), '', { mode: 0o755 })
  if (process.platform !== 'win32') writeFileSync(join(empty, 'claude'), '', { mode: 0o644 }) // not runnable: skipped
  mkdirSync(join(bin, 'ffmpeg')) // a folder by that name is not the program
  const env = { PATH: [empty, `"${bin}"`].join(delimiter), PATHEXT: '.COM;.EXE;.BAT;.CMD' }
  expect(findOnPath('claude', env)).toBe(join(bin, name))
  expect(findOnPath('ffmpeg', env)).toBeNull()
  expect(findOnPath('claude', { PATH: empty })).toBeNull()
  expect(findOnPath('claude', {})).toBeNull()
})

it('hashes every file in a folder: any change, added or removed file changes it', () => {
  const a = skill(folder())
  const b = skill(folder())
  expect(hashFolder(a)).toBe(hashFolder(b))
  writeFileSync(join(b, 'sub', 'starter.html'), 'a starter!')
  expect(hashFolder(b)).not.toBe(hashFolder(a))
  writeFileSync(join(b, 'sub', 'starter.html'), 'a starter')
  writeFileSync(join(b, 'notes.md'), '')
  expect(hashFolder(b)).not.toBe(hashFolder(a))
  expect(hashFolder(join(a, 'nothing-here'))).toBeNull()
})

it('says the installed skill is missing, outdated or current, and installs it whole', () => {
  const from = skill(folder())
  const to = join(folder(), '.claude', 'skills', 'kapecut')
  expect(skillState(from, to)).toBe('missing')
  installSkill(from, to)
  expect(skillState(from, to)).toBe('current')
  expect(readFileSync(join(to, 'sub', 'starter.html'), 'utf8')).toBe('a starter')
  writeFileSync(join(to, 'SKILL.md'), 'my own edit')
  writeFileSync(join(to, 'extra.md'), 'left over')
  expect(skillState(from, to)).toBe('outdated')
  installSkill(from, to) // an update replaces the folder: nothing of the old copy stays
  expect(skillState(from, to)).toBe('current')
  for (const junk of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) writeFileSync(join(to, 'sub', junk), 'the OS wrote this')
  expect(skillState(from, to)).toBe('current') // a file browser's own files are not an edit
})

it('a plain file where the skill goes is the user\'s, so it asks (outdated), never missing', () => {
  const to = join(folder(), 'kapecut')
  writeFileSync(to, 'not a folder')
  expect(skillState(skill(folder()), to)).toBe('outdated')
})

it('a failed install leaves the installed copy as it was', () => {
  const from = skill(folder())
  const to = join(folder(), '.claude', 'skills', 'kapecut')
  installSkill(from, to)
  writeFileSync(join(to, 'SKILL.md'), 'my own edit')
  expect(() => installSkill(join(from, 'gone'), to)).toThrow(/missing/)
  expect(readFileSync(join(to, 'SKILL.md'), 'utf8')).toBe('my own edit')
  expect(readdirSync(dirname(to))).toEqual(['kapecut']) // nothing left beside it for Claude Code to load as a skill
})

it('off Windows, adds the folders Homebrew and the Claude Code installer use, once each', () => {
  expect(withInstallDirs('/usr/bin:/bin', '/Users/k')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/k/.local/bin')
  expect(withInstallDirs('/usr/local/bin:/usr/bin', '/home/k')).toBe('/usr/local/bin:/usr/bin:/opt/homebrew/bin:/home/k/.local/bin')
  expect(withInstallDirs('', '/home/k')).toBe('/opt/homebrew/bin:/usr/local/bin:/home/k/.local/bin')
})

it('adds the PATH entries the registry has and the app does not, with %VARS% expanded', () => {
  const user = 'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\Tools\r\n\r\n'
  const machine = 'HKEY_LOCAL_MACHINE\\...\\Environment\r\n    Path    REG_SZ    C:\\WINDOWS\\system32;c:\\tools\r\n'
  expect(mergePath('C:\\Windows\\System32', [machine, user, ''], { USERPROFILE: 'C:\\Users\\k' })).toBe(
    'C:\\Windows\\System32;c:\\tools;C:\\Users\\k\\.local\\bin', // machine first, as Windows builds PATH
  )
  expect(mergePath('', ['ERROR: The system was unable to find the specified registry key or value.'], {})).toBe('')
})
