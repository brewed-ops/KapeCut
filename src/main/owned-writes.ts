import { rename, rm, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

let seq = 0
const OWN_TMP = new RegExp(`\\.${process.pid}-\\d+\\.tmp$`)
/** True for a temp file writeAtomic of this app made (its name carries the pid), not one of Claude's. */
export const ownTemp = (file: string) => OWN_TMP.test(file)

// Files the app moved into place whole (an Export's MP4): the watcher's next event for one is the app's own.
const landed = new Set<string>()
export const markLanded = (file: string) => void landed.add(resolve(file))
/** True once for a file markLanded named, then forgotten. */
export const ownLanded = (file: string) => landed.delete(resolve(file))

/**
 * Temp file, then rename: a crash mid-write never leaves a half-written file where Claude reads it. Each write has its
 * own temp name, so two at once never rename each other's half. On Windows the rename fails while another process
 * (Claude, an editor) has the file open, so it retries for about a second. skills/kapecut/mark-done.mjs, Claude's
 * side of notes.json, and readNotes in src/renderer/notes/notes.ts (the read side) copy this retry, a 25 ms step for about
 * a second: change all three together. readNotes times its second on the clock, as each of its reads is a fetch that
 * can take 100+ ms (#29); a rename or write here is quick, so 41 steps are that second.
 */
export async function writeAtomic(file: string, data: string | Uint8Array) {
  const tmp = `${file}.${process.pid}-${++seq}.tmp`
  await writeFile(tmp, data)
  for (let i = 0; ; i++) {
    try {
      return await rename(tmp, file)
    } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) {
        await rm(tmp, { force: true })
        throw e
      }
      await sleep(25)
    }
  }
}

// Per file the app writes for Claude (notes.json, project.json): the app's last finished write and the ones still being
// renamed into place, so the watcher can tell the app's own writes from Claude's. The previous write stays "last" until
// the next one lands, so its late watcher event is still recognised.
const written = new Map<string, { last?: string; pending: Set<string> }>()

/** writeAtomic, remembered so ownWrite can tell it from Claude's writes. */
export async function writeOwned(file: string, text: string) {
  const mine = written.get(file) ?? written.set(file, { pending: new Set() }).get(file)!
  mine.pending.add(text) // before the rename: the watcher may report it before writeAtomic returns
  try {
    await writeAtomic(file, text)
    mine.last = text
  } finally {
    mine.pending.delete(text)
  }
}

/** What the app last wrote to file, if anything. */
export const lastOwnWrite = (file: string) => written.get(file)?.last

/**
 * True when file holds what the app itself wrote there, so a watcher event for it is the app's own write (or Claude
 * wrote the very same bytes) and nothing needs reloading.
 */
export function ownWrite(file: string) {
  const mine = written.get(file)
  if (!mine) return false
  try {
    // Sizes first: main reads only a file as big as one of its own writes, never whatever size someone else wrote.
    const size = statSync(file).size
    const ours = [mine.last, ...mine.pending].filter((s) => s !== undefined && Buffer.byteLength(s) === size)
    return ours.length > 0 && ours.includes(readFileSync(file, 'utf8'))
  } catch {
    return false // gone or unreadable: let the page find out
  }
}
