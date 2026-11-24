import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** True when a path on disk, followed through every symlink or junction, is still inside root. Missing: nothing to reach. */
export function staysUnder(root: string, file: string): boolean {
  try {
    return realpathSync(file).startsWith(realpathSync(root) + sep)
  } catch {
    return true
  }
}

/** The file a URL path names inside root, or null if it escapes root (by name or by a link), is root, or is malformed. */
export function fileUnder(root: string, urlPath: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(urlPath)
  } catch {
    return null // malformed %-escape
  }
  if (path.includes('\\')) return null // a separator on Windows only; refuse it everywhere so all platforms agree
  const file = resolve(root, '.' + path)
  return file.startsWith(root + sep) && staysUnder(root, file) ? file : null
}
