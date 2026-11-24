import type { Settings, Theme } from '../main/settings'
import type { Checks, Media } from '../main/setup-checks'
import type { UpdateStatus } from '../main/update-status'
import type { Audio } from './viewer/project'

/** What main offers the app page (src/preload/index.ts). */
export type Bridge = {
  project: {
    /** session: the Session file's absolute path (ADR 0005). opened: which open of a Project this is (a reload keeps it). */
    state(): Promise<{ current: string | null; recent: string[]; session: string; opened: number }>
    choose(): Promise<string | undefined>
    /** A drop on the window: one folder opens as a Project, files are copied into the open one. Resolves to a message. */
    drop(files: File[], mayOpen: boolean): Promise<string | undefined>
    openRecent(dir: string): Promise<string | undefined>
    /** Writes project.json's audio list. True: the file had changed on disk, read it again. */
    setAudio(list: Audio[]): Promise<boolean>
  }
  /** The open Project's files ('/'-separated). choose copies picked files in and resolves to a message. */
  files: {
    list(): Promise<string[]>
    choose(): Promise<string>
  }
  /** The system clipboard (Electron's, so it works without page focus). */
  clipboard: { write(text: string): Promise<void> }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    /** Called with the current state, then on every change. */
    onMaximized(cb: (maximized: boolean) => void): void
  }
  /** The Setup window's checks (#89), also listed in Settings. */
  tools(): Promise<Checks>
  /** True once every check has passed in this run, so a page reload skips the Setup window. */
  setupPassed(): Promise<boolean>
  /** ffmpeg and ffprobe only, for Export. */
  media(): Promise<Media>
  /** The checks again, after re-reading PATH from the registry on Windows (an install since launch). */
  recheckTools(): Promise<Checks>
  /** Copies the repo's skill over the installed one (main fixes both paths), then checks again. */
  installSkill(): Promise<Checks>
  /** settings.json in app data. Each setter resolves to the value saved; main refuses idle minutes but 1 to 120 and a
   *  theme but dark, light, glass or system. setTheme also repaints the page (the preload keeps data-theme on <html>). */
  settings: {
    get(): Promise<Settings>
    setIdleMinutes(n: number): Promise<number>
    setTheme(t: Theme): Promise<Theme>
  }
  /** Updates from GitHub Releases (#138). Each step acts on the status main holds; none takes a URL or a version. */
  updates: {
    version(): Promise<string>
    check(): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
    /** The Mac's step: opens the found version's Release page. */
    open(): Promise<void>
    /** Called with the current status, then on every change. */
    onStatus(cb: (s: UpdateStatus) => void): void
  }
  /** own: the app wrote it itself (an Export's MP4), so it is not Claude activity. */
  onFileSaved(cb: (file: string, own: boolean) => void): void
  notes: {
    write(json: string): Promise<void>
    image(n: number, png: Uint8Array | null): Promise<void>
  }
  export: {
    /** Throws naming a missing Audio file, or when ffmpeg cannot mix. */
    check(audio: Audio[]): Promise<void>
    begin(defaultName: string, audio: Audio[]): Promise<string | null>
    write(data: Uint8Array, position: number): Promise<void>
    finish(): Promise<void>
    abort(): Promise<void>
  }
}

declare global {
  interface Window {
    kapecut: { take(): Bridge }
  }
}

// Taken as the page's first module runs, before any Scene frame exists. Scenes share this origin and can read
// parent.kapecut, but take() answers only once, so the bridge stays with the app.
export const kapecut = window.kapecut.take()
