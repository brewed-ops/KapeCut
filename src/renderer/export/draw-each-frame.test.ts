import { expect, it } from 'vitest'
import { drawEachFrame } from './draw-each-frame'

// Scenes that log each draw as "<name> draw <Scene time>"; add logs "add <name> <video time> <duration>".
function recorder(lengths: Record<string, number>) {
  const log: string[] = []
  const scenes = Object.entries(lengths).map(([name, total]) => ({ name, total, renderAt: async (t: number) => void log.push(`${name} draw ${t}`) }))
  return { log, scenes, add: async (s: { name: string }, t: number, d: number) => void log.push(`add ${s.name} ${t} ${d}`) }
}
const run = (r: ReturnType<typeof recorder>, onProgress: (p: number) => void = () => {}, signal = new AbortController().signal) =>
  drawEachFrame({ scenes: r.scenes, fps: 30, add: r.add, signal, onProgress })

it('draws then encodes every Frame at its exact Scene time, TOTAL x fps of them', async () => {
  const r = recorder({ a: 0.1 })
  const progress: number[] = []
  await run(r, (p) => progress.push(p))
  expect(r.log).toEqual(['a draw 0', 'add a 0 0.03333333333333333', 'a draw 0.03333333333333333', 'add a 0.03333333333333333 0.03333333333333333', 'a draw 0.06666666666666667', 'add a 0.06666666666666667 0.03333333333333333'])
  expect(progress).toEqual([1 / 3, 2 / 3, 1])
})

it('joins Scenes in order into one video: each Scene from its Scene time 0, video time running on across the cut', async () => {
  const r = recorder({ a: 0.05, b: 0.1 }) // 2 Frames, then 3
  const progress: number[] = []
  await run(r, (p) => progress.push(p))
  expect(r.log).toEqual([
    'a draw 0', 'add a 0 0.03333333333333333',
    'a draw 0.03333333333333333', 'add a 0.03333333333333333 0.03333333333333333',
    'b draw 0', 'add b 0.06666666666666667 0.03333333333333333',
    'b draw 0.03333333333333333', 'add b 0.1 0.03333333333333333',
    'b draw 0.06666666666666667', 'add b 0.13333333333333333 0.03333333333333333',
  ])
  expect(progress).toEqual([0.2, 0.4, 0.6, 0.8, 1]) // over the whole video, not per Scene
})

it('gives a fractional length the same Frame count as the viewer: 1.01 s at 30 fps is Frames 0..30', async () => {
  const r = recorder({ a: 1.01 })
  await run(r)
  expect(r.log.filter((l) => l.includes('draw')).length).toBe(31)
})

it('skips a Scene of length 0, as the viewer does', async () => {
  const r = recorder({ a: 0, b: 0.05 })
  await run(r)
  expect(r.log.filter((l) => l.startsWith('add'))).toEqual(['add b 0 0.03333333333333333', 'add b 0.03333333333333333 0.03333333333333333'])
})

it('stops before the next Frame once cancelled, in any Scene', async () => {
  const r = recorder({ a: 0.1, b: 1 })
  const ctl = new AbortController()
  await expect(run(r, () => r.log.filter((l) => l.startsWith('add b')).length === 2 && ctl.abort(), ctl.signal)).rejects.toThrow()
  expect(r.log.filter((l) => l.startsWith('add'))).toHaveLength(5)
})

it('refuses a video with no length', async () => {
  await expect(run(recorder({ a: 0, b: 0 }))).rejects.toThrow(/window.TOTAL/)
})
