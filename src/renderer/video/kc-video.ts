import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny'

/** What kcVideo(src) gives a Scene (ADR 0007). */
export type Video = {
  ready: Promise<void>
  duration: number
  width: number
  height: number
  /** The Video file's picture showing at t seconds, for drawImage. KapeCut closes it on the next frameAt or when the page goes. */
  frameAt(t: number): Promise<VideoFrame>
  close(): void
}

const NUDGE = 1e-4 // t = f / fps can land a hair before the picture stamped at that time
const JUMP = 3 // seconds: further ahead than this, start again from a keyframe rather than decode every picture between

/** Opens a Project's Video file by URL; pictures come out exactly at any t, in any order, one decode pass per forward run. */
export function openVideo(url: string): Video {
  let input: Input | undefined
  let sink: VideoSampleSink
  let run: AsyncGenerator<VideoSample, void> | undefined
  let from = 0 // the run's start, then cur's time once it walked: any t from here on is reached by walking forward
  let cur: VideoSample | undefined // the last picture starting at or before the last t
  let next: VideoSample | undefined // the picture after it, already decoded
  let out: VideoFrame | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let closed = false

  const stop = () => {
    run?.return().catch(() => {})
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
        try {
          if (!cur || at < from || (next && at > next.timestamp + JUMP)) {
            stop()
            run = sink.samples((from = at))
            cur = await pull()
            next = await pull()
          }
          while (next && next.timestamp <= at) {
            cur!.close()
            from = next.timestamp
            ;[cur, next] = [next, await pull()]
          }
        } catch (e) {
          stop() // a failed decode leaves no closed picture behind for the next call
          throw e
        }
        if (!cur) throw new Error(`kcVideo: ${url} has no picture at ${t}s`)
        out?.close()
        return (out = cur.toVideoFrame())
      })
      queue = frame.catch(() => {})
      return frame
    },
    close: () => {
      closed = true
      // After ready too: a page that goes while load() runs still frees what load() opens.
      void queue
        .then(() => video.ready)
        .catch(() => {})
        .then(() => (stop(), out?.close(), input?.dispose()))
    },
  }
  return video

  // shortcut: reads the whole file into memory; fine for files of tens of MB, stream by range for long Video files.
  async function load() {
    const { protocol, host, pathname } = new URL(url)
    // The fetch goes through serve(), whose fileUnder keeps it in the Project folder; this keeps it a Project file.
    if (protocol !== 'kapecut:' || host !== 'app' || !pathname.startsWith('/project/'))
      throw new Error(`kcVideo: ${url} is not a file in the Project folder`)
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`kcVideo: ${pathname} answered ${res.status}`)
    input = new Input({ source: new BlobSource(await res.blob()), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(`kcVideo: ${pathname} has no video track`)
    if (!(await track.canDecode())) throw new Error(`kcVideo: cannot decode ${pathname} (${track.codec})`)
    sink = new VideoSampleSink(track)
    Object.assign(video, { duration: await track.computeDuration(), width: track.displayWidth, height: track.displayHeight })
  }
}
