import { describe, expect, it } from 'vitest'
import { createAudio, peaks, wavePath } from './audio'

// An AudioContext stand-in that records what each source was asked to do. Its clock is set by hand.
function fakeContext() {
  const sources: { buffer: unknown; started?: [number, number]; stopped: boolean; volume: number }[] = []
  const gain = () => ({ gain: { value: 1 }, connect: (n: unknown) => n, disconnect() {} })
  const ctx = {
    currentTime: 10,
    state: 'running',
    destination: {},
    createGain: gain,
    createBufferSource() {
      const s = { buffer: null as unknown, started: undefined as [number, number] | undefined, stopped: false, volume: 1 }
      sources.push(s)
      return {
        set buffer(b: unknown) {
          s.buffer = b
        },
        connect: (g: { gain: { value: number } }) => ((s.volume = g.gain.value), g),
        disconnect() {},
        start: (when: number, offset: number) => void (s.started = [when, offset]),
        stop: () => void (s.stopped = true),
      }
    },
  }
  return { ctx, sources }
}

const lane = (start: number, duration: number, volume = 1) => ({ file: 'a.wav', start, volume, buffer: { duration } as AudioBuffer })

describe('createAudio', () => {
  it('starts each Audio file at its place in Project time: mid-file, later, or not at all once it has ended', () => {
    const { ctx, sources } = fakeContext()
    const audio = createAudio(ctx as unknown as AudioContext)
    audio.setLanes([lane(1, 3), lane(5, 2, 0.5), lane(0, 1)])
    audio.play(2)
    expect(sources.map((s) => s.started)).toEqual([
      [10, 1], // 1 s into the file, now
      [13, 0], // from its start, 3 s from now
    ])
    expect(sources.map((s) => s.volume)).toEqual([1, 0.5])
  })

  it('stop stops every source; play again starts fresh ones at the new time (a seek)', () => {
    const { ctx, sources } = fakeContext()
    const audio = createAudio(ctx as unknown as AudioContext)
    audio.setLanes([lane(0, 5)])
    audio.play(1)
    audio.stop()
    expect(sources[0].stopped).toBe(true)
    audio.play(3)
    expect(sources[1].started).toEqual([10, 3])
    audio.play(4) // playing again without a stop never leaves the old source sounding
    expect(sources[1].stopped).toBe(true)
  })

  it('skips a lane with no buffer (a bad file) and plays the others', () => {
    const { ctx, sources } = fakeContext()
    const audio = createAudio(ctx as unknown as AudioContext)
    audio.setLanes([{ file: 'bad.wav', start: 0, volume: 1, error: 'not found' }, lane(0, 5)])
    audio.play(0)
    expect(sources).toHaveLength(1)
  })

  it('starts that much further into each file as the output lags, so what is heard matches the Frame on screen', () => {
    const { ctx, sources } = fakeContext()
    Object.assign(ctx, { outputLatency: 0.04 })
    const audio = createAudio(ctx as unknown as AudioContext)
    audio.setLanes([lane(0, 5), lane(3, 1)])
    audio.play(1)
    expect(sources[0].started![1]).toBeCloseTo(1.04)
    expect(sources[1].started![0]).toBeCloseTo(11.96)
  })

  it('mute silences the editor and unmute brings it back', () => {
    const { ctx } = fakeContext()
    const audio = createAudio(ctx as unknown as AudioContext)
    audio.mute(true)
    expect(audio.master.gain.value).toBe(0)
    audio.mute(false)
    expect(audio.master.gain.value).toBe(1)
  })
})

describe('peaks', () => {
  it('keeps the loudest sample of each bucket', () => {
    expect(peaks([new Float32Array([0.125, -0.5, 0.25, 0.375, 0, -1, 0.25])], 3)).toEqual([0.5, 0.375, 1])
  })

  it('takes the loudest channel, so a file silent on one side still shows', () => {
    expect(peaks([new Float32Array([0, 0]), new Float32Array([0.5, -0.25])], 2)).toEqual([0.5, 0.25])
  })

  it('never makes more buckets than samples', () => {
    expect(peaks([new Float32Array([0.5])], 4)).toEqual([0.5])
  })
})

describe('wavePath', () => {
  it('outlines the peaks above and below the middle line, one unit per bucket', () => {
    expect(wavePath([0.5, 1])).toBe('M0 0L0 -0.5L1 -0.5L1 -1L2 -1L2 1L1 1L1 0.5L0 0.5Z')
  })
})
