import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectTime } from './project-time'

it('is the only place that turns seconds into Frames, so Export and the viewer count alike', () => {
  const src = join(__dirname, '../..')
  const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.ts$/.test(f) && !/\.(test|e2e)\.ts$/.test(f) && !f.endsWith('project-time.ts'))
    .filter((f) => /\*\s*fps\b|\bfps\s*\*/.test(readFileSync(join(src, f), 'utf8')))
  expect(offenders, 'use frameCount / frameAt from viewer/project-time.ts').toEqual([])
})

describe('projectTime', () => {
  it('starts each Scene where the previous one ends', () => {
    const pt = projectTime([1, 2, 0.5], 30)
    expect([0, 1, 2].map(pt.sceneStart)).toEqual([0, 1, 3])
    expect([0, 1, 2].map(pt.sceneEnd)).toEqual([1, 3, 3.5])
    expect(pt.frames).toBe(105)
    expect(pt.duration).toBe(3.5)
  })

  it('names the Scene and Scene time at a Project time, across both cuts', () => {
    const pt = projectTime([1, 2, 0.5], 30)
    expect(pt.locate(0)).toEqual({ scene: 0, sceneTime: 0 })
    expect(pt.locate(29 / 30)).toEqual({ scene: 0, sceneTime: 29 / 30 }) // last Frame of Scene 0
    expect(pt.locate(1)).toEqual({ scene: 1, sceneTime: 0 }) // first Frame of Scene 1
    expect(pt.locate(2.5).scene).toBe(1)
    expect(pt.locate(2.5).sceneTime).toBeCloseTo(1.5)
    expect(pt.locate(3)).toEqual({ scene: 2, sceneTime: 0 })
  })

  it('clamps past the end to the last Frame of the last Scene', () => {
    const pt = projectTime([1, 0.5], 30)
    expect(pt.lastFrame).toBe(44)
    expect(pt.locate(9).scene).toBe(1)
    expect(pt.locate(9).sceneTime).toBeCloseTo(14 / 30)
    expect(pt.locate(-1)).toEqual({ scene: 0, sceneTime: 0 })
  })

  it('gives a fractional Scene length a whole number of Frames, so the next Scene starts on a Frame', () => {
    // 1.01 s at 30 fps has Frames 0..30 (the last at 1.0 s), so Scene 1 starts at Frame 31.
    const pt = projectTime([1.01, 1], 30)
    expect(pt.sceneStart(1)).toBe(31 / 30)
    expect(pt.locate(1).scene).toBe(0)
    expect(pt.locate(31 / 30)).toEqual({ scene: 1, sceneTime: 0 })
    // a length an exact Frame count apart, despite float error (0.1 * 3 = 0.30000000000000004)
    expect(projectTime([0.1 * 3], 30).frames).toBe(9)
  })

  it('never gives the next Scene a negative Scene time just below a cut', () => {
    const pt = projectTime([0.5, 0.5], 30)
    const t = 0.49999999999999994 // float noise from a scrub or a playback tick, one ulp below the cut
    expect(pt.locate(t)).toEqual({ scene: 1, sceneTime: 0 })
  })

  it('skips a zero-length Scene', () => {
    const pt = projectTime([1, 0, 1], 30)
    expect(pt.locate(1)).toEqual({ scene: 2, sceneTime: 0 })
    expect(pt.frames).toBe(60)
    expect(projectTime([0], 30).locate(0)).toEqual({ scene: 0, sceneTime: 0 })
  })

  it('round-trips every whole-video Frame number through Project time', () => {
    const pt = projectTime([1.01, 0.7, 2], 60)
    for (let f = 0; f <= pt.lastFrame; f++) expect(pt.frameAt(pt.timeOf(f))).toBe(f)
    expect(pt.frameAt(0.5 + 1 / 120)).toBe(30) // mid-Frame times belong to the Frame they follow
  })
})
