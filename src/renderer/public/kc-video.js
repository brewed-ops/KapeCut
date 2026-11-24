// A Scene loads this with <script src="/kc-video.js"> to draw a video file from its Project (ADR 0007).
// kcVideo(src) -> { ready, duration, width, height, frameAt(t) }; the decoding runs in the KapeCut page around the Scene.
window.kcVideo = (src) => {
  const video = top.kapecutVideo(new URL(src, location.href).href)
  addEventListener('pagehide', () => video.close())
  return video
}
