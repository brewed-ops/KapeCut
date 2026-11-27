import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectTime, timeIn } from '../viewer/project-time'
import { addNote, crossedApart, sceneIndex, notesOnScene, deleteNote, editNote, mergeNotes, parseNotes, readNotes, spanAt, spanOf, type NotesFile } from './notes'

const at = { scene: 'a.html', sceneTime: 0.2, time: 0.2, frame: 6 }
const T1 = '2026-11-22T10:00:00.000Z'
const T2 = '2026-11-22T11:00:00.000Z'

describe('notes.json', () => {
  it('no file is an empty list starting at Note 1', () => {
    expect(parseNotes(null)).toEqual({ version: 1, next: 1, notes: [] })
  })

  it('adds numbered Notes in the spec #9 shape', () => {
    let file = parseNotes(null)
    ;({ file } = addNote(file, { text: 'Bigger', ...at, point: { x: 50, y: 60 }, image: 'notes/note-1.png' }, T1))
    ;({ file } = addNote(file, { text: 'Warmer', ...at, box: { x: 1, y: 2, w: 3, h: 4 } }, T1))
    expect(file).toEqual({
      version: 1,
      next: 3,
      notes: [
        { n: 1, text: 'Bigger', done: false, ...at, point: { x: 50, y: 60 }, image: 'notes/note-1.png', created: T1, updated: T1 },
        { n: 2, text: 'Warmer', done: false, ...at, box: { x: 1, y: 2, w: 3, h: 4 }, created: T1, updated: T1 },
      ],
    })
  })

  it('adds pencil stroke and span Notes, with one Mark each', () => {
    let { file } = addNote(parseNotes(null), { text: 'Path', ...at, stroke: [{ x: 1, y: 2 }, { x: 3, y: 4 }], image: 'notes/note-1.png' }, T1)
    ;({ file } = addNote(file, { text: 'Slower', ...at, range: { start: 0.2, end: 0.8 } }, T1))
    expect(Object.keys(file.notes[0])).toEqual(['n', 'text', 'done', 'scene', 'sceneTime', 'time', 'frame', 'stroke', 'image', 'created', 'updated'])
    expect(file.notes[1]).toEqual({ n: 2, text: 'Slower', done: false, ...at, range: { start: 0.2, end: 0.8 }, created: T1, updated: T1 })
    expect(parseNotes(JSON.parse(JSON.stringify(file))).notes).toEqual(file.notes)
  })

  it('a span covers every Frame from the first to the last one picked, in either order', () => {
    expect(spanOf(6, 24, 30)).toEqual({ start: 6 / 30, end: 25 / 30 })
    expect(spanOf(24, 6, 30)).toEqual({ start: 6 / 30, end: 25 / 30 })
    expect(spanOf(7, 7, 30)).toEqual({ start: 7 / 30, end: 8 / 30 }) // one Frame
  })

  describe('a span follows its start Scene on re-order', () => {
    // Three Scenes of 15 Frames at 30 fps. The span covers a.html Frames 10 to 14 and b.html Frames 0 to 4: the a to b cut.
    const order = (...scenes: string[]) => ({ scenes, pt: projectTime(scenes.map(() => 0.5), 30) })
    type Span = { scene: string; sceneTime: number; range: { start: number; end: number }; scenes?: string[] }
    const crossing: Span = { scene: 'a.html', sceneTime: 10 / 30, range: { start: 10 / 30, end: 20 / 30 }, scenes: ['a.html', 'b.html'] }
    const where = (note: Span, { scenes, pt }: ReturnType<typeof order>) => spanAt(note.range, timeIn(sceneIndex(note, scenes), note.sceneTime, pt))

    it('moves with its start Scene and keeps its length', () => {
      const moved = where(crossing, order('c.html', 'a.html', 'b.html'))
      expect(moved.start).toBeCloseTo(25 / 30, 9) // a.html now starts at Frame 15
      expect(moved.end).toBeCloseTo(35 / 30, 9) // still 10 Frames: on the a to b cut at Frame 30
    })

    it('inside one Scene, follows that Scene exactly', () => {
      const inside: Span = { scene: 'b.html', sceneTime: 2 / 30, range: { start: 17 / 30, end: 23 / 30 } }
      const moved = where(inside, order('b.html', 'c.html', 'a.html'))
      expect(moved.start).toBeCloseTo(2 / 30, 9)
      expect(moved.end).toBeCloseTo(8 / 30, 9)
    })

    it('has no time once its start Scene is gone', () => {
      expect(where(crossing, order('b.html', 'c.html')).start).toBeNaN()
    })

    it('is flagged when the Scenes it crossed stop being neighbours in that order, not while they stay', () => {
      const apart = (scenes: string[] | undefined, ...order: string[]) => crossedApart({ scene: 'a.html', scenes }, order)
      const ab = ['a.html', 'b.html']
      expect(apart(ab, 'a.html', 'b.html', 'c.html')).toBe(false)
      expect(apart(ab, 'c.html', 'a.html', 'b.html')).toBe(false)
      expect(apart(ab, 'b.html', 'c.html', 'a.html')).toBe(true) // a is last now
      expect(apart(ab, 'a.html', 'c.html', 'b.html')).toBe(true) // c came between
      expect(apart(ab, 'b.html', 'a.html', 'c.html')).toBe(true) // swapped
      expect(apart(ab, 'a.html', 'c.html')).toBe(true) // b is gone
      expect(apart(ab, 'c.html', 'b.html')).toBe(true) // a is gone
      expect(apart(['a.html', 'b.html', 'c.html'], 'a.html', 'b.html', 'c.html')).toBe(false)
      expect(apart(['a.html', 'b.html', 'c.html'], 'a.html', 'c.html', 'b.html')).toBe(true)
      expect(apart(undefined, 'b.html', 'a.html')).toBe(false) // inside one Scene, or a file from before #48
      expect(apart(['a.html', 'c.html'], 'a.html', 'b.html', 'a.html', 'c.html')).toBe(false) // a listed twice
      expect(apart(['b.html', 'c.html'], 'b.html', 'c.html')).toBe(true) // out of step with its Scene (a hand edit)
    })

    it('a Scene listed twice: a span over a cut stays on the copy it crossed from', () => {
      const ac: Span = { ...crossing, scenes: ['a.html', 'c.html'] } // drawn over the second a.html into c.html
      const moved = where(ac, order('a.html', 'b.html', 'a.html', 'c.html'))
      expect(moved.start).toBeCloseTo(40 / 30, 9) // the second a.html starts at Frame 30
      expect(sceneIndex({ scene: 'a.html' }, ['b.html', 'a.html', 'a.html'])).toBe(1) // any other Note: the first copy
    })

    it('deleting a Scene takes the Notes Marked on it and the spans that start in it, only on that copy', () => {
      const note = (n: number, scene: string, scenes?: string[]) => ({ n, scene, scenes })
      const order = ['a.html', 'b.html', 'a.html', 'c.html']
      const notes = [note(1, 'a.html'), note(2, 'b.html'), note(3, 'a.html', ['a.html', 'b.html']), note(4, 'b.html', ['b.html', 'a.html']), note(5, 'a.html', ['a.html', 'c.html']), note(6, 'gone.html')]
      const ns = (i: number) => notesOnScene(notes, i, order).map((x) => x.n)
      expect(ns(0)).toEqual([1, 3]) // a point on the first a.html, and a span from it into b.html
      expect(ns(1)).toEqual([2, 4]) // a span that ends in b.html (3) stays with its start Scene
      expect(ns(2)).toEqual([5]) // the second a.html: only the span drawn from that copy
      expect(ns(3)).toEqual([])
    })

    it('stores the Scenes it crossed, and a file without them still opens', () => {
      const { file } = addNote(parseNotes(null), { text: 'Cut', ...at, range: { start: 0.2, end: 0.8 }, scenes: ['a.html', 'b.html'] }, T1)
      expect(Object.keys(file.notes[0])).toEqual(['n', 'text', 'done', 'scene', 'sceneTime', 'time', 'frame', 'range', 'scenes', 'created', 'updated'])
      expect(parseNotes(JSON.parse(JSON.stringify(file))).notes).toEqual(file.notes)
      const old = { ...file.notes[0], scenes: undefined }
      expect(parseNotes({ version: 1, notes: [old] }).notes).toHaveLength(1)
      // Out of step with `scene`: flagged in the list (above), never a file the user's Notes cannot be read from.
      expect(parseNotes({ version: 1, notes: [{ ...file.notes[0], scenes: ['b.html', 'c.html'] }] }).notes).toHaveLength(1)
    })
  })

  it('never reuses a number after a delete, also after a reopen', () => {
    let { file } = addNote(parseNotes(null), { text: 'a', ...at, point: { x: 0, y: 0 } }, T1)
    ;({ file } = addNote(file, { text: 'b', ...at, point: { x: 0, y: 0 } }, T1))
    file = parseNotes(JSON.parse(JSON.stringify(deleteNote(file, 2))))
    expect(addNote(file, { text: 'c', ...at, point: { x: 0, y: 0 } }, T1).note.n).toBe(3)
  })

  const valid = (n: number) => ({ n, text: 't', done: false, ...at, point: { x: 1, y: 2 }, created: T1, updated: T1 })

  it('a file without next numbers after its highest Note', () => {
    expect(parseNotes({ version: 1, notes: [valid(4), valid(7)] }).next).toBe(8)
  })

  it('refuses a Note with a missing or wrong field, or a repeated number', () => {
    for (const bad of [
      { n: 1 },
      { ...valid(1), text: {} },
      { ...valid(1), scene: 5 },
      { ...valid(1), sceneTime: '0.2' },
      { ...valid(1), done: 'no' },
      { ...valid(1), point: { x: 'a', y: 2 } },
      { ...valid(1), point: undefined, box: { x: 1, y: 2, w: 3 } },
      { ...valid(1), point: undefined },
      { ...valid(1), stroke: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }, // two Marks
      { ...valid(1), point: undefined, stroke: [{ x: 1, y: 2 }] }, // a stroke is at least two points
      { ...valid(1), point: undefined, stroke: [{ x: 1, y: 2 }, { x: 'a', y: 4 }] },
      { ...valid(1), point: undefined, stroke: { x: 1, y: 2 } },
      { ...valid(1), point: undefined, range: { start: 0.8, end: 0.2 } },
      { ...valid(1), point: undefined, range: { start: -1, end: 0.2 } },
      { ...valid(1), point: undefined, range: { start: '0', end: 0.2 } },
      { ...valid(1), point: undefined, range: { start: 0, end: 1 }, scenes: ['a.html'] }, // crossing is at least two
      { ...valid(1), point: undefined, range: { start: 0, end: 1 }, scenes: ['a.html', 2] },
      { ...valid(1), point: undefined, range: { start: 0, end: 1 }, scenes: 'a.html' },
    ])
      expect(() => parseNotes({ version: 1, notes: [bad] }), JSON.stringify(bad)).toThrow('notes.json')
    expect(() => parseNotes({ version: 1, notes: [valid(1), valid(1)] })).toThrow('notes.json')
    expect(parseNotes({ version: 1, notes: [{ ...valid(2), point: undefined, box: { x: 1, y: 2, w: 3, h: 4 } }] }).notes).toHaveLength(1)
  })

  describe('merge with the file on disk, by Note number', () => {
    // base: notes.json as the app last read or wrote it. mine: base + the user's change. disk: notes.json now.
    let base = parseNotes(null)
    for (const t of ['a', 'b', 'c']) ({ file: base } = addNote(base, { text: t, ...at, point: { x: 0, y: 0 } }, T1))
    const json = (f: NotesFile) => JSON.parse(JSON.stringify(f))
    const flip = (f: NotesFile, ...ns: number[]) => ({ ...f, notes: f.notes.map((n) => (ns.includes(n.n) ? { ...n, done: !n.done } : n)) })
    const rows = (f: NotesFile) => f.notes.map((n) => [n.n, n.text, n.done])

    it("user-only edits: the user's text, done and new Notes land", () => {
      const mine = addNote(flip(editNote(base, 1, { text: 'A' }, T2), 2), { text: 'd', ...at, point: { x: 0, y: 0 } }, T2).file
      expect(rows(mergeNotes(base, mine, json(base)))).toEqual([[1, 'A', false], [2, 'b', true], [3, 'c', false], [4, 'd', false]])
    })

    it('Claude-only done: kept, also on a Note the user edits', () => {
      expect(rows(mergeNotes(base, editNote(base, 1, { text: 'A' }, T2), json(flip(base, 1, 3))))).toEqual([
        [1, 'A', true],
        [2, 'b', false],
        [3, 'c', true],
      ])
    })

    it('both at once: Claude owns done on the Notes it touched, the user owns text and the rest', () => {
      // Claude: done on 1, rewrote 2's text. User: done on 2, edited 3.
      const disk = json(flip(base, 1))
      disk.notes[1].text = 'Claude wrote this'
      const mine = editNote(flip(base, 2), 3, { text: 'C' }, T2)
      expect(rows(mergeNotes(base, mine, disk))).toEqual([[1, 'a', true], [2, 'b', true], [3, 'C', false]])
      // A done the user set back is the user's, unless Claude changed that Note's done since.
      const doneBase = flip(base, 1)
      expect(rows(mergeNotes(doneBase, flip(doneBase, 1), json(doneBase)))[0]).toEqual([1, 'a', false])
      expect(rows(mergeNotes(doneBase, editNote(doneBase, 1, { text: 'A' }, T2), json(base)))[0]).toEqual([1, 'A', false])
    })

    it("deletes: the user's delete wins over Claude's done; a Note Claude dropped stays", () => {
      const disk = json(flip(base, 2))
      disk.notes.splice(0, 1) // Claude dropped Note 1
      expect(rows(mergeNotes(base, deleteNote(base, 2), disk))).toEqual([[1, 'a', false], [3, 'c', false]])
    })

    it('keeps a Note the app never saw (added to the file by someone else), in number order', () => {
      const disk = json(base)
      disk.notes.push({ ...disk.notes[0], n: 7, text: 'theirs' })
      disk.next = 8
      const mine = deleteNote(base, 2)
      expect(rows(mergeNotes(base, mine, disk))).toEqual([[1, 'a', false], [3, 'c', false], [7, 'theirs', false]])
      expect(mergeNotes(base, mine, disk).next).toBe(8)
      // A stale copy still holding Note 2, which the user deleted, does not bring it back.
      expect(rows(mergeNotes(mine, mine, disk)).map(([n]) => n)).toEqual([1, 3, 7])
      // A notes.json that appears after the app opened an empty list: every Note in it is new.
      expect(rows(mergeNotes(parseNotes(null), parseNotes(null), json(base)))).toEqual(rows(base))
    })

    it('never hands a number out twice: the higher next wins, also when Claude dropped next and the top Note', () => {
      const deleted = deleteNote(base, 3) // next stays 4
      const disk = { version: 1, notes: json(base).notes.slice(0, 2) } // no next: the file alone would say 3
      expect(mergeNotes(deleted, deleted, disk).next).toBe(4)
      expect(mergeNotes(base, base, { ...json(base), next: 9 }).next).toBe(9)
    })

    it('refuses an unknown future version, so the app never writes over it', () => {
      expect(() => mergeNotes(base, base, { version: 2, next: 1, notes: [] })).toThrow('notes.json version 2')
    })

    it("no notes.json on disk: the user's list is written back", () => {
      expect(rows(mergeNotes(base, base, null))).toEqual(rows(base))
    })
  })

  it('edits text or done, and the updated time only', () => {
    const { file } = addNote(parseNotes(null), { text: 'a', ...at, point: { x: 0, y: 0 } }, T1)
    expect(editNote(file, 1, { text: 'b' }, T2).notes[0]).toMatchObject({ n: 1, text: 'b', done: false, created: T1, updated: T2 })
    expect(editNote(file, 1, { done: true }, T2).notes[0]).toMatchObject({ n: 1, text: 'a', done: true, created: T1, updated: T2 })
  })

  it('refuses a version it does not know, and a file that is not a Notes list', () => {
    expect(() => parseNotes({ version: 2, notes: [] })).toThrow('notes.json version 2')
    expect(() => parseNotes({ version: 1, notes: {} })).toThrow('notes.json')
    expect(() => parseNotes({ version: 1, notes: [{ ...valid(1), n: 'x' }] })).toThrow('notes.json')
  })
})

describe('readNotes', () => {
  afterEach(() => (vi.unstubAllGlobals(), vi.useRealTimers()))
  const answers = (...statuses: number[]) => {
    const fetch = vi.fn(async () => {
      const status = statuses.shift() ?? 200
      return new Response(status === 200 ? '{"version":1,"notes":[]}' : 'Cannot read', { status })
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  // Windows: a scanner, an indexer or Claude's reader holding notes.json makes main answer 500 for a moment (#137).
  it('waits out a notes.json locked for a moment', async () => {
    const fetch = answers(500, 500, 500)
    expect(await readNotes()).toEqual({ version: 1, notes: [] })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('reads again a notes.json caught half written (a write in place, not temp then rename)', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => new Response(++calls === 1 ? '{"version":1,"no' : '{"version":1,"notes":[]}'))
    expect(await readNotes()).toEqual({ version: 1, notes: [] })
    expect(calls).toBe(2)
  })

  it('no notes.json is null, asked once', async () => {
    const fetch = answers(404)
    expect(await readNotes()).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a notes.json that stays unreadable fails after 41 tries', async () => {
    vi.useFakeTimers()
    const fetch = answers(...Array(41).fill(500))
    const read = expect(readNotes()).rejects.toThrow('HTTP 500')
    await vi.runAllTimersAsync()
    await read
    expect(fetch).toHaveBeenCalledTimes(41)
  })
})
