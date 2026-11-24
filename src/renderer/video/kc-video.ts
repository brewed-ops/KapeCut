import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny'

/** What kcVideo(src) gives a Scene (ADR 0007). */
export type Video = {
  ready: Promise<void>
  duration: number
  width: number
  height: number
  /** A canvas holding the Video file's picture at t seconds, upright. KapeCut redraws it on the next frameAt. */
  frameAt(t: number): Promise<HTMLCanvasElement>
  close(): void
}

const NUDGE = 1e-4 // t = f / fps can land a hair before the picture stamped at that time
const JUMP = 3 // seconds: further ahead than this, start again from a keyframe rather than decode every picture between

/** Opens a Project's Video file by URL; pictures come out exactly at any t, in any order, one decode pass per forward run. */
export function openVideo(url: string): Video {
  let input: Input | undefined
  let sink: VideoSampleSink
  const pic = document.createElement('canvas') // the one picture this Video file hands out, so no frame is left to close
  let run: AsyncGenerator<VideoSample, void> | undefined
  let from = 0 // the run's first picture, then cur's time once it walked: any t from here on is reached by walking forward
  let cur: VideoSample | undefined // the last picture starting at or before the last t
  let next: VideoSample | undefined // the picture after it, already decoded
  let queue: Promise<unknown> = Promise.resolve()
  type Job = { t: number; frame?: Promise<HTMLCanvasElement> }
  let waiting: Job | undefined
  let closed = false

  const stop = () => {
    run?.return().catch(() => {})
    cur?.close()
    next?.close()
    run = cur = next = undefined
  }
  const pull = async () => (await run!.next()).value || undefined

  async function draw(t: number) {
    await video.ready
    if (closed) throw new Error('kcVideo: the video was closed')
    const at = Math.max(0, t) + NUDGE
    try {
      if (!cur || at < from || (next && at > next.timestamp + JUMP)) {
        stop()
        run = sink.samples(at)
        cur = await pull()
        next = await pull()
        from = Math.min(at, cur?.timestamp ?? at)
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
    cur.drawWithFit(pic.getContext('2d')!, { fit: 'fill' }) // applies the file's rotation, as width and height do
    return pic
  }

  const video: Video = {
    duration: 0,
    width: 0,
    height: 0,
    ready: load(),
    frameAt: (t) => {
      // Playback asks every display refresh without waiting: calls not yet started merge into the newest t, so slow
      // decoding never piles up. Export awaits each Frame, so its calls never merge.
      if (waiting) return (waiting.t = t), waiting.frame!
      const job: Job = (waiting = { t })
      // One at a time: two calls must not walk the shared decoder at once.
      job.frame = queue.then(() => ((waiting = undefined), draw(job.t)))
      queue = job.frame.catch(() => {})
      return job.frame
    },
    close: () => {
      closed = true
      // After ready too: a page that goes while load() runs still frees what load() opens.
      void queue
        .then(() => video.ready)
        .catch(() => {})
        .then(() => (stop(), input?.dispose(), (pic.width = pic.height = 0)))
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
    const [width, height] = [await track.getDisplayWidth(), await track.getDisplayHeight()]
    Object.assign(pic, { width, height })
    Object.assign(video, { duration: await track.computeDuration(), width, height })
  }
}
