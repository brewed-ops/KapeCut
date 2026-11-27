import { constants, statSync } from 'node:fs'
import { copyFile, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { LAST_SCENE, parseProject } from '../renderer/viewer/project'
import { staysUnder } from './file-under'
import { lastOwnWrite, markLanded, ownLanded, writeOwned } from './owned-writes'
import { MAX_LISTED } from '../renderer/files/kind'

const MAX_FILE = 2 ** 30 // a whole audio file is decoded in memory; an hour of 48 kHz stereo WAV is ~700 MB
const MAX_PROJECT_JSON = 2 ** 20

/**
 * Copies a file dropped on the window into the Project folder, any kind, and returns its name there. A name already taken
 * gets -2, -3... (the copy itself refuses to overwrite, so a file appearing meanwhile is safe too). A file already inside
 * the Project is not copied again (copied: false): its path in the Project comes back.
 */
export async function copyIn(dir: string, src: string): Promise<{ name: string; copied: boolean }> {
  const name = basename(src)
  const found = await stat(src).catch(() => null)
  if (found?.isDirectory()) throw new Error(`${name} is a folder. Drop it alone to open it as a Project`)
  if (!found?.isFile()) throw new Error(`${name} is not a file`)
  if (found.size > MAX_FILE) throw new Error(`${name} is over 1 GB`)
  const [real, root] = [await realpath(src), await realpath(dir)]
  if (real.startsWith(root + sep)) return { name: relative(root, real).split(sep).join('/'), copied: false }
  const ext = extname(name)
  for (let i = 1; i < 1000; i++) {
    const to = i === 1 ? name : `${name.slice(0, name.length - ext.length)}-${i}${ext}`
    try {
      await copyFile(src, join(dir, to), constants.COPYFILE_EXCL)
      return { name: to, copied: true }
    } catch (e) {
      // Taken by a file (EEXIST), a folder or a link (EPERM / EISDIR on Windows): try the next name.
      if (!(await lstat(join(dir, to)).catch(() => null))) throw e
    }
  }
  throw new Error(`Too many files named like ${name} in the Project`)
}

/** What a drop on the window does: one folder opens as a Project, anything else is copied in. */
export function readDrop(paths: unknown): { open: string } | { copy: string[] } {
  if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === 'string' && p)) throw new Error('Drop files or a Project folder from disk')
  const one = paths.length === 1 && statSync(paths[0], { throwIfNoEntry: false })?.isDirectory()
  return one ? { open: paths[0] } : { copy: paths }
}

/**
 * Every file in the Project folder, '/'-separated and sorted, but the app's own (project.json, notes.json, notes/ and
 * their temp files), hidden ones (.git) and node_modules. Links are not followed, so nothing outside the Project is
 * listed. At most MAX_LISTED + 1: one more says the list was cut. A subfolder that cannot be read is left out.
 */
export async function listFiles(dir: string) {
  const found: string[] = []
  const walk = async (at: string) => {
    const entries = await readdir(join(dir, at), { withFileTypes: true }).catch((e) => {
      if (at) return [] // unreadable, or deleted mid-walk: the rest of the Project still lists
      throw e
    })
    for (const d of entries) {
      const path = at ? `${at}/${d.name}` : d.name
      if (found.length > MAX_LISTED || d.name.startsWith('.') || d.name === 'node_modules') continue
      if (/^(project\.json|notes\.json|notes)$|^(project|notes)\.json\..*\.tmp$/.test(path)) continue
      if (d.isDirectory()) await walk(path)
      else if (d.isFile()) found.push(path)
    }
  }
  await walk('')
  return found.sort()
}

let writing: Promise<unknown> = Promise.resolve()

/**
 * Sets project.json's `audio` list, merged into the file as it is on disk now: every other key stays as Claude wrote it.
 * Refuses a list parseProject refuses, a file that leads outside the Project (by name or by a link) and a project.json
 * that is broken now. Calls run one after another, so the last one wins. Returns true when the file had changed since
 * the app's own last write: the page's copy is older, so it must read the file again.
 */
export function writeAudio(dir: string, list: unknown): Promise<boolean> {
  return queued(async () => {
    const { stale } = await editProject(dir, (json) => {
      const { audio } = parseProject({ ...json, audio: list })
      const away = audio.find((a) => !staysUnder(dir, join(dir, a.file)))
      if (away) throw new Error(`Audio file ${away.file} is outside the Project`)
      return { ...json, audio }
    })
    return stale
  })
}

/**
 * Takes Scene `index` out of project.json's `scenes`, then moves its page to the OS trash with `trash`
 * (shell.trashItem), never erasing it. A failed move puts project.json back, so either both happen or neither. The Scene
 * must still be `file` at `index` (the page's list may be older). Refuses the last Scene of a Project. A page another
 * entry still names (also as ./a.html, or A.html where names ignore case) stays, and only a plain .html file is moved: a
 * hand-edited list naming notes.json, a folder or a link only loses the entry. Moving the page is the app's own change,
 * not Claude's. Queued with writeAudio. Resolves to the Scene list it took the Scene from, so the page matches the
 * Scene's Notes against the order main checked.
 */
export function deleteScene(dir: string, index: unknown, file: unknown, trash: (path: string) => Promise<void>): Promise<string[]> {
  return queued(async () => {
    let order: string[] = []
    let page = ''
    const { before } = await editProject(dir, (json) => {
      const { scenes } = parseProject(json)
      if (!Number.isInteger(index) || typeof file !== 'string' || scenes[index as number] !== file) throw new Error('The Scene list changed. Close this, then try again')
      if (scenes.length < 2) throw new Error(LAST_SCENE)
      const left = scenes.filter((_, i) => i !== index)
      // shortcut: case is ignored on every OS but Linux, so a case-sensitive Mac volume keeps a page it could trash.
      const key = (f: string) => (process.platform === 'linux' ? resolve(dir, f) : resolve(dir, f).toLowerCase())
      page = left.some((f) => key(f) === key(file)) ? '' : join(dir, file)
      if (page && !staysUnder(dir, page)) throw new Error(`Scene ${file} is outside the Project`)
      order = scenes
      return { ...json, scenes: left }
    })
    // Checked again right before the move: the page may have become a link since.
    if (page && /\.html?$/i.test(page) && (await lstat(page).catch(() => null))?.isFile() && staysUnder(dir, page)) {
      markLanded(page) // before the move: the watcher may report it first
      try {
        await trash(page)
      } catch (e) {
        ownLanded(page) // never moved: the next change to it is not the app's
        await writeOwned(join(dir, 'project.json'), before) // the Scene comes back with its page
        throw e
      }
    }
    return order
  })
}

function queued<T>(job: () => Promise<T>) {
  const run = writing.then(job)
  writing = run.catch(() => {})
  return run
}

/**
 * project.json as it is on disk now, changed by `change`, written whole once parseProject takes the result. Returns the
 * text it replaced, and whether that had changed since the app's own last write.
 */
async function editProject(dir: string, change: (json: Record<string, unknown>) => Record<string, unknown>) {
  const file = join(dir, 'project.json')
  if (!staysUnder(dir, file)) throw new Error('project.json links outside the Project')
  const before = await readFile(file, 'utf8').catch(() => '')
  let json: Record<string, unknown>
  try {
    json = JSON.parse(before)
    parseProject(json)
  } catch {
    throw new Error('project.json has an error. Fix it, save, then try again')
  }
  const next = change(json)
  parseProject(next)
  const text = JSON.stringify(next, null, 2) + '\n'
  if (Buffer.byteLength(text) > MAX_PROJECT_JSON) throw new Error('project.json would be too large')
  const stale = before !== lastOwnWrite(file)
  await writeOwned(file, text)
  return { before, stale }
}
