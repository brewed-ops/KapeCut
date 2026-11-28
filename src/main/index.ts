import { app, BrowserWindow, clipboard, dialog, nativeTheme, net, protocol, shell } from 'electron'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_URL, handle, isAppPage, on } from './app-sender'
import { fileUnder } from './file-under'
import { watchProject } from './watch-project'
import { exporting, handleExport } from './export'
import { addRecent } from './recent-projects'
import { ownNotesWrite, writeNoteImage, writeNotes } from './notes-files'
import { ownLanded, ownTemp, ownWrite } from './owned-writes'
import { copyIn, deleteScene, listFiles, readDrop, writeAudio } from './project-files'
import { writeSession } from './session-file'
import { handleUpdates } from './updates'
import { ground, readSettings, withIdleMinutes, withTheme, writeSettings, type Settings } from './settings'
import { runInstall } from './terminal'
import { allPass, installSkill, mediaChecks, refreshPath, runChecks, skillState, withInstallDirs, type Checks } from './setup-checks'

if (process.platform !== 'win32') process.env.PATH = withInstallDirs(process.env.PATH ?? '', homedir())

// The app page and the Project's Scenes share one origin so the viewer can call renderAt() inside the Scene frame.
protocol.registerSchemesAsPrivileged([
  { scheme: 'kapecut', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// The open Project folder, or null. Every /project/ URL is served from it, so switching re-points the path guard too.
let projectDir: string | null = null
let opens = 0 // which open of a Project this is: the page's own reloads keep it, opening a Project again does not
let stopWatch = () => {}
const rendererDir = join(__dirname, '../renderer')
const recentFile = () => join(app.getPath('userData'), 'recent-projects.json')
const sessionFile = () => join(app.getPath('userData'), 'session.json')
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const MAX_CLIPBOARD = 64 * 1024 // a prompt, never a file's worth
const isFolder = (dir: unknown) => {
  try {
    return typeof dir === 'string' && !!statSync(dir, { throwIfNoEntry: false })?.isDirectory()
  } catch {
    return false // EACCES / EPERM: not a folder we can open
  }
}

function readRecent(): string[] {
  try {
    return (JSON.parse(readFileSync(recentFile(), 'utf8')) as string[]).filter(isFolder)
  } catch {
    return [] // first launch, or an unreadable list: start without recents
  }
}

// File-based hand-off: an agent saves a Scene, the viewer reloads it. The old Project's watch stops first.
function useProject(win: BrowserWindow, dir: string) {
  stopWatch()
  const watched = resolve(dir)
  projectDir = watched
  opens++
  // Claude checks this file names the folder it works in before any job (ADR 0005). The Project still opens without it.
  writeSession(sessionFile(), watched).catch((e) => console.error('[kapecut] could not write the Session file:', e))
  stopWatch = watchProject(watched, (file) => {
    // The app's own notes.json writes never reach the page, so they reload nothing (no loop with Claude's writes).
    if (file === 'notes.json' && ownNotesWrite(watched)) return
    if (file === 'project.json' && ownWrite(join(watched, 'project.json'))) return // the Timeline's own edits
    // The rest of the app's own writes: temp files, Note pictures, an Export's scratch. Not Claude activity (ADR 0005).
    if (ownTemp(file) || /^notes\/note-\d+\.png$/.test(file) || /(^|\/)\.kapecut-export-/.test(file)) return
    // An Export's MP4 saved in the Project: Files lists it, but it is the app's own (own = true, not Claude activity).
    if (!win.isDestroyed()) win.webContents.send('file-saved', file, ownLanded(join(watched, file)))
  })
}

// A fresh page per Project, so nothing of the old one (Scene frame, transport, listeners) survives.
function openProject(win: BrowserWindow, dir: string) {
  if (!passed) return 'Install what the Setup window lists first'
  if (!isFolder(dir)) return `${dir} is not a folder KapeCut can open`
  useProject(win, dir)
  try {
    writeFileSync(recentFile(), JSON.stringify(addRecent(readRecent(), projectDir!)))
  } catch (e) {
    console.error('[kapecut] could not save recent Projects:', e) // the Project still opens
  }
  win.webContents.reload()
}

function serve(req: Request) {
  const { pathname, search } = new URL(req.url)
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const inProject = pathname.startsWith('/project/')
  // Vite answers a stylesheet with CSS only when Accept says text/css, else with a JS module. Forwarding every header breaks the page load.
  if (!inProject && devUrl)
    return net.fetch(devUrl + pathname + search, { headers: { accept: req.headers.get('accept') ?? '*/*' } })
  const file = inProject
    ? projectDir && fileUnder(projectDir, pathname.slice('/project'.length))
    : fileUnder(rendererDir, pathname)
  const notFound = () => new Response('Not found', { status: 404 })
  // net.fetch rejects on a missing file; turn that into a 404 the page can read. One that is there but cannot be read (a
  // folder, locked mid-write) is a 500, so a Project with a project.json never looks like Set-up state.
  const failed = () => (existsSync(file!) ? new Response('Cannot read', { status: 500 }) : notFound())
  if (!file) return notFound()
  const res = net.fetch(pathToFileURL(file).href)
  if (!inProject) return res.catch(failed)
  // Claude edits Project files under the open page: a reloaded Scene must refetch its shared kc.js, never reuse it (#115).
  // Audio is refetched too, as loadAudio already asks with cache: 'no-store'.
  return res.then((r) => {
    const headers = new Headers(r.headers)
    headers.set('cache-control', 'no-store')
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers })
  }, failed)
}

// The Setup window's skill check (#89): the repo's copy against Claude Code's, both fixed here, never from the page.
// The prompts point every Agent at this copy: the repo's in dev, the install folder's when packaged (ADR 0008).
// shortcut: a quarantined Mac app run outside Applications is translocated to a temp path that goes when it quits;
// install-mac.sh puts it in /Applications unquarantined. Warn in Setup if users hit it.
// out/main/ -> repo root: the installer keeps that layout, unpacked (package-files.test.ts), like the icon.
const SKILL_FROM = join(__dirname, '../../skills/kapecut')
const skillTo = () => join(homedir(), '.claude', 'skills', 'kapecut') // per call: USERPROFILE / HOME decide it
// Until every check passes no Project opens, here as well as in the page (the launch one waits in onPass).
let passed = false
let onPass = () => {} // runs once, on the first pass
async function checks() {
  const found = await runChecks(SKILL_FROM, skillTo())
  if (!passed && allPass(found)) (passed = true), onPass() // once in, in: Export's own ffmpeg check never shuts Projects
  return found
}

// No path from the page: notes.json, notes/note-<n>.png, project.json's audio and Scene lists in the open Project, and its file list.
function handleProjectFiles() {
  const dir = () => projectDir ?? Promise.reject(new Error('No Project open'))
  handle('notes:write', async (_e, json: unknown) => writeNotes(await dir(), json))
  handle('notes:image', async (_e, n: unknown, png: unknown) => writeNoteImage(await dir(), n, png))
  handle('files:list', async () => listFiles(await dir()))
  handle('project:audio', async (_e, list: unknown) => writeAudio(await dir(), list))
  // Not while an Export writes its file. The page turns the trash off for the whole Export, from the click on.
  handle('project:delete-scene', async (_e, index: unknown, file: unknown) => {
    if (exporting()) throw new Error('Delete Scenes once the Export is done')
    return deleteScene(await dir(), index, file, (p) => shell.trashItem(p))
  })
}

/** Copies files into the open Project; says what was added and what was refused. */
async function copyAll(paths: string[]) {
  const dir = projectDir
  if (!dir) return 'Open a Project folder first, then drop files on it'
  const added: string[] = []
  const refused: string[] = []
  const there: string[] = []
  for (const path of paths) await copyIn(dir, path).then(({ name, copied }) => (copied ? added : there).push(name), (e) => refused.push(e.message))
  return [
    ...(added.length ? [`Added ${added.join(', ')}`] : []),
    ...(there.length ? [`Already in the Project: ${there.join(', ')}`] : []),
    ...refused,
  ].join('. ')
}

app.whenReady().then(() => {
  protocol.handle('kapecut', serve)
  handleProjectFiles()
  // Text only, size capped: the page copies the prompts it builds. Scenes cannot reach the bridge (ADR 0003).
  handle('clipboard:write', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD) throw new Error('Nothing to copy, or too much')
    clipboard.writeText(text)
  })
  // The page's first ask gets checks begun now, while the window and page load, so a launch waits on them less.
  let early: Promise<Checks> | null = checks()
  handle('tools', () => {
    const found = early ?? checks()
    early = null
    return found
  })
  handle('tools:passed', () => passed)
  handle('tools:media', mediaChecks)
  handle('tools:recheck', async () => (await refreshPath(), checks()))
  handle('tools:run', (_e, id: unknown) => runInstall(id))
  handleExport(() => projectDir)
  let settings = readSettings(settingsFile())
  handle('settings:get', () => settings)
  // The window's ground before CSS paints: kept on the theme's --bg, also when System follows an OS change.
  const paintGround = () => !win.isDestroyed() && win.setBackgroundColor(ground(settings.theme, nativeTheme.shouldUseDarkColors))
  nativeTheme.on('updated', paintGround)
  // In memory first, so a second change made while the first is still writing builds on it (idle minutes then theme).
  // A failed write puts the old value back, unless a later change has already replaced it.
  const save = (next: Settings) => {
    const before = settings
    settings = next
    return writeSettings(settingsFile(), next).catch((e) => {
      if (settings === next) settings = before
      throw e
    })
  }
  handle('settings:idle-minutes', async (_e, n: unknown) => (await save(withIdleMinutes(settings, n))).idleMinutes) // refuses all but 1 to 120
  handle('settings:theme', async (_e, t: unknown) => {
    const { theme } = await save(withTheme(settings, t)) // refuses a theme not in Theme
    paintGround()
    return theme
  })
  // Read in step by the preload, so the page has its theme before it first paints (#114).
  on('settings:theme-now', (e) => (e.returnValue = settings.theme))

  // e2e and shots set KAPECUT_HIDDEN=1: see-through, click-through, shown without focus, so a run never covers or steals
  // from the user's work. Shown, as one left hidden stalls screenshots; on screen, as off it a resize gets a wrong inset.
  const hidden = process.env.KAPECUT_HIDDEN === '1'
  // The Mac Dock ignores the window icon and shows the running bundle's: Electron.app in dev and e2e.
  if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '../../resources/logo/kapecut-512.png'))
  const win = new BrowserWindow({
    ...(hidden && { show: false, opacity: 0, type: 'toolbar' }), // toolbar: no taskbar or Alt+Tab entry
    width: 1280,
    height: 900,
    // The smallest window the layout is tested at (layout and files e2e): below it the viewer's transport clips.
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: ground(settings.theme, nativeTheme.shouldUseDarkColors),
    // The header is the title bar (drag region) with the app's own window buttons. The default application menu stays
    // set, hidden with the frame, so its undo / copy / paste / reload / devtools shortcuts keep working.
    titleBarStyle: 'hidden',
    // macOS keeps its traffic lights on a hidden title bar: on the gutter (24 px, tokens.css) and centred on the
    // header's controls, while the app hides its own buttons (app.css, data-platform from the preload).
    ...(process.platform === 'darwin' && { trafficLightPosition: { x: 24, y: 27 } }),
    title: 'KapeCut',
    // Window and taskbar icon (docs/design/logo.md). The .ico carries the hand-checked 16-48 px sizes, a PNG would be
    // shrunk from 256. out/main/ -> repo root, in dev and in the build.
    icon: join(__dirname, '../../resources/logo', process.platform === 'win32' ? 'kapecut.ico' : 'kapecut-256.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })
  // Scenes share the app page's origin: none may send the window off it or open another one with a fresh bridge (#126).
  win.webContents.on('will-navigate', (e) => !isAppPage(e.url) && e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // A top URL changed some other way (a Scene's history.replaceState, then a reload) goes back to the app page.
  const back = (url: string) => !isAppPage(url) && void win.loadURL(APP_URL)
  win.webContents.on('did-navigate', (_e, url) => back(url))
  win.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && back(url))
  if (hidden) {
    win.setIgnoreMouseEvents(true)
    win.showInactive()
  }
  handle('window:minimize', () => win.minimize())
  handle('window:toggle-maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  handle('window:close', () => win.close())
  handle('window:is-maximized', () => win.isMaximized())
  // Also on a double-click of the header or a drag to the screen edge, so the button's icon always matches.
  const sendMaximized = (maximized: boolean) => !win.isDestroyed() && win.webContents.send('window:maximized', maximized)
  win.on('maximize', () => sendMaximized(true))
  win.on('unmaximize', () => sendMaximized(false))
  // macOS full screen hides the traffic lights, so the header drops the room it keeps for them (app.css). Read in step
  // at first paint too, as a Project switch reloads the page.
  const sendFullScreen = (on: boolean) => !win.isDestroyed() && win.webContents.send('window:full-screen', on)
  win.on('enter-full-screen', () => sendFullScreen(true))
  win.on('leave-full-screen', () => sendFullScreen(false))
  on('window:full-screen-now', (e) => (e.returnValue = win.isFullScreen()))
  handleUpdates(win.webContents)
  // KAPECUT_PROJECT (set by the e2e tests) wins over the last opened Project.
  const start = [process.env.KAPECUT_PROJECT, readRecent()[0]].find(isFolder)
  if (start) onPass = () => useProject(win, start)
  // Update replaces the folder whole and the user may have edited their copy, so main asks, whatever the page did.
  handle('tools:install-skill', async () => {
    const ask: Electron.MessageBoxOptions = { type: 'question', buttons: ['Update', 'Cancel'], defaultId: 1, cancelId: 1, message: "Replace your ~/.claude/skills/kapecut with this KapeCut's copy?", detail: 'Your changes to it are lost.' }
    const state = skillState(SKILL_FROM, skillTo())
    if (state === 'missing' || (state === 'outdated' && (await dialog.showMessageBox(win, ask)).response === 0)) installSkill(SKILL_FROM, skillTo())
    return checks()
  })
  win.on('closed', () => (stopWatch(), nativeTheme.off('updated', paintGround)))
  handle('project:state', () => ({ current: projectDir, recent: readRecent(), session: sessionFile(), skill: join(SKILL_FROM, 'SKILL.md'), opened: opens }))
  // A drop on the window: one folder opens as a Project (unless an Export runs), files are copied into the open one. The
  // paths come from the preload, which takes them from a real OS drop only (ADR 0004).
  handle('project:drop', (_e, paths: unknown, mayOpen: unknown) => {
    let drop: ReturnType<typeof readDrop>
    try {
      drop = readDrop(paths)
    } catch (e) {
      return (e as Error).message
    }
    if ('copy' in drop) return copyAll(drop.copy)
    return mayOpen === true ? openProject(win, drop.open) : 'Cancel the Export before opening another Project'
  })
  handle('project:open-recent', (_e, dir: string) =>
    readRecent().includes(dir) ? openProject(win, dir) : `${dir} is not a recent Project`,
  )
  handle('project:choose', async () => {
    const pick = await dialog.showOpenDialog(win, { title: 'Open a Project folder', properties: ['openDirectory'] })
    if (!pick.canceled && pick.filePaths[0]) return openProject(win, pick.filePaths[0])
  })
  // The keyboard's way to add Files: the same copy as a drop.
  handle('files:choose', async () => {
    const pick = await dialog.showOpenDialog(win, { title: 'Add files to the Project', properties: ['openFile', 'multiSelections'] })
    return pick.canceled || !pick.filePaths.length ? '' : copyAll(pick.filePaths)
  })
  win.loadURL(APP_URL)
})

app.on('window-all-closed', () => app.quit())
// With KapeCut closed no Project is open: Claude finds no Session file and stops, instead of trusting the last one.
app.on('will-quit', () => {
  try {
    rmSync(sessionFile(), { force: true })
  } catch (e) {
    console.error('[kapecut] could not remove the Session file:', e)
  }
})
