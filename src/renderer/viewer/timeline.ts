const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const MIN_GAP = 80 // px between ruler labels
const EDGE = 50 // px the playhead keeps from the view's edge while following

function label(t: number) {
  t = Math.round(t * 10) / 10 // ticks are at most tenths apart; this also drops i * step float noise
  if (t < 60) return `${t}s`
  const s = +(t % 60).toFixed(1)
  return `${Math.floor(t / 60)}:${s < 10 ? '0' : ''}${s}`
}

/** Ruler ticks from 0 to `duration` s at `pps` px per second: the smallest step at least MIN_GAP px apart. */
export function rulerTicks(duration: number, pps: number) {
  const step = STEPS.find((s) => s * pps >= MIN_GAP) ?? STEPS.at(-1)!
  const n = Math.floor(duration / step + 1e-6)
  return Array.from({ length: n + 1 }, (_, i) => ({ t: i * step, label: label(i * step) }))
}

/** px per second after zooming by `k`. null means fit to the view, which is also the most zoomed out. */
export function zoomed(pps: number | null, k: number, fit: number, max: number) {
  const next = Math.min((pps ?? fit) * k, max)
  return next <= fit ? null : next
}

/** The scroll that keeps playhead x in view: unchanged while it is, else paged so x sits EDGE px from the left. */
export const follow = (x: number, left: number, width: number) => (x < left || x > left + width - EDGE ? Math.max(0, x - EDGE) : left)

/** The scroll that keeps the time under the pointer at view x (px from the view's left, scrolled `left`) at x when px per second goes from `from` to `to`. */
export const zoomAt = (x: number, left: number, from: number, to: number, pad: number) => ((left + x - pad) / from) * to + pad - x

/** How far something dragged `over` px past a bound shows past it: less the further it goes, never `limit` (apple-design 9). */
export const rubberband = (over: number, limit: number) => (over * limit * 0.55) / (limit + 0.55 * Math.abs(over))

/** The drag past the bound that shows `shown` px past it (rubberband's inverse), so a press can catch a block mid-spring. */
export const unrubberband = (shown: number, limit: number) => (shown * limit) / (0.55 * (limit - Math.abs(shown)))
