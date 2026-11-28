import { readFileSync } from 'node:fs'
import { IDLE_MS } from '../renderer/agent/status'
import { writeAtomic } from './owned-writes'

export type Theme = 'dark' | 'light' | 'coffee' | 'system'
/** The app-wide Settings, from settings.json in app data: `{ version: 2, idleMinutes, theme }`. */
export type Settings = { idleMinutes: number; theme: Theme }

/** --bg of each palette in tokens.css (settings.test.ts holds them equal): the window paints it before CSS loads. */
export const BACKGROUND = { dark: '#12100e', light: '#eef1f6', coffee: '#f4efe6' }
/** The window's ground for a theme; System takes the OS's. */
export const ground = (theme: Theme, osDark: boolean) => BACKGROUND[theme === 'system' ? (osDark ? 'dark' : 'light') : theme]

const THEMES: unknown[] = ['dark', 'light', 'coffee', 'system'] satisfies Theme[]
// 0.0.1 (version 1) called Coffee light and Light glass: renamed on read, and the next write is version 2.
// Its four names only: the identity entries are what let dark and system through, anything else falls to the default.
const RENAMED = new Map<unknown, Theme>([['light', 'coffee'], ['glass', 'light'], ['dark', 'dark'], ['system', 'system']])
const validIdle = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 120
const validTheme = (t: unknown): t is Theme => THEMES.includes(t)

/** The Settings in file; a missing or bad file gives the defaults, a bad value its own default. */
export function readSettings(file: string): Settings {
  const defaults: Settings = { idleMinutes: IDLE_MS / 60_000, theme: 'dark' }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    if (s?.version !== 1 && s?.version !== 2) return defaults
    const theme = s.version === 1 ? RENAMED.get(s.theme) : s.theme
    return { idleMinutes: validIdle(s.idleMinutes) ? s.idleMinutes : defaults.idleMinutes, theme: validTheme(theme) ? theme : defaults.theme }
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
  if (!validTheme(t)) throw new Error('Theme must be dark, light, coffee or system')
  return { ...settings, theme: t }
}

let last: Promise<unknown> = Promise.resolve()

/** Writes go in turn, so the last change is the one on disk. Resolves to the Settings written. */
export function writeSettings(file: string, settings: Settings): Promise<Settings> {
  const write = last.then(() => writeAtomic(file, JSON.stringify({ version: 2, ...settings })))
  last = write.catch(() => {}) // a failed write never blocks the next
  return write.then(() => settings)
}
