import type { Checks, Media } from '../../main/setup-checks'

export type Os = 'win' | 'mac' | 'linux'
/** From navigator.platform: "Win32", "MacIntel", "Linux x86_64". */
export const osOf = (platform: string): Os => (platform.startsWith('Win') ? 'win' : platform.startsWith('Mac') ? 'mac' : 'linux')

/** One line of the Setup window: a failing row carries its fix, a command to copy or the skill's state for its button. */
export type Row = { id: string; name: string; ok: boolean; detail: string; command?: string; skill?: 'missing' | 'outdated' }

const FFMPEG = { win: 'winget install Gyan.FFmpeg', mac: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg' }
const BROWSER = { win: 'winget install Google.Chrome', mac: 'brew install --cask google-chrome', linux: 'sudo snap install chromium' }
// The native installer: needs no Node, updates itself. Wrapped in powershell so cmd runs it too.
const CLAUDE = { win: 'powershell -c "irm https://claude.ai/install.ps1 | iex"', mac: 'curl -fsSL https://claude.ai/install.sh | bash', linux: 'curl -fsSL https://claude.ai/install.sh | bash' }

// A row fixed by running a command: the command shows only while it fails.
const tool = (id: string, name: string, ok: boolean, detail: string, command: string): Row => ({ id, name, ok, detail, command: ok ? undefined : command })

/** The ffmpeg row's text, also what Export says when it cannot start. */
export function ffmpegDetail(c: Media) {
  if (c.ffmpeg) return c.ffprobe ? `ffmpeg ${c.ffmpegVersion} and ffprobe on PATH` : 'ffprobe is not on PATH. It comes with ffmpeg'
  if (c.ffmpegVersion === 'unknown') return 'ffmpeg runs but names no version. Export needs 4.4 or newer'
  return c.ffmpegVersion ? `ffmpeg ${c.ffmpegVersion} is too old. Export needs 4.4 or newer` : 'ffmpeg is not on PATH. Export encodes the MP4 with it'
}

export function setupRows(c: Checks, os: Os): Row[] {
  return [
    tool('ffmpeg', 'ffmpeg 4.4+', c.ffmpeg && c.ffprobe, ffmpegDetail(c), FFMPEG[os]),
    tool('claude', 'Claude Code', c.claude, c.claude ? 'On PATH' : 'Not on PATH. Claude writes every Scene', CLAUDE[os]),
    {
      id: 'skill',
      name: 'KapeCut skill',
      ok: c.skill === 'current',
      detail: { current: 'In ~/.claude/skills, the same as this KapeCut', missing: 'Not in ~/.claude/skills. Claude needs it to build a Project', outdated: 'Your copy in ~/.claude/skills differs from this KapeCut' }[c.skill],
      skill: c.skill === 'current' ? undefined : c.skill,
    },
    tool('browser', 'Chrome or Edge', c.browser, c.browser ? 'Installed' : 'Not found. Your agent checks each Scene with a still from it', BROWSER[os]),
  ]
}

const OS_NAME = { win: 'Windows', mac: 'macOS', linux: 'Linux' }

/**
 * The Setup prompt (GLOSSARY, #113): the failing rows' own commands, for Claude Code to run. Null while
 * Claude Code is missing (nothing to run it) or no failing row has a command (the skill keeps its own button).
 */
export function setupPrompt(rows: Row[], os: Os): string | null {
  const fix = rows.filter((r) => r.command)
  if (!fix.length || fix.some((r) => r.id === 'claude')) return null
  return `KapeCut needs these tools on this ${OS_NAME[os]} computer. Run each install command in a terminal and check it worked:
${fix.map((r) => `- ${r.name} (${r.detail}): ${r.command}`).join('\n')}
A tool that is there but too old: upgrade it and make sure the new one comes first on PATH.
A command that stops for my password (sudo) or an agreement (winget): give it to me to run in my own terminal.
When they are all installed, tell me to press Re-check in KapeCut's Setup window.`
}
