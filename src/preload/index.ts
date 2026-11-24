import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Settings, Theme } from '../main/settings'
import type { Checks, Media } from '../main/setup-checks'
import type { UpdateStatus } from '../main/update-status'

// The theme (#114) is on <html> before the page's first paint (read in step from main), and System follows the OS live.
let theme = ipcRenderer.sendSync('settings:theme-now') as Theme
const osLight = matchMedia('(prefers-color-scheme: light)')
const paint = () => (document.documentElement.dataset.theme = theme === 'system' ? (osLight.matches ? 'light' : 'dark') : theme)
osLight.addEventListener('change', paint)
// The preload runs before <html> exists: paint once the parser adds it, a microtask, so still before the first frame.
if (document.documentElement) paint()
else new MutationObserver((_, seen) => document.documentElement && (seen.disconnect(), paint())).observe(document, { childList: true })

const bridge = {
  project: {
    state: (): Promise<{ current: string | null; recent: string[]; session: string; opened: number }> => ipcRenderer.invoke('project:state'),
    // Both resolve to an error message, or undefined once the window is reloading into the new Project.
    choose: (): Promise<string | undefined> => ipcRenderer.invoke('project:choose'),
    // No call takes a free path: Scenes share this page's origin and must not point the file server at any folder.
    // Only a real OS drop gives a File a disk path, so a Scene cannot forge one.
    // One folder opens as a Project (mayOpen: no Export runs); files are copied into the open one. Resolves to a message.
    drop: (files: File[], mayOpen: boolean): Promise<string | undefined> =>
      ipcRenderer.invoke('project:drop', files.map((f) => webUtils.getPathForFile(f)), mayOpen),
    openRecent: (dir: string): Promise<string | undefined> => ipcRenderer.invoke('project:open-recent', dir),
    // Resolves true when project.json had changed on disk since the app last wrote it: read it again.
    setAudio: (list: unknown): Promise<boolean> => ipcRenderer.invoke('project:audio', list),
  },
  files: {
    list: (): Promise<string[]> => ipcRenderer.invoke('files:list'),
    choose: (): Promise<string> => ipcRenderer.invoke('files:choose'),
  },
  clipboard: { write: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text) },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    // Called with the current state, then on every change.
    onMaximized: (cb: (maximized: boolean) => void) => {
      ipcRenderer.on('window:maximized', (_e, maximized: boolean) => cb(maximized))
      void ipcRenderer.invoke('window:is-maximized').then(cb)
    },
  },
  tools: (): Promise<Checks> => ipcRenderer.invoke('tools'),
  // True once every check has passed in this run: a page reload (a Project switch) skips the Setup window.
  setupPassed: (): Promise<boolean> => ipcRenderer.invoke('tools:passed'),
  media: (): Promise<Media> => ipcRenderer.invoke('tools:media'),
  // Re-reads PATH from the registry first (Windows), so a tool installed since launch is found.
  recheckTools: (): Promise<Checks> => ipcRenderer.invoke('tools:recheck'),
  // Copies the repo's skills/kapecut over ~/.claude/skills/kapecut. Main fixes both paths.
  installSkill: (): Promise<Checks> => ipcRenderer.invoke('tools:install-skill'),
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    setIdleMinutes: (n: number): Promise<number> => ipcRenderer.invoke('settings:idle-minutes', n),
    setTheme: async (t: Theme): Promise<Theme> => ((theme = await ipcRenderer.invoke('settings:theme', t)), paint(), theme),
  },
  // Nothing takes a URL or a version: main acts on the status it holds (src/main/updates.ts).
  updates: {
    version: (): Promise<string> => ipcRenderer.invoke('updates:version'),
    check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
    download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
    open: (): Promise<void> => ipcRenderer.invoke('updates:open'),
    // Called with the current status, then on every change.
    onStatus: (cb: (s: UpdateStatus) => void) => {
      ipcRenderer.on('updates:status', (_e, s: UpdateStatus) => cb(s))
      void ipcRenderer.invoke('updates:status').then(cb)
    },
  },
  onFileSaved: (cb: (file: string, own: boolean) => void) => void ipcRenderer.on('file-saved', (_e, file: string, own: boolean) => cb(file, own)),
  notes: {
    write: (json: string): Promise<void> => ipcRenderer.invoke('notes:write', json),
    // null deletes the picture.
    image: (n: number, png: Uint8Array | null): Promise<void> => ipcRenderer.invoke('notes:image', n, png),
  },
  export: {
    // audio: project.json's list as the page parsed it; main checks every file is inside the open Project.
    check: (audio: unknown): Promise<void> => ipcRenderer.invoke('export:check', audio),
    begin: (defaultName: string, audio: unknown): Promise<string | null> => ipcRenderer.invoke('export:begin', defaultName, audio),
    write: (data: Uint8Array, position: number): Promise<void> => ipcRenderer.invoke('export:write', data, position),
    finish: (): Promise<void> => ipcRenderer.invoke('export:finish'),
    abort: (): Promise<void> => ipcRenderer.invoke('export:abort'),
  },
}

// Scenes are same-origin frames of the app page and can read parent.kapecut. The app's first module takes the bridge
// before any Scene loads; every later take() throws, so a Scene can never open folders, write Notes or Export.
let taken = false
contextBridge.exposeInMainWorld('kapecut', {
  take: () => {
    if (taken) throw new Error('The KapeCut bridge is already taken')
    taken = true
    return bridge
  },
})
