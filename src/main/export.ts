import { app, BrowserWindow, dialog } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, open, rename, rm, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { handle } from './app-sender'
import { audioInputs, remuxArgs, type AudioInput } from './mix'
import { markLanded, ownLanded } from './owned-writes'

type Job = { target: string; scratch: string; file: FileHandle; dir: string; audio: AudioInput[]; ffmpeg?: ChildProcess }

// One Export at a time. The encoded MP4 streams into a fresh scratch folder beside <target>, ffmpeg remuxes it there
// and mixes in the Audio files, and only a finished remux is renamed over <target>, so cancelling never touches a file
// the user already had.
let job: Job | null = null
const part = (j: Job) => join(j.scratch, 'encoded.mp4')
const remuxed = (j: Job) => join(j.scratch, 'remuxed.mp4')

// A second call while one runs waits for it: "cancelled" must mean the scratch folder is already gone.
let discarding: Promise<void> = Promise.resolve()
function discard() {
  if (!job) return discarding
  const { scratch, file, ffmpeg } = job
  job = null
  ffmpeg?.kill()
  return (discarding = (async () => {
    await file.close().catch(() => {})
    // ffmpeg may not have exited yet on Windows; retry so its half-written output still goes.
    await rm(scratch, { recursive: true, force: true, maxRetries: 5 })
  })())
}

async function remux(current: Job) {
  // Checked again here: a file deleted while Frames encoded stops the Export with its name, not an ffmpeg error.
  const audio = await audioInputs(current.dir, current.audio)
  if (job !== current) throw new Error('Export cancelled')
  // No shell: paths come from the user and must not be parsed by cmd.exe.
  const ffmpeg = (current.ffmpeg = spawn('ffmpeg', remuxArgs(part(current), audio, remuxed(current)), { windowsHide: true }))
  let err = ''
  ffmpeg.stderr.on('data', (d) => (err += d))
  return new Promise<void>((done, fail) => {
    ffmpeg.on('error', (e) => fail(new Error(`Could not run ffmpeg: ${e.message}`)))
    ffmpeg.on('close', (code) => {
      if (code === 0) return done()
      // ffmpeg names the input it could not open; longest path first, so x.wav never takes the blame for x.wav.old.
      const bad = [...audio].sort((a, b) => b.path.length - a.path.length).find((a) => err.includes(a.path))
      fail(new Error(`${bad ? `Audio file ${bad.file} could not be read. ` : ''}ffmpeg failed (${code}): ${err.trim().slice(-300)}`))
    })
  })
}

// amix's normalize option (ffmpeg 4.4) is the newest feature the mix uses; an older ffmpeg would fail with an option error.
const canMix = () =>
  new Promise<boolean>((done) =>
    execFile('ffmpeg', ['-hide_banner', '-h', 'filter=amix'], { windowsHide: true, timeout: 5000 }, (err, out) => done(!err && /\bnormalize\b/.test(out))),
  )

/** Whether an Export is writing: quitting now would throw it away. */
export const exporting = () => job !== null

export function handleExport(projectDir: () => string | null) {
  // The Audio files as ffmpeg inputs. Throws naming a missing file, or when this ffmpeg cannot mix.
  async function checkAudio(audio: unknown) {
    const dir = projectDir()
    if (!dir) throw new Error('No Project open')
    const inputs = await audioInputs(dir, audio)
    if (inputs.length && !(await canMix())) throw new Error('This ffmpeg is too old to mix Audio files. Install ffmpeg 4.4 or newer')
    return { dir, inputs }
  }
  // Before the Scenes open at another size, which can take a while, so a missing file is reported first.
  handle('export:check', (_e, audio: unknown) => checkAudio(audio).then(() => {}))
  app.on('before-quit', discard) // best effort: don't leave scratch files behind when the app closes mid-Export
  handle('export:begin', async (e, defaultName: string, audio: unknown) => {
    await discard()
    const { dir, inputs } = await checkAudio(audio) // again: the file may have gone while the Scenes opened
    const win = BrowserWindow.fromWebContents(e.sender)!
    const pick = await dialog.showSaveDialog(win, { defaultPath: basename(defaultName), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (pick.canceled || !pick.filePath) return null
    const target = pick.filePath
    // Beside the target so the final rename stays on one drive.
    const scratch = await mkdtemp(join(dirname(target), '.kapecut-export-'))
    try {
      job = { target, scratch, file: await open(join(scratch, 'encoded.mp4'), 'w'), dir, audio: inputs }
    } catch (err) {
      await rm(scratch, { recursive: true, force: true })
      throw err
    }
    return target
  })
  handle('export:write', async (_e, data: Uint8Array, position: number) => {
    if (!job) throw new Error('No Export in progress')
    await job.file.write(data, 0, data.byteLength, position)
  })
  handle('export:finish', async () => {
    if (!job) throw new Error('No Export in progress')
    const current = job
    try {
      await current.file.close()
      await remux(current)
      if (job !== current) throw new Error('Export cancelled')
      job = null // past the point of no return: a late cancel must not undo a replaced target
    } catch (err) {
      if (job === current) await discard() // cancelled meanwhile: discard already ran
      throw err
    }
    try {
      markLanded(current.target) // before the rename: the watcher may report it first
      await rename(remuxed(current), current.target).catch((err) => (ownLanded(current.target), Promise.reject(err)))
    } finally {
      await rm(current.scratch, { recursive: true, force: true })
    }
  })
  handle('export:abort', discard)
}
