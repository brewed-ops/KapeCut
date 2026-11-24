# 0001 The Scene page contract

A Scene is an HTML page with `<canvas id="c">` (even width and height), `window.renderAt(t)` (may be async, draws the Frame at `t` seconds), `window.TOTAL` (seconds), `window.ready` (a promise: fonts and assets loaded), optional `window.EVENTS` (`{name, t}` beats), and the `?t=` (show one Frame) / `?scale=` (resolution) query params. Frame `f` is drawn at `t = f / fps`.

The contract is small on purpose: every pixel is a function of `t`, so the viewer, a still and Export draw the same Frame, and nothing we plan needs a shape it cannot carry. Changing it later breaks every Scene anyone has written, so it is fixed now.

One rule the contract implies for an async `renderAt`: it resolves in the same task that draws the Frame (await anything you like before drawing, nothing after). Export and the Scene list thumbnail read the canvas as soon as `renderAt` resolves; a WebGL canvas without `preserveDrawingBuffer: true` is cleared once the page composites, so a Scene that draws and then waits on a timer, a fetch or a decode exports blank Frames.

How a Scene reads `?scale=k` (decided with #4, Export resolution): the page sizes canvas#c `2 * Math.round(w * k / 2)` by `2 * Math.round(h * k / 2)` for its Design size `w` x `h` (even sides, as H.264 needs) and draws at that size, usually by `ctx.scale(k, k)` and drawing in Design size coordinates. Export opens every Scene again at `?scale=` in a hidden page and refuses a canvas of any other size, so a Scene that ignores the scale never exports upscaled or blurred. The viewer opens Scenes with no `?scale=` (k = 1).
