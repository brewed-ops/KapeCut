import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNotes } from '../renderer/notes/notes'
import { staysUnder } from './file-under'
import { ownWrite, writeAtomic, writeOwned } from './owned-writes'

const MAX_NOTES_JSON = 5 * 2 ** 20
const MAX_NOTE_PNG = 64 * 2 ** 20 // a 4K Frame PNG is well under this
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// Only the app writes these, but main still checks what lands in the file Claude reads: a whole Notes list, size capped.
export async function writeNotes(dir: string, json: unknown) {
  if (typeof json !== 'string' || json.length > MAX_NOTES_JSON) throw new Error('notes.json too large or not text')
  parseNotes(JSON.parse(json))
  await writeOwned(join(dir, 'notes.json'), json)
}

/** True when notes.json holds what the app itself wrote there: a watcher event for it reloads nothing. */
export const ownNotesWrite = (dir: string) => ownWrite(join(dir, 'notes.json'))

/** notes/note-<n>.png; null deletes it. n is the only part of the path the caller picks. */
export async function writeNoteImage(dir: string, n: unknown, png: unknown) {
  if (!Number.isSafeInteger(n) || (n as number) < 1) throw new Error('Bad Note number')
  const file = join(dir, 'notes', `note-${n}.png`)
  if (!staysUnder(dir, join(dir, 'notes'))) throw new Error('The notes folder links outside the Project')
  if (png === null) return rm(file, { force: true })
  const isPng = png instanceof Uint8Array && png.length <= MAX_NOTE_PNG && PNG_SIGNATURE.every((b, i) => png[i] === b)
  if (!isPng) throw new Error('Note picture is not a PNG')
  await mkdir(join(dir, 'notes'), { recursive: true })
  await writeAtomic(file, png)
}
