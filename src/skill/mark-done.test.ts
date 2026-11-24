import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { editNote, mergeNotes, parseNotes } from '../renderer/notes/notes'

// The script the KapeCut skill runs to set done on the Notes Claude fixed (skills/kapecut/mark-done.mjs).
const SCRIPT = fileURLToPath(new URL('../../skills/kapecut/mark-done.mjs', import.meta.url))
const T = '2026-11-23T10:00:00.000Z'
const at = { scene: 'scene-1.html', sceneTime: 0.5, time: 0.5, frame: 15, created: T, updated: T }
// One Note per Mark as KapeCut writes them; Note 5 was deleted, so next stays 7 although the highest n is 6.
const seed = {
  version: 1,
  next: 7,
  notes: [
    { n: 1, text: 'Bigger', done: false, ...at, point: { x: 540, y: 960 }, image: 'notes/note-1.png' },
    { n: 2, text: 'Warmer', done: false, ...at, box: { x: 100, y: 200, w: 300, h: 400 }, image: 'notes/note-2.png' },
    { n: 3, text: 'Smoother path', done: false, ...at, stroke: [{ x: 1, y: 2 }, { x: 3, y: 4 }], image: 'notes/note-3.png' },
    { n: 4, text: 'Slower ending', done: false, ...at, range: { start: 0.5, end: 2 }, scenes: ['scene-1.html', 'scene-2.html'] },
    { n: 6, text: 'Already fixed', done: true, ...at, point: { x: 10, y: 10 } },
  ],
}
const seedText = JSON.stringify(seed, null, 2) + '\n'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function project(text = seedText) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-mark-done-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'notes.json'), text)
  return dir
}
const run = (dir: string, ...ns: string[]) => {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, dir, ...ns], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, out: err.stdout + err.stderr }
  }
}
const disk = (dir: string) => readFileSync(join(dir, 'notes.json'), 'utf8')

describe('mark-done.mjs', () => {
  it('sets done on the named Notes only, keeps next and every other field, leaves no temp file', () => {
    const dir = project()
    expect(run(dir, '1', '4').code).toBe(0)
    const after = parseNotes(JSON.parse(disk(dir)))
    expect(after).toEqual({ ...seed, notes: seed.notes.map((n) => (n.n === 1 || n.n === 4 ? { ...n, done: true } : n)) })
    expect(disk(dir)).toBe(seedText.replace(/"done": false/, '"done": true').replace(/("n": 4,\n\s+"text": "Slower ending",\n\s+"done": )false/, '$1true'))
    expect(readdirSync(dir)).toEqual(['notes.json'])
  })

  it("KapeCut's next write keeps Claude's done and the user's own edit made meanwhile", () => {
    const dir = project()
    const base = parseNotes(seed)
    const mine = editNote(base, 2, { text: 'Warmer, more orange' }, T)
    run(dir, '1', '3')
    const merged = mergeNotes(base, mine, JSON.parse(disk(dir)))
    expect(merged.notes.map((n) => [n.n, n.text, n.done])).toEqual([
      [1, 'Bigger', true],
      [2, 'Warmer, more orange', false],
      [3, 'Smoother path', true],
      [4, 'Slower ending', false],
      [6, 'Already fixed', true],
    ])
    expect(merged.next).toBe(7)
  })

  it('skips a Note the user deleted meanwhile and never brings it back', () => {
    const dir = project()
    const r = run(dir, '5', '2')
    expect(r.code).toBe(0)
    expect(r.out).toBe('Note 5: not in notes.json (the user deleted it), skipped\nNote 2: done\n')
    expect(JSON.parse(disk(dir)).notes.map((n: { n: number; done: boolean }) => [n.n, n.done])).toEqual([
      [1, false], [2, true], [3, false], [4, false], [6, true],
    ])
  })

  it('writes nothing when every named Note is done already', () => {
    const dir = project(JSON.stringify(seed))
    expect(run(dir, '6')).toEqual({ code: 0, out: 'Note 6: done already\n' })
    expect(disk(dir)).toBe(JSON.stringify(seed)) // not reformatted: no write reached the file
  })

  it('refuses, without writing, a file it cannot read, a newer version, two Notes with one number, or a bad Note number', () => {
    const twice = JSON.stringify({ ...seed, notes: [seed.notes[0], { ...seed.notes[1], n: 1 }] })
    const textN = JSON.stringify({ ...seed, notes: [{ ...seed.notes[0], n: '1' }] })
    const noDone = JSON.stringify({ ...seed, notes: [{ ...seed.notes[0], done: undefined }] })
    for (const text of ['{ broken', JSON.stringify({ ...seed, version: 2 }), JSON.stringify({ version: 1 }), twice, textN, noDone]) {
      const dir = project(text)
      const r = run(dir, '1')
      expect(r.code, text).not.toBe(0)
      expect(disk(dir)).toBe(text)
    }
    const dir = project()
    for (const bad of [[], ['x'], ['0'], ['1.5'], ['0x1'], ['1e0'], [' 1'], ['1', '2x']]) expect(run(dir, ...bad).code, bad.join()).not.toBe(0)
    expect(disk(dir)).toBe(seedText)
  })

  // Windows refuses a rename over a read-only file, the same EPERM a long KapeCut read gives.
  it.runIf(process.platform === 'win32')('reports no Note done when the write fails, and leaves no temp file', () => {
    const dir = project()
    chmodSync(join(dir, 'notes.json'), 0o444)
    const r = run(dir, '1')
    chmodSync(join(dir, 'notes.json'), 0o644)
    expect(r.code).toBe(1)
    expect(r.out).not.toContain('Note 1: done')
    expect(r.out).toContain('nothing written')
    expect(disk(dir)).toBe(seedText)
    expect(readdirSync(dir)).toEqual(['notes.json'])
  })
})
