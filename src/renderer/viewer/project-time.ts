const EPS = 1e-6 // f / fps * fps is not always exactly f in floating point

/** Frames in `len` seconds: Frame f is at f / fps, so a fractional length rounds up. The one rule Export and the viewer share. */
export const frameCount = (len: number, fps: number) => Math.max(0, Math.ceil(len * fps - EPS))
/** The Frame showing at time t. */
export const frameAt = (t: number, fps: number) => Math.floor(t * fps + EPS)

/**
 * Lays Scenes of the given lengths (seconds) end to end in Project time.
 * Each Scene gets a whole number of Frames (Frame f of a Scene is at f / fps), so every Scene starts on a Frame
 * and whole-video Frame f is at Project time f / fps, the same as in the Export.
 */
export function projectTime(lengths: number[], fps: number) {
  const counts = lengths.map((len) => frameCount(len, fps))
  const starts = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + b, 0))
  const frames = counts.reduce((a, b) => a + b, 0)
  const lastFrame = Math.max(0, frames - 1)
  return {
    frames,
    lastFrame,
    duration: frames / fps,
    sceneStart: (i: number) => starts[i] / fps,
    sceneEnd: (i: number) => (starts[i] + counts[i]) / fps,
    frameAt: (t: number) => frameAt(t, fps),
    timeOf: (f: number) => f / fps,
    /** The Scene showing at Project time t, and the Scene time in it. t is clamped to the video. */
    locate(t: number) {
      const at = Math.min(Math.max(t, 0), lastFrame / fps)
      const f = frameAt(at, fps)
      const found = counts.findIndex((n, i) => n > 0 && f < starts[i] + n)
      const scene = Math.max(0, found) // no Frames at all: Scene 0
      // frameAt's EPS can pick the next Scene a hair before its start; its Scene time is then 0, never negative.
      return { scene, sceneTime: Math.max(0, at - starts[scene] / fps) }
    },
  }
}

export type ProjectTime = ReturnType<typeof projectTime>

/**
 * The Project time of Scene time `sceneTime` in Scene `i` of `pt`, so a Note follows its Scene when Scenes are
 * re-ordered. NaN when the Scene is gone (i < 0) or has no Frames yet (loading), so no other Scene's Frame gets it.
 * Past the Scene's end, it is the Scene's last Frame, never the next Scene's first.
 */
export function timeIn(i: number, sceneTime: number, pt: ProjectTime) {
  const [start, end] = i < 0 ? [] : [pt.sceneStart(i), pt.sceneEnd(i)]
  if (start === undefined || end! <= start) return NaN
  return Math.min(start + sceneTime, end! - pt.timeOf(1))
}
