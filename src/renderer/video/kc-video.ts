import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny'

/** What kcVideo(src) gives a Scene (ADR 0007). */
export type Video = {
  ready: Promise<void>
  duration: number
  width: number
  height: number
  /** The video Frame showing at t seconds, for drawImage. KapeCut closes it on the next frameAt or when the page goes. */
  frameAt(t: number): Promise<VideoFrame>
  close(): void
}

const NUDGE = 1e-4 // t = f / fps can land a hair before the Frame stamped at that time
const JUMP = 3 // seconds: further ahead than this, start again from a keyframe rather than decode every Frame between

/** Opens a video file by URL; Frames come out exactly at any t, in any order, one decode pass per forward run. */
export function openVideo(url: string): Video {
  const name = decodeURIComponent(new URL(url).pathname)
  let input: Input | undefined
  let sink: VideoSampleSink
  let run: AsyncGenerator<VideoSample, void> | undefined
  let cur: VideoSample | undefined // the last Frame starting at or before the last t
  let next: VideoSample | undefined // the Frame after it, already decoded
  let out: VideoFrame | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let closed = false

  const stop = () => {
    void run?.return()
    cur?.close()
    next?.close()
    run = cur = next = undefined
  }
  const pull = async () => (await run!.next()).value || undefined

  const video: Video = {
    duration: 0,
    width: 0,
    height: 0,
    ready: load(),
    frameAt: (t) => {
      // One at a time: a fast scrub must not walk the shared decoder from two calls at once.
      const frame = queue.then(async () => {
        await video.ready
        if (closed) throw new Error('kcVideo: the video was closed')
        const at = Math.max(0, t) + NUDGE
        if (!cur || at < cur.timestamp || at > cur.timestamp + JUMP) {
          stop()
          run = sink.samples(at)
          cur = await pull()
          next = await pull()
        }
        while (next && next.timestamp <= at) {
          cur!.close()
          ;[cur, next] = [next, await pull()]
        }
        if (!cur) throw new Error(`kcVideo: ${name} has no Frame at ${t}s`)
        out?.close()
        return (out = cur.toVideoFrame())
      })
      queue = frame.catch(() => {})
      return frame
    },
    close: () => {
      closed = true
      void queue.then(() => (stop(), out?.close(), input?.dispose()))
    },
  }
  return video

  // shortcut: reads the whole file into memory; fine for files of tens of MB, stream by range for long footage.
  async function load() {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`kcVideo: ${name} answered ${res.status}`)
    input = new Input({ source: new BlobSource(await res.blob()), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(`kcVideo: ${name} has no video track`)
    if (!(await track.canDecode())) throw new Error(`kcVideo: cannot decode ${name} (${track.codec})`)
    sink = new VideoSampleSink(track)
    Object.assign(video, { duration: await track.computeDuration(), width: track.displayWidth, height: track.displayHeight })
  }
}
