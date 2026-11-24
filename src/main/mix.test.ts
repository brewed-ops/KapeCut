import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { audioInputs, remuxArgs, type AudioInput } from './mix'

// Real ffmpeg, as Export runs it. CI installs it before Vitest; a machine without it skips these, CI never does.
const skip = !process.env.CI && !!spawnSync('ffmpeg', ['-version'], { windowsHide: true }).error
// The timeout turns a mix that never ends (no -shortest after apad) into a failure, not a hung run.
const ff = (args: string[]) => execFileSync('ffmpeg', args, { windowsHide: true, stdio: 'pipe', timeout: 20_000 })
const codecs = (file: string) =>
  (JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })).streams as { codec_name: string }[]).map(
    (s) => s.codec_name,
  )
const duration = (file: string, stream: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }))
// Loudest sample in dBFS between from and to seconds of file's audio; -Infinity for digital silence.
function peak(file: string, from: number, to: number) {
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a', '-af', `atrim=${from}:${to},volumedetect`, '-f', 'null', '-'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const db = /max_volume: (\S+) dB/.exec(stderr)?.[1]
  if (!db) throw new Error(`no volumedetect output: ${stderr.slice(-300)}`)
  return db === '-inf' ? -Infinity : Number(db)
}

let dir: string
let video: string // 3 s of H.264 at 30 fps, no audio: what the renderer hands main
const mixInto = (name: string, audio: Omit<AudioInput, 'path'>[]) => {
  const out = join(dir, name)
  ff(remuxArgs(video, audio.map((a): AudioInput => ({ path: join(dir, a.file), ...a })), out))
  return out
}
beforeAll(() => {
  if (skip) return
  dir = mkdtempSync(join(tmpdir(), 'kapecut-mix-'))
  video = join(dir, 'encoded.mp4')
  ff(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  // lavfi's sine peaks at 1/8 of full scale: -18 dBFS.
  ff(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5', join(dir, 'tone.wav')])
  ff(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=10:sample_rate=22050', join(dir, 'long.wav')])
  ff(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5,pan=stereo|c0=c0|c1=c0', join(dir, 'stereo.wav')])
  // 5.1 with sound only in the back left channel.
  ff(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5,pan=5.1|c4=c0', join(dir, 'surround.wav')])
}, 30_000)
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }))

describe.skipIf(skip)('remuxArgs', () => {
  it('with no audio writes video only, as before', () => {
    const out = join(dir, 'silent.mp4')
    ff(remuxArgs(video, [], out))
    expect(codecs(out)).toEqual(['h264'])
  })

  it('places a file at its start and volume in one AAC track as long as the video', () => {
    const out = mixInto('one.mp4', [{ file: 'tone.wav', start: 1, volume: 0.5 }])
    expect(codecs(out)).toEqual(['h264', 'aac'])
    expect(duration(out, 'a:0')).toBeCloseTo(duration(out, 'v:0'), 1)
    expect(peak(out, 0, 0.9)).toBeLessThan(-60) // silent before its start
    expect(peak(out, 1.05, 1.45)).toBeCloseTo(-18 - 6, 0) // volume 0.5 = -6 dB
    expect(peak(out, 1.6, 3)).toBeLessThan(-60) // and after it ends
  }, 30_000)

  it('mixes several files, mono or stereo, each at its own volume', () => {
    const out = mixInto('three.mp4', [
      { file: 'tone.wav', start: 0, volume: 1 },
      { file: 'stereo.wav', start: 1, volume: 1 },
      { file: 'tone.wav', start: 2, volume: 0.25 },
    ])
    expect(codecs(out)).toEqual(['h264', 'aac'])
    expect(peak(out, 0.05, 0.45)).toBeCloseTo(-18, 0) // mono at full level, as the editor plays it
    expect(peak(out, 1.05, 1.45)).toBeCloseTo(-18, 0)
    expect(peak(out, 2.05, 2.45)).toBeCloseTo(-18 - 12, 0)
  }, 30_000)

  it('folds a surround channel into its side at 0.707 (-3 dB), as WebAudio does', () => {
    const out = mixInto('surround.mp4', [{ file: 'surround.wav', start: 0, volume: 1 }])
    const left = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'atrim=0.05:0.45,pan=mono|c0=c0,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
    expect(Number(/max_volume: (\S+) dB/.exec(left)?.[1])).toBeCloseTo(-18 - 3, 0)
    expect(peak(out, 0.05, 0.45)).toBeCloseTo(-21, 0) // and nothing louder on the right
  }, 30_000)

  it('cuts a file that outlasts the video at the video end', () => {
    const out = mixInto('long.mp4', [{ file: 'long.wav', start: 0, volume: 1 }])
    expect(duration(out, 'a:0')).toBeCloseTo(3, 1)
  }, 30_000)

  it('gives a silent track as long as the video when the only file starts after the video ends', () => {
    for (const start of [5, 1e18]) {
      const out = mixInto('late.mp4', [{ file: 'tone.wav', start, volume: 1 }])
      expect(duration(out, 'a:0')).toBeCloseTo(3, 1)
      expect(peak(out, 0, 3)).toBeLessThan(-60)
    }
  }, 30_000)
})

describe.skipIf(skip)('audioInputs', () => {
  it('resolves each file inside the Project folder', async () => {
    expect(await audioInputs(dir, [{ file: 'tone.wav', start: 0.5, volume: 0.6 }])).toEqual([{ file: 'tone.wav', path: join(dir, 'tone.wav'), start: 0.5, volume: 0.6 }])
  })

  it('stops at a missing file and names it', async () => {
    await expect(audioInputs(dir, [{ file: 'tone.wav', start: 0, volume: 1 }, { file: 'gone.wav', start: 1, volume: 1 }])).rejects.toThrow(
      'Audio file gone.wav is missing from the Project',
    )
  })

  it('refuses a file outside the Project folder', async () => {
    for (const file of ['../tone.wav', '.', 'a\\..\\..\\tone.wav'])
      await expect(audioInputs(dir, [{ file, start: 0, volume: 1 }])).rejects.toThrow('must be inside the Project folder')
  })

  it('refuses anything but numbers for start and volume, which go into the filter string', async () => {
    for (const bad of [{ start: '0,amovie=x', volume: 1 }, { start: 0, volume: '1[x]' }, { start: -1, volume: 1 }, { start: 0, volume: 2 }, { start: NaN, volume: 1 }])
      await expect(audioInputs(dir, [{ file: 'tone.wav', ...bad }])).rejects.toThrow('bad start or volume')
    await expect(audioInputs(dir, 'tone.wav')).rejects.toThrow()
    await expect(audioInputs(dir, [{ start: 0, volume: 1 }])).rejects.toThrow('Audio must list {file, start, volume}')
  })
})
