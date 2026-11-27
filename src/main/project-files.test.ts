import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyIn, deleteScene, listFiles, readDrop, writeAudio } from './project-files'
import { MAX_LISTED } from '../renderer/files/kind'
import { ownLanded, ownWrite } from './owned-writes'

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

describe('deleteScene', () => {
  const three = () => {
    const dir = project({ ...PROJECT, scenes: ['a.html', 'b.html', 'c.html'] })
    for (const f of ['a.html', 'b.html', 'c.html']) writeFileSync(join(dir, f), f)
    return dir
  }
  const trashed: string[] = []
  const trash = async (path: string) => void (trashed.push(path), rmSync(path))

  it('takes the Scene out of project.json, keeping every other key, and trashes its page as an app-owned change', async () => {
    const dir = three()
    trashed.length = 0
    expect(await deleteScene(dir, 1, 'b.html', trash)).toEqual(['a.html', 'b.html', 'c.html']) // the order it checked
    expect(read(dir)).toEqual({ ...PROJECT, scenes: ['a.html', 'c.html'] })
    expect(trashed).toEqual([join(dir, 'b.html')])
    expect(ownWrite(join(dir, 'project.json'))).toBe(true)
    expect(ownLanded(join(dir, 'b.html'))).toBe(true) // its watcher event is the app's own, not Claude activity
  })

  it('refuses the last Scene, a Scene the list no longer has at that place, and a broken project.json; nothing changes', async () => {
    const dir = project()
    writeFileSync(join(dir, 'a.html'), 'a')
    trashed.length = 0
    await expect(deleteScene(dir, 0, 'a.html', trash)).rejects.toThrow('The last Scene of a Project cannot be deleted')
    const more = three()
    const before = readFileSync(join(more, 'project.json'), 'utf8')
    await expect(deleteScene(more, 0, 'b.html', trash)).rejects.toThrow('The Scene list changed')
    await expect(deleteScene(more, 7, 'b.html', trash)).rejects.toThrow('The Scene list changed')
    await expect(deleteScene(more, '1', 'b.html', trash)).rejects.toThrow('The Scene list changed')
    expect(readFileSync(join(more, 'project.json'), 'utf8')).toBe(before)
    writeFileSync(join(more, 'project.json'), '{ nope')
    await expect(deleteScene(more, 1, 'b.html', trash)).rejects.toThrow('project.json has an error')
    expect(trashed).toEqual([])
    expect(readFileSync(join(dir, 'project.json'), 'utf8')).toBe(JSON.stringify(PROJECT))
  })

  it('a failed move puts the Scene back at its place, keeping an edit Claude made meanwhile; a page another entry names as ./a.html or A.html stays', async () => {
    const dir = three()
    const claudeAddsD = async () => {
      writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...read(dir), scenes: [...read(dir).scenes, 'd.html'] }))
      throw new Error('The trash is busy')
    }
    await expect(deleteScene(dir, 1, 'b.html', claudeAddsD)).rejects.toThrow('busy')
    expect(read(dir)).toEqual({ ...PROJECT, scenes: ['a.html', 'b.html', 'c.html', 'd.html'] })
    expect(ownLanded(join(dir, 'b.html'))).toBe(false)
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...PROJECT, scenes: ['a.html', './a.html', ...(process.platform === 'linux' ? [] : ['A.html'])] }))
    trashed.length = 0
    await deleteScene(dir, 1, './a.html', trash)
    if (process.platform !== 'linux') await deleteScene(dir, 1, 'A.html', trash)
    expect(read(dir).scenes).toEqual(['a.html'])
    expect(trashed).toEqual([])
  })

  it.skipIf(process.platform === 'linux')('marks the page by its name on disk, as the watcher reports it', async () => {
    const dir = project({ ...PROJECT, scenes: ['a.html', 'B.html'] })
    writeFileSync(join(dir, 'b.html'), 'b')
    trashed.length = 0
    await deleteScene(dir, 1, 'B.html', trash)
    expect(trashed).toHaveLength(1)
    expect(ownLanded(join(dir, 'b.html'))).toBe(true)
  })

  it('moves only a plain .html page: an entry naming notes.json, a folder or a link loses only the entry', async () => {
    const dir = project({ ...PROJECT, scenes: ['a.html', 'notes.json', 'img', 'link.html'] })
    writeFileSync(join(dir, 'notes.json'), '{}')
    mkdirSync(join(dir, 'img'))
    writeFileSync(join(dir, 'a.html'), 'a')
    symlinkSync(join(dir, 'img'), join(dir, 'link.html'), 'junction') // a file link needs admin on Windows
    trashed.length = 0
    for (const f of ['link.html', 'img', 'notes.json']) await deleteScene(dir, read(dir).scenes.indexOf(f), f, trash)
    expect(read(dir).scenes).toEqual(['a.html'])
    expect(trashed).toEqual([])
    expect(readdirSync(dir).sort()).toEqual(['a.html', 'img', 'link.html', 'notes.json', 'project.json'])
  })

  it('keeps a page still listed elsewhere or missing, and refuses one that links outside the Project', async () => {
    const dir = project({ ...PROJECT, scenes: ['a.html', 'b.html', 'a.html', 'gone.html'] })
    writeFileSync(join(dir, 'a.html'), 'a')
    trashed.length = 0
    await deleteScene(dir, 2, 'a.html', trash)
    await deleteScene(dir, 2, 'gone.html', trash)
    expect(read(dir).scenes).toEqual(['a.html', 'b.html'])
    expect(trashed).toEqual([])
    const out = temp('outside')
    writeFileSync(join(out, 'x.html'), 'x')
    symlinkSync(out, join(dir, 'link'), 'junction')
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ ...PROJECT, scenes: ['a.html', 'link/x.html'] }))
    await expect(deleteScene(dir, 1, 'link/x.html', trash)).rejects.toThrow('outside the Project')
    expect(read(dir).scenes).toEqual(['a.html', 'link/x.html'])
    expect(trashed).toEqual([])
  })
})
