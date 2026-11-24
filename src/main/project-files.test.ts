import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyIn, listFiles, readDrop, writeAudio } from './project-files'
import { MAX_LISTED } from '../renderer/files/kind'
import { ownWrite } from './owned-writes'

const temp = (name: string) => mkdtempSync(join(tmpdir(), `kapecut-${name}-`))
const PROJECT = { name: 'P', size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html'], extra: { kept: true } }
function project(json: unknown = PROJECT) {
  const dir = temp('media')
  writeFileSync(join(dir, 'project.json'), JSON.stringify(json))
  return dir
}
const read = (dir: string) => JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))

describe('copyIn', () => {
  it('copies any file into the Project; a name clash gets a suffix and never overwrites', async () => {
    const dir = project()
    const src = join(temp('src'), 'Tone.WAV')
    writeFileSync(src, 'new')
    writeFileSync(join(dir, 'Tone-2.WAV'), 'mine')
    const name = async (src: string) => (await copyIn(dir, src)).name
    expect(await copyIn(dir, src)).toEqual({ name: 'Tone.WAV', copied: true })
    expect(await name(src)).toBe('Tone-3.WAV')
    expect(readFileSync(join(dir, 'Tone-2.WAV'), 'utf8')).toBe('mine')
    expect(readFileSync(join(dir, 'Tone-3.WAV'), 'utf8')).toBe('new')
    const other = join(temp('src'), 'README')
    writeFileSync(other, 'x')
    expect(await name(other)).toBe('README')
    expect(await name(other)).toBe('README-2') // no extension: the suffix goes at the end
  })

  it('a file already in the Project folder is not copied again: its path there comes back', async () => {
    const dir = project()
    mkdirSync(join(dir, 'img'))
    writeFileSync(join(dir, 'img', 'logo.png'), 'x')
    expect(await copyIn(dir, join(dir, 'img', 'logo.png'))).toEqual({ name: 'img/logo.png', copied: false })
    expect(readdirSync(dir).sort()).toEqual(['img', 'project.json'])
  })

  it('a name taken by a folder gets a suffix too', async () => {
    const dir = project()
    mkdirSync(join(dir, 'notes'))
    const src = join(temp('src'), 'notes')
    writeFileSync(src, 'x')
    expect(await copyIn(dir, src)).toEqual({ name: 'notes-2', copied: true })
  })

  it('refuses a file over 1 GB', async () => {
    const src = join(temp('src'), 'huge.wav')
    truncateSync((writeFileSync(src, ''), src), 2 ** 30 + 1) // sparse on NTFS and ext4: no GB is written
    try {
      await expect(copyIn(project(), src)).rejects.toThrow('huge.wav is over 1 GB')
    } finally {
      rmSync(src)
    }
  })

  it('refuses a folder and a missing file', async () => {
    const dir = project()
    const src = temp('src')
    mkdirSync(join(src, 'loop.wav'))
    await expect(copyIn(dir, join(src, 'loop.wav'))).rejects.toThrow('loop.wav is a folder')
    await expect(copyIn(dir, join(src, 'gone.ogg'))).rejects.toThrow('gone.ogg is not a file')
    expect(readdirSync(dir)).toEqual(['project.json'])
  })
})

describe('readDrop', () => {
  it('one folder opens as a Project; files, or a folder among them, are copied (copyIn then refuses the folder)', () => {
    const dir = project()
    const file = join(dir, 'project.json')
    expect(readDrop([dir])).toEqual({ open: dir })
    expect(readDrop([file])).toEqual({ copy: [file] })
    expect(readDrop([dir, file])).toEqual({ copy: [dir, file] })
    for (const bad of [[], [''], 'C:/x', [1]]) expect(() => readDrop(bad)).toThrow('Drop files or a Project folder from disk')
  })
})

describe('listFiles', () => {
  it("lists every file in the Project but the app's own, hidden folders and anything behind a link", async () => {
    const dir = project()
    for (const d of ['img', 'notes', '.git', 'node_modules']) mkdirSync(join(dir, d))
    for (const f of ['a.html', 'click.wav', 'img/logo.png', 'notes.json', 'notes/note-1.png', '.git/HEAD', 'node_modules/x.js', '.swp', 'project.json.12-3.tmp', 'notes.json.12-4.tmp'])
      writeFileSync(join(dir, f), 'x')
    const out = temp('outside')
    writeFileSync(join(out, 'secret.txt'), 'x')
    symlinkSync(out, join(dir, 'link'), 'junction')
    expect(await listFiles(dir)).toEqual(['a.html', 'click.wav', 'img/logo.png'])
  })

  it('stops one past MAX_LISTED, so the panel can say the list was cut', async () => {
    const dir = project()
    for (let i = 0; i < MAX_LISTED + 5; i++) writeFileSync(join(dir, `f${i}.txt`), '')
    expect(await listFiles(dir)).toHaveLength(MAX_LISTED + 1)
  }, 30_000) // 2005 files on Windows passed the 5 s default under a full parallel run (1 in 3, #82)
})

describe('writeAudio', () => {
  it("writes only project.json's audio list, keeping every other key", async () => {
    const dir = project()
    await writeAudio(dir, [{ file: 'a.wav', start: 1.5, volume: 1, junk: 1 }])
    expect(read(dir)).toEqual({ ...PROJECT, audio: [{ file: 'a.wav', start: 1.5, volume: 1 }] })
    expect(readdirSync(dir)).toEqual(['project.json']) // no temp file left
  })

  it('refuses a list parseProject refuses or one naming a file outside the Project; the file is untouched', async () => {
    const dir = project()
    const before = readFileSync(join(dir, 'project.json'), 'utf8')
    await expect(writeAudio(dir, [{ file: 'a.wav', start: -1, volume: 1 }])).rejects.toThrow('audio[0].start')
    await expect(writeAudio(dir, [{ file: '../a.wav', start: 0, volume: 1 }])).rejects.toThrow('inside the Project folder')
    await expect(writeAudio(dir, 'all of them')).rejects.toThrow('"audio" must be a list')
    const out = temp('outside')
    writeFileSync(join(out, 'a.wav'), 'x')
    symlinkSync(out, join(dir, 'link'), 'junction')
    await expect(writeAudio(dir, [{ file: 'link/a.wav', start: 0, volume: 1 }])).rejects.toThrow('link/a.wav is outside the Project')
    expect(readFileSync(join(dir, 'project.json'), 'utf8')).toBe(before)
  })

  it('never writes over a project.json that is broken now', async () => {
    const dir = project({ size: { w: 3, h: 200 }, scenes: ['a.html'] })
    await expect(writeAudio(dir, [])).rejects.toThrow('project.json has an error')
    writeFileSync(join(dir, 'project.json'), '{ nope')
    await expect(writeAudio(dir, [])).rejects.toThrow('project.json has an error')
    expect(readFileSync(join(dir, 'project.json'), 'utf8')).toBe('{ nope')
  })

  it('says to re-read when project.json changed since its own last write; its own writes are marked', async () => {
    const dir = project()
    const file = join(dir, 'project.json')
    expect(await writeAudio(dir, [])).toBe(true) // first write: the page's copy may be older than the disk
    expect(ownWrite(file)).toBe(true)
    expect(await writeAudio(dir, [{ file: 'a.wav', start: 0, volume: 1 }])).toBe(false)
    writeFileSync(file, JSON.stringify({ ...PROJECT, scenes: ['a.html', 'b.html'] })) // Claude adds a Scene
    expect(ownWrite(file)).toBe(false)
    expect(await writeAudio(dir, [])).toBe(true)
    expect(read(dir).scenes).toEqual(['a.html', 'b.html']) // merged with the disk, not the page's copy
  })

  it('writes one after another: the last call wins', async () => {
    const dir = project()
    await Promise.all([1, 2, 3, 4].map((s) => writeAudio(dir, [{ file: 'a.wav', start: s, volume: 1 }])))
    expect(read(dir).audio[0].start).toBe(4)
  })
})
