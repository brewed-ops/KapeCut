import { stat } from 'node:fs/promises'
import { fileUnder } from './file-under'

/** An Audio file of the Project (file as project.json names it), resolved to its path on disk. */
export type AudioInput = { file: string; path: string; start: number; volume: number }

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * The Project's Audio files (project.json's `audio`, as the page sends it) as ffmpeg inputs. Throws naming the first
 * file that is missing. start and volume go into an ffmpeg filter string, so anything but a plain number is refused.
 */
export async function audioInputs(dir: string, list: unknown): Promise<AudioInput[]> {
  if (!Array.isArray(list)) throw new Error('Audio must be a list')
  const inputs: AudioInput[] = []
  for (const a of list) {
    const { file, start, volume } = a ?? {}
    if (typeof file !== 'string') throw new Error('Audio must list {file, start, volume}')
    if (!isNumber(start) || start < 0 || !isNumber(volume) || volume < 0 || volume > 1) throw new Error(`Audio file ${file} has a bad start or volume`)
    // The same containment rule that serves it to the editor: encode each part so fileUnder's decode gives the name back.
    const path = fileUnder(dir, '/' + file.split('/').map(encodeURIComponent).join('/'))
    if (!path) throw new Error(`Audio file ${file} must be inside the Project folder`)
    const found = await stat(path).catch(() => null)
    if (!found?.isFile()) throw new Error(`Audio file ${file} is missing from the Project`)
    inputs.push({ file, path, start, volume })
  }
  return inputs
}

/**
 * ffmpeg args that copy the encoded H.264 into out (faststart, BT.709 tags) and, when there is audio, mix every file at
 * its start and volume into one AAC track cut to the video's length. No audio: video only.
 */
export function remuxArgs(encoded: string, audio: AudioInput[], out: string) {
  // h264_metadata writes BT.709 into the stream itself, the -color_* flags into the container.
  const video = ['-c:v', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
  const tail = ['-movflags', '+faststart', '-f', 'mp4', out]
  const head = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'mp4', '-i', encoded]
  if (!audio.length) return [...head, ...video, ...tail]
  // Every input to 48 kHz stereo so amix takes them. pan copies mono (FC) to both sides at full level, as the editor's
  // WebAudio does; ffmpeg's own upmix would play it 3 dB quieter. Surrounds fold in at 0.707, as WebAudio's do.
  // shortcut: a 5.1 file's centre also goes in at full level (WebAudio: 0.707, 3 dB softer), since pan cannot tell
  // mono's FC from 5.1's, and channels other than FL FR FC SL SR BL BR (BC, FLC, FRC, LFE) are dropped; probe channel
  // layouts if Projects start using surround files.
  // normalize=0 keeps each file at its own volume, not 1/n. apad + -shortest: silence after the last sound, cut where
  // the video ends. adelay takes at most 2^31-1 ms; a start that late is past any video anyway.
  const lanes = audio.map(
    (a, i) =>
      `[${i + 1}:a]pan=stereo|FL=FL+FC+0.707*SL+0.707*BL|FR=FR+FC+0.707*SR+0.707*BR,aresample=48000,volume=${a.volume},` +
      `adelay=${Math.min(Math.round(a.start * 1000), 2 ** 31 - 1)}:all=1[a${i}]`,
  )
  const mix = `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0,apad[mix]`
  return [...head, ...audio.flatMap((a) => ['-i', a.path]), '-filter_complex', [...lanes, mix].join(';'),
    '-map', '0:v', '-map', '[mix]', ...video, '-c:a', 'aac', '-b:a', '192k', '-shortest', ...tail]
}
