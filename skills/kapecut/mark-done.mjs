#!/usr/bin/env node
// Sets done on the Notes Claude fixed and checked: node mark-done.mjs <project folder> <n> [<n> ...]
// Changes nothing but `done`, keeps `next`, and writes notes.json the way KapeCut does: a temp file, then a rename,
// so KapeCut never reads half a file. A Note the user deleted meanwhile is skipped, never brought back.
// `updated` stays the user's: KapeCut's merge keeps its own copy of every field but Claude's done (ADR 0003).
// A span's `range` and `scenes` stay as drawn too: where it is today is computed from `scene` + `sceneTime` on read.
// shortcut: a KapeCut save landing between this read and the rename is overwritten (a few ms, like the app's own
// window in ADR 0003); upgrade to a lock file if users report a lost edit.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const fail = (message, code = 1) => {
  console.error(message)
  process.exit(code)
}

const [dir, ...args] = process.argv.slice(2)
if (!dir || !args.length || !args.every((a) => /^[1-9]\d*$/.test(a) && Number.isSafeInteger(Number(a))))
  fail('Usage: node mark-done.mjs <project folder> <Note number> [<Note number> ...]', 2)

const file = join(dir, 'notes.json')
let notes
try {
  notes = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  fail(`Cannot read ${file}: ${e.message}; nothing written`)
}
// The parts of KapeCut's own check (parseNotes) this script relies on: one Note per whole number, done a boolean.
const list = notes?.version === 1 && Array.isArray(notes.notes) ? notes.notes : null
const valid = list?.every((note) => Number.isSafeInteger(note?.n) && note.n > 0 && typeof note.done === 'boolean')
if (!valid || new Set(list.map((note) => note.n)).size < list.length)
  fail(`${file} is not a notes.json version 1 file KapeCut can read; nothing written`)

const lines = []
let changed = false
for (const n of args.map(Number)) {
  const note = list.find((note) => note.n === n)
  if (!note) lines.push(`Note ${n}: not in notes.json (the user deleted it), skipped`)
  else if (note.done) lines.push(`Note ${n}: done already`)
  else {
    note.done = true
    changed = true
    lines.push(`Note ${n}: done`)
  }
}

if (changed) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(notes, null, 2) + '\n')
    // Same retry as writeAtomic in src/main/owned-writes.ts and readNotes in src/renderer/notes/notes.ts: Windows
    // refuses the rename while KapeCut has the file open.
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, file)
        break
      } catch (e) {
        if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
      }
    }
  } catch (e) {
    rmSync(tmp, { force: true })
    fail(`Cannot write ${file}: ${e.message}; nothing written`)
  }
}
console.log(lines.join('\n')) // only once notes.json holds every done it reports
