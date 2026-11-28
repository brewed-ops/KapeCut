import { readFileSync } from 'node:fs'
import { release } from 'node:os'
import { IDLE_MS } from '../renderer/agent/status'
import { writeAtomic } from './owned-writes'

export type Theme = 'dark' | 'light' | 'coffee' | 'glass' | 'system'
/** The app-wide Settings, from settings.json in app data: `{ version: 2, idleMinutes, theme, guideSeen }`. */
export type Settings = { idleMinutes: number; theme: Theme; guideSeen: boolean }

/** --bg of each palette in tokens.css (settings.test.ts holds them equal): the window paints it before CSS loads. */
export const BACKGROUND = { dark: '#12100e', light: '#eef1f6', coffee: '#f4efe6', glass: '#0d0b0a' }
/** A clear window ground: the desktop shows through it, blurred by the OS (#20). */
export const CLEAR = '#00000000'
/** Whether the OS can blur the desktop behind a window: Mac vibrancy, Windows 11 22H2 (build 22621) and later acrylic. */
export const blurs = (platform = process.platform, osRelease = release()) =>
  platform === 'darwin' || (platform === 'win32' && Number(osRelease.split('.')[2]) >= 22621)
/** The window's ground for a theme; System takes the OS's. Glass is clear while main blurs, solid ink otherwise. */
export const ground = (theme: Theme, osDark: boolean, blur = false) =>
  theme === 'glass' && blur ? CLEAR : BACKGROUND[theme === 'system' ? (osDark ? 'dark' : 'light') : theme]

const THEMES: unknown[] = ['dark', 'light', 'coffee', 'glass', 'system'] satisfies Theme[]
// 0.0.1 (version 1) called Coffee light and Light glass: renamed on read, and the next write is version 2.
// Its four names only: the identity entries are what let dark and system through, anything else falls to the default.
const RENAMED = new Map<unknown, Theme>([['light', 'coffee'], ['glass', 'light'], ['dark', 'dark'], ['system', 'system']])
const validIdle = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 120
const validTheme = (t: unknown): t is Theme => THEMES.includes(t)

/** The Settings in file; a missing or bad file gives the defaults, a bad value its own default. */
export function readSettings(file: string): Settings {
  const defaults: Settings = { idleMinutes: IDLE_MS / 60_000, theme: 'dark', guideSeen: false }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    if (s?.version !== 1 && s?.version !== 2) return defaults
    const theme = s.version === 1 ? RENAMED.get(s.theme) : s.theme
    return { idleMinutes: validIdle(s.idleMinutes) ? s.idleMinutes : defaults.idleMinutes, theme: validTheme(theme) ? theme : defaults.theme, guideSeen: s.guideSeen === true }
  } catch {
    return defaults // first launch, or an unreadable file
  }
}

// Checked here, the one place each range lives (trust boundary; the page's controls only shape the input).
export function withIdleMinutes(settings: Settings, n: unknown): Settings {
  if (!validIdle(n)) throw new Error('Idle minutes must be a whole number, 1 to 120')
  return { ...settings, idleMinutes: n }
}

export function withTheme(settings: Settings, t: unknown): Settings {
  if (!validTheme(t)) throw new Error('Theme must be dark, light, coffee, glass or system')
  return { ...settings, theme: t }
}

let last: Promise<unknown> = Promise.resolve()

/** Writes go in turn, so the last change is the one on disk. Resolves to the Settings written. */
export function writeSettings(file: string, settings: Settings): Promise<Settings> {
  const write = last.then(() => writeAtomic(file, JSON.stringify({ version: 2, ...settings })))
  last = write.catch(() => {}) // a failed write never blocks the next
  return write.then(() => settings)
}
