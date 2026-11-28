import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'

/** What the Setup window checks on every launch (#89). Settings lists the same. */
export type Checks = {
  /** ffmpeg 4.4 or newer runs. ffmpegVersion: what `ffmpeg -version` names, 'unknown' when it names none, null when it does not run. */
  ffmpeg: boolean
  ffmpegVersion: string | null
  ffprobe: boolean
  /** The first of AGENTS on PATH, or null. */
  agent: Agent | null
  skill: 'current' | 'missing' | 'outdated'
  browser: boolean
  /** Homebrew on the merged PATH: a Mac's brew rows need it. */
  brew: boolean
}

/** The Agent commands Setup looks for (ADR 0008), the suggested one first. */
export const AGENTS = ['claude', 'codex', 'opencode', 'gemini', 'grok', 'cursor-agent'] as const
export type Agent = (typeof AGENTS)[number]

type Env = Record<string, string | undefined>

const isFile = (path: string) => {
  try {
    return !!statSync(path, { throwIfNoEntry: false })?.isFile()
  } catch {
    return false
  }
}

export const ffmpegVersion = (out: string) => /^ffmpeg version (\S+)/.exec(out)?.[1] ?? null

/** 4.4 or newer. Git builds name a commit ("N-112345-g...") or a date instead of a release: those are new. */
export function ffmpegNewEnough(version: string) {
  const v = /^n?(\d+)(?:\.(\d+))?/.exec(version)
  if (v && !/^\d{4}-/.test(version)) return +v[1] > 4 || (+v[1] === 4 && +(v[2] ?? 0) >= 4)
  return /^(N-|\d{4}-\d{2}-\d{2})/.test(version)
}

/** The program's path on PATH, or null. Found, not run: on Windows any PATHEXT name counts (an npm .cmd shim too). */
export function findOnPath(name: string, env: Env = process.env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    const d = dir.replace(/^"(.*)"$/, '$1')
    if (!d) continue
    for (const ext of exts) {
      const path = join(d, name + ext.toLowerCase())
      if (isFile(path) && (process.platform === 'win32' || canRun(path))) return path
    }
  }
  return null
}

export const findAgent = (env: Env = process.env) => AGENTS.find((a) => findOnPath(a, env)) ?? null

// Off Windows a program must carry the execute bit: a 0644 file left by a broken install is not one.
const canRun = (path: string) => {
  try {
    return accessSync(path, constants.X_OK), true
  } catch {
    return false
  }
}

// Files Finder and Explorer drop in any folder they show: not an edit to the skill.
const OS_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

/** sha256 of every file under dir (paths and bytes), or null when there is no folder. */
export function hashFolder(dir: string) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return null
  const hash = createHash('sha256')
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => f.replaceAll('\\', '/')).sort()) {
    const file = join(dir, rel)
    if (!isFile(file) || OS_FILES.has(basename(rel))) continue
    const bytes = readFileSync(file)
    hash.update(`${rel}\0${bytes.length}\0`).update(bytes)
  }
  return hash.digest('hex')
}

/** The installed copy against the repo's, by hash: a version field would go stale the first time nobody bumps it. */
export function skillState(from: string, to: string): Checks['skill'] {
  const installed = hashFolder(to)
  if (installed === null) return existsSync(to) ? 'outdated' : 'missing' // a file there is the user's: Update asks first
  return installed === hashFolder(from) ? 'current' : 'outdated'
}

/**
 * KapeCut owns the installed folder: it is replaced whole, so nothing of an old copy stays to break the hash. The new
 * copy is made beside ~/.claude/skills (never in it, where Claude Code would load it), then swapped in, so a failed copy
 * leaves the old one as it was.
 */
export function installSkill(from: string, to: string) {
  if (hashFolder(from) === null) throw new Error(`KapeCut's own skill is missing: ${from}`)
  const [fresh, old] = ['.kapecut-skill-new', '.kapecut-skill-old'].map((name) => join(dirname(dirname(to)), name))
  for (const dir of [fresh, old]) rmSync(dir, { recursive: true, force: true })
  cpSync(from, fresh, { recursive: true })
  mkdirSync(dirname(to), { recursive: true }) // a first install: no ~/.claude/skills yet
  if (existsSync(to)) renameSync(to, old)
  try {
    renameSync(fresh, to)
  } catch (e) {
    if (existsSync(old)) renameSync(old, to)
    throw e
  }
  try {
    rmSync(old, { recursive: true, force: true })
  } catch (e) {
    console.error('[kapecut] the new skill is in place; could not remove the old copy:', e) // the next install clears it
  }
}

const BROWSERS_WIN = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']
const BROWSERS_MAC = ['Google Chrome', 'Microsoft Edge', 'Chromium']
// Flatpak puts its launchers (named by app id) on PATH too, in /var/lib/flatpak/exports/bin.
const BROWSERS_LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'com.google.Chrome', 'org.chromium.Chromium', 'com.microsoft.Edge']

/** Chrome or Edge at their install paths (on Windows they are not on PATH), for the skill's stills. Any Chromium works. */
export function findBrowser(env: Env = process.env) {
  if (process.platform === 'win32')
    return [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].some((root) => root && BROWSERS_WIN.some((b) => isFile(join(root, b))))
  // ~/Applications: a Mac install without admin rights
  if (process.platform === 'darwin')
    return ['/Applications', join(homedir(), 'Applications')].some((apps) => BROWSERS_MAC.some((b) => isFile(`${apps}/${b}.app/Contents/MacOS/${b}`)))
  return BROWSERS_LINUX.some((b) => findOnPath(b, env))
}

/** Every check passed: the Setup window lets the user in. The skill is an optional extra for Claude Code (ADR 0008). */
export const allPass = (c: Checks) => c.ffmpeg && c.ffprobe && !!c.agent && c.browser

// No shell, the same way Export spawns ffmpeg, so a found ffmpeg is one Export can run (an ffmpeg.cmd would not be).
// 30 s: a first run after boot can wait on the virus scanner, and a timeout would lock the editor as "not on PATH".
const run = (tool: string, args: string[]) =>
  new Promise<string | null>((done) => execFile(tool, args, { windowsHide: true, timeout: 30_000 }, (err, out) => done(err ? null : out)))

export type Media = Pick<Checks, 'ffmpeg' | 'ffmpegVersion' | 'ffprobe'>

/** ffmpeg and ffprobe only: what Export needs, without the rest of the checks. */
export async function mediaChecks(): Promise<Media> {
  const [ffmpegOut, ffprobeOut] = await Promise.all([run('ffmpeg', ['-version']), run('ffprobe', ['-version'])])
  const version = ffmpegOut === null ? null : (ffmpegVersion(ffmpegOut) ?? 'unknown') // runs, names none: too old
  return { ffmpeg: !!version && ffmpegNewEnough(version), ffmpegVersion: version, ffprobe: ffprobeOut !== null }
}

export async function runChecks(skillFrom: string, skillTo: string): Promise<Checks> {
  return {
    ...(await mediaChecks()),
    agent: findAgent(),
    skill: skillState(skillFrom, skillTo),
    browser: findBrowser(),
    brew: !!findOnPath('brew'),
  }
}

/** PATH with the entries `reg query ... /v Path` outputs name that it lacks, in their order, %VARS% expanded from env. */
export function mergePath(path: string, regOutputs: string[], env: Env) {
  const dirs = path.split(';').filter(Boolean)
  const seen = new Set(dirs.map((d) => d.toLowerCase()))
  for (const out of regOutputs)
    for (const raw of (/^\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out)?.[1].trim() ?? '').split(';')) {
      const dir = raw.replace(/%([^%]+)%/g, (all, name: string) => env[name] ?? all)
      if (dir && !seen.has(dir.toLowerCase())) seen.add(dir.toLowerCase()), dirs.push(dir)
    }
  return dirs.join(';')
}

/**
 * Mac apps started from Finder or the Dock, and many Linux launchers, get only /usr/bin:/bin. So off Windows PATH
 * also gets the folders Homebrew (ffmpeg) and the Claude Code native installer put their programs in.
 */
export function withInstallDirs(path: string, home: string) {
  const dirs = path.split(':').filter(Boolean)
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`]) if (!dirs.includes(dir)) dirs.push(dir)
  return dirs.join(':')
}

const PATH_KEYS = ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment']

/**
 * An installer writes PATH to the registry; a running app (and the terminal that started it) keeps the old one. So a
 * Re-check reads it again on Windows, and Export then runs the ffmpeg it found.
 */
export async function refreshPath() {
  if (process.platform !== 'win32') return
  const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe') // by path: PATH may be what is broken
  const outs = await Promise.all(PATH_KEYS.map((key) => run(reg, ['query', key, '/v', 'Path'])))
  process.env.PATH = mergePath(process.env.PATH ?? '', outs.map((o) => o ?? ''), process.env)
}
