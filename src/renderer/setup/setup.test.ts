import { expect, test } from 'vitest'
import { allPass, type Checks } from '../../main/setup-checks'
import { osOf, setupPrompt, setupRows } from './setup'

const ALL: Checks = { ffmpeg: true, ffmpegVersion: '7.1', ffprobe: true, claude: true, skill: 'current', browser: true }
const row = (c: Partial<Checks>, id: string, os = osOf('Win32')) => setupRows({ ...ALL, ...c }, os).find((r) => r.id === id)!

test('every check passes: every row is ok, none offers a fix', () => {
  const rows = setupRows(ALL, 'win')
  expect(rows.map((r) => r.id)).toEqual(['ffmpeg', 'claude', 'skill', 'browser'])
  for (const r of rows) expect([r.ok, r.command, r.skill], r.id).toEqual([true, undefined, undefined])
})

test('a missing tool shows the install command for this OS; KapeCut never runs it', () => {
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg')).toMatchObject({ ok: false, command: 'winget install Gyan.FFmpeg' })
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg', osOf('MacIntel')).command).toBe('brew install ffmpeg')
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg', osOf('Linux x86_64')).command).toBe('sudo apt install ffmpeg')
  expect(row({ ffprobe: false }, 'ffmpeg')).toMatchObject({ ok: false, command: 'winget install Gyan.FFmpeg' }) // they ship together
  expect(row({ claude: false }, 'claude')).toMatchObject({ ok: false, command: 'powershell -c "irm https://claude.ai/install.ps1 | iex"' })
  expect(row({ claude: false }, 'claude', osOf('Linux x86_64')).command).toBe('curl -fsSL https://claude.ai/install.sh | bash')
  expect(row({ browser: false }, 'browser', osOf('MacIntel')).command).toBe('brew install --cask google-chrome')
})

test('the ffmpeg row says which: missing, too old (naming its version) or nameless', () => {
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg').detail).toBe('ffmpeg is not on PATH. Export encodes the MP4 with it')
  expect(row({ ffmpeg: false, ffmpegVersion: '4.2.7' }, 'ffmpeg').detail).toBe('ffmpeg 4.2.7 is too old. Export needs 4.4 or newer')
  expect(row({ ffmpeg: false, ffmpegVersion: 'unknown' }, 'ffmpeg').detail).toBe('ffmpeg runs but names no version. Export needs 4.4 or newer')
  expect(row({ ffprobe: false }, 'ffmpeg').detail).toBe('ffprobe is not on PATH. It comes with ffmpeg')
})

test('the skill row offers Install when missing and Update when the copy differs', () => {
  expect(row({ skill: 'missing' }, 'skill')).toMatchObject({ ok: false, skill: 'missing' })
  expect(row({ skill: 'outdated' }, 'skill')).toMatchObject({ ok: false, skill: 'outdated' })
})

test("main's gate and the rows agree on every single failure", () => {
  const fails: Partial<Checks>[] = [{ ffmpeg: false }, { ffprobe: false }, { claude: false }, { skill: 'missing' }, { skill: 'outdated' }, { browser: false }]
  expect(allPass(ALL)).toBe(true)
  for (const f of fails) expect([allPass({ ...ALL, ...f }), setupRows({ ...ALL, ...f }, 'win').every((r) => r.ok)], JSON.stringify(f)).toEqual([false, false])
})

test('the setup prompt names each missing tool with its command for this OS, and asks for a Re-check after', () => {
  const missing = { ffmpeg: false, ffmpegVersion: null, browser: false }
  expect(setupPrompt(setupRows({ ...ALL, ...missing }, 'win'), 'win')).toBe(`KapeCut needs these tools on this Windows computer. Run each install command in a terminal and check it worked:
- ffmpeg 4.4+ (ffmpeg is not on PATH. Export encodes the MP4 with it): winget install Gyan.FFmpeg
- Chrome or Edge (Not found. Your agent checks each Scene with a still from it): winget install Google.Chrome
A tool that is there but too old: upgrade it and make sure the new one comes first on PATH.
A command that stops for my password (sudo) or an agreement (winget): give it to me to run in my own terminal.
When they are all installed, tell me to press Re-check in KapeCut's Setup window.`)
  const mac = setupPrompt(setupRows({ ...ALL, browser: false }, 'mac'), 'mac')!
  expect(mac).toContain('this macOS computer')
  expect(mac).toContain('- Chrome or Edge (Not found. Your agent checks each Scene with a still from it): brew install --cask google-chrome\n')
  expect(mac).not.toContain('ffmpeg')
  const linux = setupPrompt(setupRows({ ...ALL, ffprobe: false }, 'linux'), 'linux')!
  expect(linux).toContain('this Linux computer')
  expect(linux).toContain('- ffmpeg 4.4+ (ffprobe is not on PATH. It comes with ffmpeg): sudo apt install ffmpeg\n')
})

test('no setup prompt without Claude Code to run it, or with no command to run', () => {
  expect(setupPrompt(setupRows({ ...ALL, claude: false, browser: false }, 'win'), 'win')).toBeNull()
  expect(setupPrompt(setupRows({ ...ALL, skill: 'missing' }, 'win'), 'win')).toBeNull() // the skill has its own button
  expect(setupPrompt(setupRows(ALL, 'win'), 'win')).toBeNull()
})
