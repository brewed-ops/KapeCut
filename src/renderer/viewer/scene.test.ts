import { afterEach, describe, expect, it, vi } from 'vitest'
import { openScene, type SceneWindow } from './scene'

// A Scene window as ADR 0001 defines it: canvas#c, renderAt, ready, TOTAL.
function fakeScene(canvas: { width: number; height: number } | null) {
  const drawn: number[] = []
  let resolveReady!: () => void
  const win = {
    document: { getElementById: (id: string) => (id === 'c' ? canvas : null) },
    ready: new Promise<void>((r) => (resolveReady = r)),
    TOTAL: 3,
    renderAt: (t: number) => void drawn.push(t),
  }
  return { win, drawn, resolveReady }
}

const size = { w: 1080, h: 1920 }

afterEach(() => vi.useRealTimers())

describe('openScene', () => {
  it('draws the Frame at Scene time 0 only after ready resolves', async () => {
    const s = fakeScene({ width: 1080, height: 1920 })
    const opened = openScene(s.win, size)
    await Promise.resolve()
    expect(s.drawn).toEqual([])
    s.resolveReady()
    await expect(opened).resolves.toEqual({ total: 3 })
    expect(s.drawn).toEqual([0])
  })

  it('draws its first Frame at the Scene time it is opened at', async () => {
    const s = fakeScene({ width: 1080, height: 1920 })
    s.resolveReady()
    await openScene(s.win, size, 1.5)
    expect(s.drawn).toEqual([1.5])
  })

  it('never asks a Scene to draw past its own end', async () => {
    const s = fakeScene({ width: 1080, height: 1920 })
    s.resolveReady()
    await openScene(s.win, size, 4.5) // TOTAL is 3: the Scene got shorter since the viewer was at 4.5
    expect(s.drawn).toEqual([3])
  })

  it('refuses a canvas that does not match the Design size, without drawing', async () => {
    const s = fakeScene({ width: 1920, height: 1080 })
    s.resolveReady()
    await expect(openScene(s.win, size)).rejects.toThrow('Scene canvas is 1920x1080, Project Design size is 1080x1920')
    expect(s.drawn).toEqual([])
  })

  it('at ?scale= expects the Design size times the scale, and says how to size the canvas', async () => {
    const ok = fakeScene({ width: 720, height: 1280 })
    ok.resolveReady()
    await expect(openScene(ok.win, size, 0, 720 / 1080)).resolves.toEqual({ total: 3 })
    const ignores = fakeScene({ width: 1080, height: 1920 })
    ignores.resolveReady()
    await expect(openScene(ignores.win, size, 0, 720 / 1080)).rejects.toThrow(
      'Scene canvas is 1080x1920, ?scale=0.667 needs 720x1280: width 2 * Math.round(1080 * scale / 2), height 2 * Math.round(1920 * scale / 2)',
    )
    expect(ignores.drawn).toEqual([])
  })

  it('refuses a page with no canvas#c or renderAt', async () => {
    const s = fakeScene(null)
    s.resolveReady()
    await expect(openScene(s.win, size)).rejects.toThrow(/canvas id="c"/)
    const noRender = fakeScene({ width: 1080, height: 1920 })
    noRender.resolveReady()
    await expect(openScene({ ...noRender.win, renderAt: undefined }, size)).rejects.toThrow(/renderAt/)
  })

  it('refuses a Scene without a window.TOTAL length, without drawing', async () => {
    for (const TOTAL of [undefined, -1, NaN, '3' as unknown as number]) {
      const s = fakeScene({ width: 1080, height: 1920 })
      s.resolveReady()
      await expect(openScene({ ...s.win, TOTAL }, size), String(TOTAL)).rejects.toThrow(/window.TOTAL/)
      expect(s.drawn).toEqual([])
    }
  })

  it('accepts a Scene that defines renderAt during its ready setup', async () => {
    const s = fakeScene({ width: 1080, height: 1920 })
    const { renderAt } = s.win
    const win: SceneWindow = { ...s.win, renderAt: undefined }
    win.ready = s.win.ready.then(() => void (win.renderAt = renderAt))
    const opened = openScene(win, size)
    s.resolveReady()
    await opened
    expect(s.drawn).toEqual([0])
  })

  it('gives up with an error when ready never resolves', async () => {
    vi.useFakeTimers()
    const opened = openScene(fakeScene({ width: 1080, height: 1920 }).win, size)
    const check = expect(opened).rejects.toThrow(/never became ready/)
    await vi.advanceTimersByTimeAsync(15_000)
    await check
  })

  it('gives up with an error when renderAt(0) never finishes', async () => {
    vi.useFakeTimers()
    const s = fakeScene({ width: 1080, height: 1920 })
    s.resolveReady()
    const opened = openScene({ ...s.win, renderAt: () => new Promise(() => {}) }, size)
    const check = expect(opened).rejects.toThrow(/never became ready/)
    await vi.advanceTimersByTimeAsync(15_000)
    await check
  })

  it('waits for fonts when a Scene sets no window.ready', async () => {
    const s = fakeScene({ width: 1080, height: 1920 })
    let fontsLoaded!: () => void
    const fonts = { ready: new Promise<void>((r) => (fontsLoaded = r)) }
    const opened = openScene({ ...s.win, ready: undefined, document: { ...s.win.document, fonts } }, size)
    await new Promise((r) => setTimeout(r, 0))
    expect(s.drawn).toEqual([])
    fontsLoaded()
    await opened
    expect(s.drawn).toEqual([0])
  })
})
