import { statSync, watch, type FSWatcher, type Stats } from 'node:fs'
import { basename, join, sep } from 'node:path'

const stat = (path: string): Stats | undefined | 'unreadable' => {
  try {
    return statSync(path, { throwIfNoEntry: false })
  } catch {
    return 'unreadable' // report it, the renderer decides
  }
}

/**
 * Calls onChange with the '/'-separated path of each file saved inside dir.
 * An editor's save fires several OS events; they collapse into one call after quietMs.
 * Returns a function that stops watching. A watch that cannot start or later fails
 * (folder missing, deleted, drive gone) is logged, never thrown: it must not take the app down.
 */
export function watchProject(dir: string, onChange: (file: string) => void, quietMs = 100) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const reported = new Map<string, number>() // file -> the change time last reported (-1: gone)
  const started = Date.now()
  let watcher: FSWatcher | undefined
  const stop = () => {
    watcher?.close()
    timers.forEach(clearTimeout)
  }
  try {
    watcher = watch(dir, { recursive: true }, (_event, name) => {
      if (!name) return
      const file = name.split(sep).join('/')
      clearTimeout(timers.get(file))
      timers.set(
        file,
        setTimeout(() => {
          timers.delete(file)
          const s = stat(join(dir, name))
          if (s === 'unreadable') return onChange(file)
          // A save inside a folder also fires for the folder itself (seen on Windows CI).
          if (s?.isDirectory()) return
          // macOS (FSEvents) names a change to the watched folder itself by the folder's own name.
          if (!s && name === basename(dir)) return
          // macOS also replays changes made just before the watch started, and can repeat one save past quietMs. The
          // change time (ctime), unlike mtime, no copy can keep from the past. A deleted file is still reported.
          const changed = s ? s.ctimeMs : -1
          if ((s && changed < started) || reported.get(file) === changed) return
          reported.set(file, changed)
          onChange(file)
        }, quietMs),
      )
    })
    watcher.on('error', (e) => (console.error('[kapecut] project watch stopped:', e), stop()))
  } catch (e) {
    console.error('[kapecut] project watch failed to start:', e)
  }
  return stop
}
