import type { Audio } from './project'

/** An Audio file of the open Project: decoded (buffer) or failed (error), never both. */
export type Lane = Audio & { buffer?: AudioBuffer; error?: string }

/** Plays the Audio files in step with the transport: play(t) schedules every file against Project time t, stop() silences. */
export function createAudio(ctx: AudioContext) {
  const master = ctx.createGain()
  master.connect(ctx.destination)
  let lanes: Lane[] = []
  let sources: AudioBufferSourceNode[] = []

  const stop = () => {
    for (const s of sources) (s.stop(), s.disconnect())
    sources = []
  }
  return {
    master,
    context: ctx,
    /** New lanes take effect on the next play(). */
    setLanes(next: Lane[]) {
      lanes = next
    },
    // shortcut: video runs on performance.now and audio on the sound card's clock, aligned only at play(); they part by
    // a few ms a minute at most. Re-align during play if long Projects drift by ear.
    play(t: number) {
      stop()
      const now = ctx.currentTime
      const lag = ctx.outputLatency || 0 // a sample started now is heard this much later, when the video is further on
      for (const { buffer, start, volume } of lanes) {
        const into = t + lag - start // seconds into the file; negative: it starts later
        if (!buffer || into >= buffer.duration) continue
        const src = ctx.createBufferSource()
        const gain = ctx.createGain()
        src.buffer = buffer
        gain.gain.value = volume
        src.connect(gain).connect(master)
        src.start(now + Math.max(0, -into), Math.max(0, into))
        sources.push(src)
      }
    },
    stop,
    /** Silences the editor only: Export mixes project.json's list with ffmpeg, never through this player. */
    mute(on: boolean) {
      master.gain.value = on ? 0 : 1
    },
  }
}

/** Decodes each Audio file of the Project; a file that is missing or will not decode gets an error on its own lane. */
export const loadLanes = (ctx: BaseAudioContext, list: Audio[], url: (file: string) => string) =>
  Promise.all(
    list.map(async (a): Promise<Lane> => {
      try {
        const res = await fetch(url(a.file), { cache: 'no-store' })
        if (!res.ok) throw new Error(res.status === 404 ? 'not found in the Project' : 'could not be read')
        return { ...a, buffer: await ctx.decodeAudioData(await res.arrayBuffer()) }
      } catch (e) {
        return { ...a, error: `${a.file}: ${e instanceof DOMException ? 'not a sound file this app can play' : e instanceof Error ? e.message : e}` }
      }
    }),
  )

/** The loudest sample across all channels in each of n even buckets (fewer when there are fewer samples). */
export function peaks(channels: Float32Array[], n: number) {
  const len = channels[0]?.length ?? 0
  n = Math.min(n, len)
  return Array.from({ length: n }, (_, i) => {
    let max = 0
    for (const c of channels) for (let j = Math.floor((i * len) / n); j < Math.floor(((i + 1) * len) / n); j++) max = Math.max(max, Math.abs(c[j]))
    return max
  })
}

const num = (n: number) => +n.toFixed(3)
/** An SVG path of the peaks, mirrored about y 0, one unit wide per bucket: viewBox `0 -1 peaks.length 2`. */
export function wavePath(p: number[]) {
  const top = p.map((v, i) => `L${i} ${num(-v)}L${i + 1} ${num(-v)}`).join('')
  const bottom = p.map((v, i) => `L${i + 1} ${num(v)}L${i} ${num(v)}`).reverse().join('')
  return `M0 0${top}${bottom}Z`
}
