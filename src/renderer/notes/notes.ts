/**
 * notes.json, the hand-off file between the user and Claude (spec #9). Coordinates are Design-size pixels.
 * `next` is the number the next Note gets, kept in the file so a deleted Note's number is never handed out again.
 */
export type Point = { x: number; y: number }
export type Box = Point & { w: number; h: number }
/** Project time, may cross a cut. `end` is where the span's last Frame ends. */
export type Range = { start: number; end: number }
/** The span over whole-video Frames a to b, both included, in either order. */
export const spanOf = (a: number, b: number, fps: number): Range => ({ start: Math.min(a, b) / fps, end: (Math.max(a, b) + 1) / fps })
/** A span as drawn (`range`), moved to start at `start`: it keeps its length (ADR 0003). */
export const spanAt = (range: Range, start: number): Range => ({ start, end: start + range.end - range.start })
// Where Scenes `run` sit next to each other, in that order, in `order`; -1 when nowhere.
const runAt = (run: string[], order: string[]) => order.findIndex((_, i) => run.every((s, k) => order[i + k] === s))
/**
 * A span over a cut whose Scenes (`scenes`) are no longer next to each other, in that order, anywhere in `order` (a
 * Project may list one Scene file twice). Also true when one of them is gone, or `scenes` no longer starts at `scene`.
 */
export const crossedApart = ({ scene, scenes }: Pick<Note, 'scene' | 'scenes'>, order: string[]) =>
  !!scenes && (scenes[0] !== scene || runAt(scenes, order) < 0)
/**
 * Where a Note's Scene is in `order`; -1 when it is gone. A span over a cut takes the copy its crossed Scenes still follow,
 * so a Scene listed twice keeps it on the cut it was drawn on; any other Note takes the first copy.
 * shortcut: when the crossed Scenes repeat as a whole, the first run wins; store the Scene's index if that bites.
 */
export function sceneIndex(note: Pick<Note, 'scene' | 'scenes'>, order: string[]) {
  const run = note.scenes && !crossedApart(note, order) ? runAt(note.scenes, order) : -1
  return run >= 0 ? run : order.indexOf(note.scene)
}
/**
 * The Notes that go with Scene `index` of `order` when it is deleted: Marked on it, or a span that starts in it. When
 * `order` lists that page again elsewhere, the page stays, and so do its Notes: only a span over a cut drawn from this
 * copy goes.
 */
export const notesOnScene = <N extends Pick<Note, 'scene' | 'scenes'>>(notes: N[], index: number, order: string[]) => {
  const listedAgain = order.filter((f) => f === order[index]).length > 1
  return notes.filter((n) => sceneIndex(n, order) === index && (!listedAgain || (!!n.scenes && !crossedApart(n, order))))
}
export type Note = {
  n: number
  text: string
  done: boolean
  scene: string
  sceneTime: number
  time: number
  frame: number
  point?: Point
  box?: Box
  stroke?: Point[]
  range?: Range
  /** A span over a cut: the Scenes it covered when drawn, in order, from `scene`. Missing when it is inside one Scene. */
  scenes?: string[]
  image?: string
  created: string
  updated: string
}
export type NotesFile = { version: 1; next: number; notes: Note[] }
export type NewNote = Omit<Note, 'n' | 'done' | 'created' | 'updated'>

const isNoteNumber = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown) => typeof v === 'string'
const isPoint = (p?: Partial<Box>) => !!p && num(p.x) && num(p.y)
const isMark = {
  point: isPoint,
  box: (b: Partial<Box>) => isPoint(b) && num(b.w) && num(b.h),
  stroke: (s: unknown) => Array.isArray(s) && s.length >= 2 && s.every(isPoint),
  range: (r: Partial<Range>) => !!r && num(r.start) && num(r.end) && 0 <= r.start! && r.start! <= r.end!,
}
const MARKS = Object.keys(isMark) as (keyof typeof isMark)[]
// Exactly one Mark.
const isNote = (n: Partial<Note>) =>
  isNoteNumber(n?.n) &&
  str(n.text) && str(n.scene) && str(n.created) && str(n.updated) && (n.image === undefined || str(n.image)) &&
  typeof n.done === 'boolean' && num(n.sceneTime) && num(n.time) && num(n.frame) &&
  MARKS.filter((k) => n[k] !== undefined).length === 1 &&
  MARKS.every((k) => n[k] === undefined || isMark[k](n[k] as never)) &&
  // Shape only: a `scenes` out of step with `scene` is flagged in the list (crossedApart), never a file nobody can open.
  (n.scenes === undefined || (Array.isArray(n.scenes) && n.scenes.length >= 2 && n.scenes.every(str)))

/**
 * null = no notes.json yet. Throws on a version this app does not know, so it never overwrites a newer file, and on
 * any malformed Note, so neither the list nor main (which checks every write with this) ever takes one.
 */
export function parseNotes(json: unknown): NotesFile {
  if (json == null) return { version: 1, next: 1, notes: [] }
  const { version, next, notes } = json as Partial<NotesFile>
  if (version !== 1) throw new Error(`notes.json version ${version} is not one this KapeCut can read`)
  if (!Array.isArray(notes) || !notes.every(isNote)) throw new Error('notes.json has no valid notes list')
  if (new Set(notes.map((n) => n.n)).size < notes.length) throw new Error('notes.json has two Notes with one number')
  const after = Math.max(0, ...notes.map((n) => n.n)) + 1
  return { version, next: isNoteNumber(next) ? Math.max(next!, after) : after, notes }
}

export function addNote(file: NotesFile, fields: NewNote, now: string) {
  const { text, scene, sceneTime, time, frame, point, box, stroke, range, scenes, image } = fields
  // Key order is the spec's, so the file reads the same to Claude every time.
  const note: Note = { n: file.next, text, done: false, scene, sceneTime, time, frame, point, box, stroke, range, scenes, image, created: now, updated: now }
  for (const k of [...MARKS, 'scenes', 'image'] as const) if (note[k] === undefined) delete note[k]
  return { note, file: { ...file, next: file.next + 1, notes: [...file.notes, note] } }
}

export const editNote = (file: NotesFile, n: number, change: Partial<Pick<Note, 'text' | 'done'>>, now: string): NotesFile => ({
  ...file,
  notes: file.notes.map((note) => (note.n === n ? { ...note, ...change, updated: now } : note)),
})

/**
 * The app's next write, merged by Note number with notes.json as it is on disk now (`disk`, raw JSON; null = no file).
 * `base` is the file as the app last read or wrote it, `mine` is base plus the user's change. Claude owns `done` on the
 * Notes whose done it changed since base; the user owns the list itself (adds, deletes), text, Marks and every other
 * done. A Note numbered at or past base's `next` is someone else's addition and is kept. The higher `next` wins, so
 * no number is handed out twice. Throws, so nothing is written, on a file this app
 * cannot read (an unknown future version included).
 */
export function mergeNotes(base: NotesFile, mine: NotesFile, disk: unknown): NotesFile {
  const theirs = parseNotes(disk)
  const byN = (f: NotesFile) => new Map(f.notes.map((note) => [note.n, note]))
  const [was, now] = [byN(base), byN(theirs)]
  const kept = mine.notes.map((note) => {
    const [b, d] = [was.get(note.n), now.get(note.n)]
    return b && d && b.done !== d.done ? { ...note, done: d.done } : note
  })
  const mineByN = byN(mine)
  // A Note numbered past anything the app handed out was added by someone else: kept, so neither side loses a change.
  // A lower number the app no longer has is one the user deleted (a stale copy brings it back): it stays deleted.
  const added = theirs.notes.filter((d) => d.n >= base.next && !mineByN.has(d.n))
  return {
    ...mine,
    next: Math.max(mine.next, theirs.next),
    notes: added.length ? [...kept, ...added].sort((a, b) => a.n - b.n) : kept,
  }
}

export const deleteNote =(file: NotesFile, n: number): NotesFile => ({ ...file, notes: file.notes.filter((note) => note.n !== n) })

/**
 * notes.json as it is on disk now, unparsed; null when there is none. A 500 is a file main could not open: on Windows
 * a scanner, Claude or a test polling the file holds it for a moment (#137). Half a file is a write in place caught
 * midway. Both ask again for about a second, as writeAtomic does; one that never clears (a folder named notes.json,
 * broken JSON) shows its error that much later.
 */
export async function readNotes(): Promise<unknown> {
  for (let i = 0; ; i++) {
    const res = await fetch('/project/notes.json', { cache: 'no-store' })
    if (res.status === 404) return null
    const body = await res.text() // read on a 500 too, so no response stays open
    if (res.ok) {
      try {
        return JSON.parse(body)
      } catch (e) {
        if (i >= 40) throw e
      }
    } else if (res.status !== 500 || i >= 40) throw new Error(`HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}
