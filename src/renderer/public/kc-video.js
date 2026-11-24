// A Scene loads this with <script src="/kc-video.js"> to draw a Video file from its Project (ADR 0007).
// kcVideo(src) -> { ready, duration, width, height, frameAt(t) }. The decoding is openVideo in src/renderer/video/kc-video.ts,
// which src/renderer/main.ts puts on the KapeCut page around the Scene as window.kapecutVideo.
window.kcVideo = (src) => {
  if (typeof top.kapecutVideo !== 'function') throw new Error('kcVideo works only in a Scene that KapeCut opened')
  const video = top.kapecutVideo(new URL(src, location.href).href)
  addEventListener('pagehide', () => video.close())
  return video
}
