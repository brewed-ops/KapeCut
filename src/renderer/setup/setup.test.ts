import { expect, test } from 'vitest'
import { AGENTS, allPass, type Checks } from '../../main/setup-checks'
import { AGENT_NAMES, BREW, installCommand, osOf, passes, setupPrompt, setupRows } from './setup'

const ALL: Checks = { ffmpeg: true, ffmpegVersion: '7.1', ffprobe: true, agent: 'claude', skill: 'current', browser: true, brew: true }
const row = (c: Partial<Checks>, id: string, os = osOf('Win32')) => setupRows({ ...ALL, ...c }, os).find((r) => r.id === id)!

test('every check passes: every row is ok, none offers a fix', () => {
  const rows = setupRows(ALL, 'win')
  expect(rows.map((r) => r.id)).toEqual(['ffmpeg', 'agent', 'skill', 'browser'])
  for (const r of rows) expect([r.ok, r.command, r.skill], r.id).toEqual([true, undefined, undefined])
})

test('a missing tool shows the install command for this OS', () => {
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg')).toMatchObject({ ok: false, command: 'winget install Gyan.FFmpeg' })
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg', osOf('MacIntel')).command).toBe('brew install ffmpeg')
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg', osOf('Linux x86_64')).command).toBe('sudo apt install ffmpeg')
  expect(row({ ffprobe: false }, 'ffmpeg')).toMatchObject({ ok: false, command: 'winget install Gyan.FFmpeg' }) // they ship together
  expect(row({ agent: null }, 'agent')).toMatchObject({ ok: false, command: 'powershell -c "irm https://claude.ai/install.ps1 | iex"' })
  expect(row({ agent: null }, 'agent', osOf('Linux x86_64')).command).toBe('curl -fsSL https://claude.ai/install.sh | bash')
  expect(row({ browser: false }, 'browser', osOf('MacIntel')).command).toBe('brew install --cask google-chrome')
})

test('any listed Agent passes and is named; with none, Claude Code is the suggested install and the rest are named', () => {
  expect(Object.keys(AGENT_NAMES)).toEqual(AGENTS) // one list: main finds them, the row names them
  expect(row({ agent: 'codex' }, 'agent')).toMatchObject({ ok: true, name: 'Agent', detail: 'Codex on PATH' })
  expect(row({ agent: 'cursor-agent' }, 'agent').detail).toBe('Cursor Agent on PATH')
  expect(row({ agent: null }, 'agent')).toMatchObject({
    ok: false,
    name: 'Claude Code',
    detail: 'No Agent on PATH. Also works: Codex, OpenCode, Gemini CLI, Grok CLI, Cursor Agent',
  })
  for (const agent of AGENTS) expect(allPass({ ...ALL, agent }), agent).toBe(true)
})

test('the ffmpeg row says which: missing, too old (naming its version) or nameless', () => {
  expect(row({ ffmpeg: false, ffmpegVersion: null }, 'ffmpeg').detail).toBe('ffmpeg is not on PATH. Export encodes the MP4 with it')
  expect(row({ ffmpeg: false, ffmpegVersion: '4.2.7' }, 'ffmpeg').detail).toBe('ffmpeg 4.2.7 is too old. Export needs 4.4 or newer')
  expect(row({ ffmpeg: false, ffmpegVersion: 'unknown' }, 'ffmpeg').detail).toBe('ffmpeg runs but names no version. Export needs 4.4 or newer')
  expect(row({ ffprobe: false }, 'ffmpeg').detail).toBe('ffprobe is not on PATH. It comes with ffmpeg')
})

test('the skill row is optional: Install when missing, Update when the copy differs, and it never blocks', () => {
  expect(row({ skill: 'missing' }, 'skill')).toMatchObject({ ok: false, optional: true, skill: 'missing' })
  expect(row({ skill: 'outdated' }, 'skill')).toMatchObject({ ok: false, optional: true, skill: 'outdated' })
  for (const skill of ['missing', 'outdated'] as const) expect(allPass({ ...ALL, skill }), skill).toBe(true)
})

test("main's gate and the rows agree on every single failure", () => {
  const pass = (c: Checks) => passes(setupRows(c, 'win'))
  const fails: Partial<Checks>[] = [{ ffmpeg: false }, { ffprobe: false }, { agent: null }, { browser: false }]
  expect([allPass(ALL), pass(ALL)]).toEqual([true, true])
  for (const f of fails) expect([allPass({ ...ALL, ...f }), pass({ ...ALL, ...f })], JSON.stringify(f)).toEqual([false, false])
  for (const skill of ['missing', 'outdated'] as const) expect([allPass({ ...ALL, skill }), pass({ ...ALL, skill })], skill).toEqual([true, true])
})

test('the setup prompt names each missing tool with its command for this OS, and asks for a Re-check after', () => {
  const missing = { ffmpeg: false, ffmpegVersion: null, browser: false }
  expect(setupPrompt(setupRows({ ...ALL, ...missing }, 'win'), 'win')).toBe(`KapeCut needs these tools on this Windows computer. Run each install command in a terminal and check it worked:
- ffmpeg 4.4+ (ffmpeg is not on PATH. Export encodes the MP4 with it): winget install Gyan.FFmpeg
- Chrome or Edge (Not found. The Agent checks each Scene with a still from it): winget install Google.Chrome
A tool that is there but too old: upgrade it and make sure the new one comes first on PATH.
A command that stops for my password (sudo) or an agreement (winget): give it to me to run in my own terminal.
When they are all installed, tell me to press Re-check in KapeCut's Setup window.`)
  const mac = setupPrompt(setupRows({ ...ALL, browser: false }, 'mac'), 'mac')!
  expect(mac).toContain('this macOS computer')
  expect(mac).toContain('- Chrome or Edge (Not found. The Agent checks each Scene with a still from it): brew install --cask google-chrome\n')
  expect(mac).not.toContain('ffmpeg')
  const linux = setupPrompt(setupRows({ ...ALL, ffprobe: false }, 'linux'), 'linux')!
  expect(linux).toContain('this Linux computer')
  expect(linux).toContain('- ffmpeg 4.4+ (ffprobe is not on PATH. It comes with ffmpeg): sudo apt install ffmpeg\n')
  expect(setupPrompt(setupRows({ ...ALL, agent: 'opencode', browser: false }, 'win'), 'win')).toContain('winget install Google.Chrome') // any Agent runs it
})

test('no setup prompt without an Agent to run it, or with no command to run', () => {
  expect(setupPrompt(setupRows({ ...ALL, agent: null, browser: false }, 'win'), 'win')).toBeNull()
  expect(setupPrompt(setupRows({ ...ALL, skill: 'missing' }, 'win'), 'win')).toBeNull() // the skill has its own button
  expect(setupPrompt(setupRows(ALL, 'win'), 'win')).toBeNull()
})

test("Run's command comes from the fixed table by row id, the same one the row shows; anything else is no command", () => {
  for (const os of ['win', 'mac', 'linux'] as const)
    for (const r of setupRows({ ...ALL, ffmpeg: false, ffmpegVersion: null, agent: null, browser: false, brew: false }, os))
      if (r.command) expect(installCommand(r.id, os), `${os} ${r.id}`).toBe(r.command)
  expect(installCommand('brew', 'mac')).toBe(BREW)
  expect(BREW).toBe('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')
  for (const id of ['brew', 'skill', 'nope', '__proto__', 'toString', 'constructor', '', 'winget install Gyan.FFmpeg', 7, null, undefined, { id: 'ffmpeg' }])
    expect(installCommand(id, 'win'), String(id)).toBeNull()
})

test('a Mac without brew: the Homebrew row comes first, only while a brew row fails; never on Windows or Linux', () => {
  const noFfmpeg = { ffmpeg: false, ffmpegVersion: null, brew: false }
  const mac = setupRows({ ...ALL, ...noFfmpeg }, 'mac')
  expect(mac.map((r) => r.id)).toEqual(['brew', 'ffmpeg', 'agent', 'skill', 'browser'])
  expect(mac[0]).toMatchObject({ name: 'Homebrew', ok: false, command: BREW })
  expect(passes(mac)).toBe(false)
  expect(setupRows({ ...ALL, browser: false, brew: false }, 'mac')[0].id).toBe('brew') // a cask is a brew row too
  expect(setupRows({ ...ALL, agent: null, brew: false }, 'mac').map((r) => r.id)).not.toContain('brew') // curl needs no brew
  expect(setupRows({ ...ALL, brew: false }, 'mac').map((r) => r.id)).not.toContain('brew') // nothing to install
  expect(setupRows({ ...ALL, ...noFfmpeg, brew: true }, 'mac').map((r) => r.id)).not.toContain('brew')
  for (const os of ['win', 'linux'] as const) expect(setupRows({ ...ALL, ...noFfmpeg }, os).map((r) => r.id), os).not.toContain('brew')
  expect(setupPrompt(mac, 'mac')).toContain(`- Homebrew (Not found. The brew commands below need it first): ${BREW}\n- ffmpeg 4.4+`)
})
