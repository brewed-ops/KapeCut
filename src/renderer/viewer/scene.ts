import { scaleSize, type Size } from './project'

/** The parts of a Scene page's window we use (ADR 0001). */
export type SceneWindow = {
  document: { getElementById(id: string): { width: number; height: number } | null; fonts?: { ready: Promise<unknown> } }
  ready?: Promise<unknown>
  TOTAL?: number
  renderAt?: (t: number) => unknown
}

const TIMEOUT_MS = 15_000

/** Waits for the Scene, checks its canvas against the Design size at the page's ?scale=, draws Scene time t. Gives up after 15 s. */
export async function openScene(win: SceneWindow, size: Size, t = 0, scale = 1): Promise<{ total: number }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, fail) => {
    timer = setTimeout(
      () => fail(new Error(`Scene never became ready or never finished drawing (waited ${TIMEOUT_MS / 1000}s)`)),
      TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([show(win, size, t, scale), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function show(win: SceneWindow, size: Size, t: number, scale: number) {
  // A Scene without window.ready still gets its fonts loaded before the first Frame.
  await (win.ready ?? win.document.fonts?.ready)
  // Checked after ready: a Scene may define renderAt during its own setup.
  if (typeof win.renderAt !== 'function') throw new Error('Scene has no window.renderAt(t)')
  const c = win.document.getElementById('c')
  if (!c) throw new Error('Scene has no <canvas id="c">')
  const want = scaleSize(size, scale)
  if (c.width !== want.w || c.height !== want.h)
    throw new Error(
      scale === 1
        ? `Scene canvas is ${c.width}x${c.height}, Project Design size is ${size.w}x${size.h}`
        : `Scene canvas is ${c.width}x${c.height}, ?scale=${+scale.toFixed(3)} needs ${want.w}x${want.h}: ` +
            `width 2 * Math.round(${size.w} * scale / 2), height 2 * Math.round(${size.h} * scale / 2)`,
    )
  const total = win.TOTAL
  // The Scene's length places every later Scene in Project time, so it is never guessed.
  if (typeof total !== 'number' || !(total >= 0) || total === Infinity) throw new Error('Scene has no window.TOTAL length in seconds')
  await win.renderAt(Math.min(t, total)) // the Scene may have got shorter since the viewer was at t
  return { total }
}
