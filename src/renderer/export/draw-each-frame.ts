import { frameCount } from '../viewer/project-time'

export type Scene = { total: number; renderAt: (t: number) => unknown }

type Options<S extends Scene> = {
  /** In Project time order. */
  scenes: S[]
  fps: number
  /** Encodes what scene's canvas shows now as the Frame at Project time t lasting d seconds. */
  add: (scene: S, t: number, d: number) => Promise<unknown>
  signal: AbortSignal
  onProgress: (done: number) => void
}

/**
 * Draws every Frame of every Scene in order and hands each to the encoder as one video. Frame f of a Scene is Scene
 * time f / fps; whole-video Frame n is Project time n / fps, as in the viewer.
 * The canvas is captured right after renderAt resolves, with no task in between, so a WebGL canvas without
 * preserveDrawingBuffer still holds the Frame, as long as renderAt resolves in the task that drew (ADR 0001).
 */
export async function drawEachFrame<S extends Scene>({ scenes, fps, add, signal, onProgress }: Options<S>) {
  const frames = scenes.reduce((n, s) => n + frameCount(s.total, fps), 0)
  if (!(frames >= 1)) throw new Error('Video has no length: set window.TOTAL to each Scene\'s duration in seconds')
  let videoFrame = 0
  for (const scene of scenes) {
    for (let f = 0; f < frameCount(scene.total, fps); f++, videoFrame++) {
      signal.throwIfAborted()
      await scene.renderAt(f / fps)
      await add(scene, videoFrame / fps, 1 / fps)
      onProgress((videoFrame + 1) / frames)
    }
  }
}
