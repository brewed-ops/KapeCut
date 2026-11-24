import { describe, expect, it } from 'vitest'
import { createTransport } from './transport'

// A hand-driven clock: tick(ms) advances time and runs the queued animation frame.
function fakeClock() {
  let now = 0
  let queued: (() => void) | null = null
  return {
    now: () => now,
    raf: (cb: () => void) => void (queued = cb),
    tick(ms: number) {
      now += ms
      const cb = queued
      queued = null
      cb?.()
    },
  }
}

function setup(total = 3, fps = 30) {
  const drawn: number[] = []
  const clock = fakeClock()
  const tr = createTransport({ fps, total, draw: (t) => void drawn.push(t), now: clock.now, raf: clock.raf })
  return { tr, drawn, clock }
}

describe('transport', () => {
  it('steps exactly one Frame and draws Frame f at f / fps', () => {
    const { tr, drawn } = setup()
    tr.step(1)
    tr.step(1)
    tr.step(-1)
    expect(drawn).toEqual([1 / 30, 2 / 30, 1 / 30])
    expect(tr.frame).toBe(1)
    expect(tr.time).toBe(1 / 30)
  })

  it('never steps before Frame 0 or past the last Frame', () => {
    const { tr } = setup(1, 30)
    tr.step(-1)
    expect(tr.frame).toBe(0)
    tr.seek(1)
    tr.step(1)
    expect(tr.frame).toBe(29) // a 1 s Scene at 30 fps has Frames 0..29
  })

  it('scrubbing draws the chosen Scene time and reports its Frame', () => {
    const { tr, drawn } = setup()
    tr.seek(1.5)
    expect(drawn).toEqual([1.5])
    expect(tr.frame).toBe(45)
  })

  it('plays at real speed and stops on the last Frame', () => {
    const { tr, drawn, clock } = setup(1, 30)
    tr.toggle()
    expect(tr.playing).toBe(true)
    clock.tick(500)
    expect(drawn.at(-1)).toBeCloseTo(0.5)
    clock.tick(2000)
    expect(drawn.at(-1)).toBe(29 / 30)
    expect(tr.playing).toBe(false)
    clock.tick(16)
    expect(drawn.at(-1)).toBe(29 / 30)
  })

  it('pause holds the current Scene time', () => {
    const { tr, clock } = setup()
    tr.toggle()
    clock.tick(250)
    tr.toggle()
    clock.tick(1000)
    expect(tr.playing).toBe(false)
    expect(tr.time).toBeCloseTo(0.25)
  })

  it('play from the last Frame starts over at 0', () => {
    const { tr, drawn, clock } = setup(1, 30)
    tr.seek(1)
    tr.toggle()
    clock.tick(100)
    expect(drawn.at(-1)).toBeCloseTo(0.1)
  })

  it('reload keeps the current Scene time and redraws it in the new Scene', async () => {
    const { tr, drawn } = setup()
    tr.seek(1.5)
    let opened = -1
    await tr.reload(async (t) => ((opened = t), { total: 4 }))
    expect(opened).toBe(1.5)
    expect(drawn.at(-1)).toBe(1.5)
    expect(tr.time).toBe(1.5)
  })

  it('ignores play, scrub and step while a reload is in flight', async () => {
    const { tr, drawn, clock } = setup()
    tr.seek(1)
    let finish!: () => void
    const reloading = tr.reload(() => new Promise((r) => (finish = () => r({ total: 3 }))))
    tr.seek(2)
    tr.step(1)
    tr.toggle()
    clock.tick(100)
    expect(tr.playing).toBe(false)
    expect(drawn).toEqual([1])
    finish()
    await reloading
    expect(drawn).toEqual([1, 1])
  })

  it('stays usable after a reload fails', async () => {
    const { tr } = setup()
    await expect(tr.reload(() => Promise.reject(new Error('broken')))).rejects.toThrow('broken')
    tr.step(1)
    expect(tr.frame).toBe(1)
  })

  it('tells the audio when play starts (at which time) and when it stops, by pause, step, the end or a reload', async () => {
    const calls: (number | 'stop')[] = []
    const clock = fakeClock()
    const tr = createTransport({ fps: 30, total: 1, draw: () => {}, now: clock.now, raf: clock.raf, onPlay: (t) => calls.push(t), onStop: () => calls.push('stop') })
    tr.seek(0.5)
    tr.play()
    tr.pause()
    tr.pause() // already stopped: no second call
    tr.play()
    tr.step(1)
    tr.play()
    clock.tick(2000) // runs past the end
    tr.play()
    await tr.reload(async () => ({ total: 1 }))
    expect(calls).toEqual([0.5, 'stop', 0.5, 'stop', 16 / 30, 'stop', 0, 'stop'])
  })

  it('reload of a shorter Scene clamps to its new last Frame', async () => {
    const { tr } = setup(3, 30)
    tr.seek(2.5)
    await tr.reload(async () => ({ total: 1 }))
    expect(tr.time).toBe(29 / 30)
  })
})
