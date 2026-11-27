import { readFileSync } from 'node:fs'
import { IDLE_MS } from '../renderer/agent/status'
import { writeAtomic } from './owned-writes'

export type Theme = 'dark' | 'light' | 'glass' | 'system'
/** The app-wide Settings, from settings.json in app data: `{ version: 1, idleMinutes, theme }`. */
export type Settings = { idleMinutes: number; theme: Theme }

/** --bg of each palette in tokens.css (settings.test.ts holds them equal): the window paints it before CSS loads. */
export const BACKGROUND = { dark: '#12100e', light: '#f4efe6', glass: '#eef1f6' }
/** The window's ground for a theme; System takes the OS's. */
export const ground = (theme: Theme, osDark: boolean) => BACKGROUND[theme === 'system' ? (osDark ? 'dark' : 'light') : theme]

const THEMES: unknown[] = ['dark', 'light', 'glass', 'system'] satisfies Theme[]
const validIdle = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 120
const validTheme = (t: unknown): t is Theme => THEMES.includes(t)

/** The Settings in file; a missing or bad file gives the defaults, a bad value its own default. */
export function readSettings(file: string): Settings {
  const defaults: Settings = { idleMinutes: IDLE_MS / 60_000, theme: 'dark' }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    if (s?.version !== 1) return defaults
    return { idleMinutes: validIdle(s.idleMinutes) ? s.idleMinutes : defaults.idleMinutes, theme: validTheme(s.theme) ? s.theme : defaults.theme }
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
  if (!validTheme(t)) throw new Error('Theme must be dark, light, glass or system')
  return { ...settings, theme: t }
}

let last: Promise<unknown> = Promise.resolve()

/** Writes go in turn, so the last change is the one on disk. Resolves to the Settings written. */
export function writeSettings(file: string, settings: Settings): Promise<Settings> {
  const write = last.then(() => writeAtomic(file, JSON.stringify({ version: 1, ...settings })))
  last = write.catch(() => {}) // a failed write never blocks the next
  return write.then(() => settings)
}
