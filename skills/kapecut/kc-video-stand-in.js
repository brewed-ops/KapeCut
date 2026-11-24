// For the still and final checks only, in a plain browser where KapeCut's /kc-video.js does not load:
// await page.addInitScript({ path: '<this skill folder>/kc-video-stand-in.js' })
// Same shape as kcVideo in KapeCut, built on <video> seeking. Good for a still; KapeCut's own decoder draws the Export.
window.kcVideo = (src) => {
  const v = Object.assign(document.createElement('video'), { muted: true, preload: 'auto', src })
  let queue = Promise.resolve() // one seek at a time, or a second call would take the first one's seeked
  const video = {
    ready: new Promise((ok, fail) => {
      v.onloadeddata = ok
      v.onerror = () => fail(new Error('kcVideo stand-in: cannot load ' + src))
    }).then(() => void Object.assign(video, { duration: v.duration, width: v.videoWidth, height: v.videoHeight })),
    frameAt: (t) =>
      (queue = queue.then(
        () =>
          new Promise((ok) => {
            v.onseeked = () => ok(v)
            v.currentTime = Math.min(Math.max(0, t), v.duration)
          }),
      )),
  }
  return video
}
