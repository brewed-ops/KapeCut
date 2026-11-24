import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownNotesWrite, writeNoteImage, writeNotes } from './notes-files'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const NOTES = JSON.stringify({ version: 1, next: 1, notes: [] })
const project = () => mkdtempSync(join(tmpdir(), 'kapecut-notes-'))

describe('Notes files', () => {
  it('writes notes.json and a Note picture, leaving no temp file', async () => {
    const dir = project()
    await writeNoteImage(dir, 3, PNG)
    await writeNotes(dir, NOTES)
    expect(readFileSync(join(dir, 'notes.json'), 'utf8')).toBe(NOTES)
    expect(new Uint8Array(readFileSync(join(dir, 'notes/note-3.png')))).toEqual(PNG)
    expect(readdirSync(dir).concat(readdirSync(join(dir, 'notes')))).toEqual(['notes', 'notes.json', 'note-3.png'])
    await writeNoteImage(dir, 3, null)
    expect(existsSync(join(dir, 'notes/note-3.png'))).toBe(false)
  })

  it('two writes at once never mix: the file is one of them, whole', async () => {
    const dir = project()
    const big = (k: number) => JSON.stringify({ version: 1, next: 2, notes: [], pad: String(k).repeat(200_000) })
    await Promise.all([1, 2, 3, 4].map((k) => writeNotes(dir, big(k))))
    expect([1, 2, 3, 4].map(big)).toContain(readFileSync(join(dir, 'notes.json'), 'utf8'))
    expect(readdirSync(dir)).toEqual(['notes.json'])
  })

  it("tells the app's own notes.json write from anyone else's", async () => {
    const dir = project()
    expect(ownNotesWrite(dir)).toBe(false) // no file yet
    await writeNotes(dir, NOTES)
    expect(ownNotesWrite(dir)).toBe(true)
    writeFileSync(join(dir, 'notes.json'), NOTES.replace('"next":1', '"next":2')) // Claude, same size
    expect(ownNotesWrite(dir)).toBe(false)
    writeFileSync(join(dir, 'notes.json'), NOTES + '\n') // Claude, one byte more
    expect(ownNotesWrite(dir)).toBe(false)
    expect(ownNotesWrite(project())).toBe(false) // another Project's file is never ours
  })

  it('a write still landing does not make the one before it look foreign', async () => {
    const dir = project()
    const second = NOTES.replace('"next":1', '"next":2')
    await writeNotes(dir, NOTES)
    const landing = writeNotes(dir, second) // its watcher event for the first write may fire now
    expect(ownNotesWrite(dir)).toBe(true)
    await landing
    expect(ownNotesWrite(dir)).toBe(true)
    writeFileSync(join(dir, 'notes.json'), NOTES) // the older write's bytes, written by someone else later
    expect(ownNotesWrite(dir)).toBe(false)
  })

  it('refuses what is not a Notes list or a PNG, and a bad Note number', async () => {
    const dir = project()
    await expect(writeNotes(dir, '{"version":9,"notes":[]}')).rejects.toThrow('version 9')
    await expect(writeNotes(dir, 'not json')).rejects.toThrow('JSON')
    await expect(writeNotes(dir, '{"version":1,"notes":[{"n":1,"text":{}}]}')).rejects.toThrow('valid notes list')
    await expect(writeNotes(dir, ' '.repeat(6 * 2 ** 20))).rejects.toThrow('too large')
    await expect(writeNoteImage(dir, 1, new Uint8Array([1, 2, 3]))).rejects.toThrow('not a PNG')
    await expect(writeNoteImage(dir, 0, PNG)).rejects.toThrow('Note number')
    await expect(writeNoteImage(dir, '../x' as unknown as number, PNG)).rejects.toThrow('Note number')
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('Notes files behind a link', () => {
  it('refuses to write or delete a Note picture through a notes folder that links outside the Project', async () => {
    const dir = project()
    const outside = mkdtempSync(join(tmpdir(), 'kapecut-outside-'))
    symlinkSync(outside, join(dir, 'notes'), 'junction')
    await expect(writeNoteImage(dir, 1, PNG)).rejects.toThrow(/outside the Project/)
    await expect(writeNoteImage(dir, 1, null)).rejects.toThrow(/outside the Project/)
    expect(readdirSync(outside)).toEqual([])
  })
})
