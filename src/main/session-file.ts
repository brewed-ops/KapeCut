import { rm } from 'node:fs/promises'
import { writeAtomic } from './owned-writes'

let last: Promise<unknown> = Promise.resolve()

/**
 * The Session file (ADR 0005): which Project KapeCut has open, read by Claude before any job. Writes go in turn, so a
 * retrying rename of an older open never lands after a newer one. A failed write removes the file: one naming the
 * Project open before would send Claude to the wrong folder, a missing one makes it stop and ask.
 */
export function writeSession(file: string, project: string) {
  const write = last
    .then(() => writeAtomic(file, JSON.stringify({ version: 1, project })))
    .catch(async (e) => {
      await rm(file, { force: true }).catch(() => {}) // a folder by that name, or still locked: nothing more to do
      throw e
    })
  last = write.catch(() => {}) // a failed write never blocks the next
  return write
}
