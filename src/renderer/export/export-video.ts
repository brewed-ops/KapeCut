import { canEncodeVideo as canEncode, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, VideoSample, VideoSampleSource } from 'mediabunny'
import { drawEachFrame, type Scene } from './draw-each-frame'

/** Can this machine encode H.264 at the Project's real size and fps? Checked before the user picks a file. */
export const canEncodeVideo = (width: number, height: number, fps: number) =>
  canEncode('avc', { width, height, frameRate: fps, quality: QUALITY_HIGH })

type Sink = { write(data: Uint8Array, position: number): Promise<void> }
type OpenScene = Scene & { canvas: CanvasImageSource }

/** Encodes every Frame of every open Scene, in order, to one H.264 stream in MP4 (ADR 0002) and streams the bytes to sink. */
export async function exportVideo(opts: {
  scenes: OpenScene[]
  fps: number
  sink: Sink
  signal: AbortSignal
  onProgress: (done: number) => void
}) {
  const target = new StreamTarget(new WritableStream({ write: (c) => opts.sink.write(c.data, c.position) }), { chunked: true })
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const video = new VideoSampleSource({ codec: 'avc', quality: QUALITY_HIGH })
  output.addVideoTrack(video, { frameRate: opts.fps })
  await output.start()
  try {
    await drawEachFrame({
      ...opts,
      // The canvas lives in the Scene's iframe; mediabunny's CanvasSource rejects other-realm canvases, VideoFrame does not.
      add: async (scene, t, d) => {
        const frame = new VideoFrame(scene.canvas, { timestamp: 0 })
        try {
          await video.add(new VideoSample(frame, { timestamp: t, duration: d }))
        } finally {
          frame.close()
        }
      },
    })
    await output.finalize()
  } catch (err) {
    await output.cancel()
    throw err
  }
}
