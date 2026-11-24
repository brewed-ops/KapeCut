import { frameAt, frameCount } from './project-time'

type Options = {
  fps: number
  total: number
  /** Draws the Frame at time t (the viewer passes Project time). Also the place to refresh labels: it runs on every change. */
  draw: (t: number) => unknown
  /** Playback started at time t (the Audio follows it). */
  onPlay?: (t: number) => void
  /** Playback stopped: pause, step, scrub, the last Frame or a reload. */
  onStop?: () => void
  now?: () => number
  raf?: (cb: () => void) => unknown
}

/** Play / pause, scrub and Frame step over `total` seconds (the viewer's whole Project). Frame f is at f / fps. */
export function createTransport({ fps, total, draw, onPlay, onStop, now = () => performance.now(), raf = requestAnimationFrame }: Options) {
  let time = 0
  let run = 0 // bumped on every play / pause so a stale animation frame stops itself
  let reloading = false // the Scene page is being replaced; drawing into it now would hit a half-loaded page
  const lastFrame = () => Math.max(0, frameCount(total, fps) - 1)
  const end = () => lastFrame() / fps

  const tr = {
    playing: false,
    get time() {
      return time
    },
    get frame() {
      return frameAt(time, fps)
    },
    get end() {
      return end()
    },
    seek(t: number) {
      if (reloading) return
      time = Math.min(Math.max(t, 0), end())
      draw(time)
    },
    step(dir: 1 | -1) {
      tr.pause()
      tr.seek(Math.min(Math.max(tr.frame + dir, 0), lastFrame()) / fps)
    },
    pause() {
      if (tr.playing) onStop?.()
      tr.playing = false
      run++
    },
    play() {
      if (reloading) return
      if (time >= end()) time = 0
      const me = ++run
      const from = time
      const start = now()
      tr.playing = true
      onPlay?.(from)
      const tick = () => {
        if (me !== run) return
        const t = from + (now() - start) / 1000
        if (t >= end()) tr.pause()
        tr.seek(t)
        if (tr.playing) raf(tick)
      }
      raf(tick)
    },
    toggle() {
      tr.playing ? tr.pause() : tr.play()
    },
    /** Re-opens at the current time (open draws it), then clamps to the new length. */
    async reload(open: (t: number) => Promise<{ total: number }>) {
      tr.pause()
      reloading = true
      try {
        total = (await open(time)).total
      } finally {
        reloading = false
      }
      tr.seek(time)
    },
  }
  return tr
}
