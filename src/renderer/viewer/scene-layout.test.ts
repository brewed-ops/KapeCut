import { describe, expect, it } from 'vitest'
import { BROKEN_LENGTH, sceneLayout } from './scene-layout'

describe('sceneLayout', () => {
  it('a broken Scene that never opened holds BROKEN_LENGTH, so the Scenes after it keep a place', () => {
    const layout = sceneLayout([{ file: 'a.html', total: 1 }, { file: 'b.html', error: 'boom' }, { file: 'c.html', total: 2 }], 30)
    expect(layout.rows()).toEqual([
      { file: 'a.html', start: 0, end: 1, len: 1, error: undefined },
      { file: 'b.html', start: 1, end: 1 + BROKEN_LENGTH, len: BROKEN_LENGTH, error: 'boom' },
      { file: 'c.html', start: 1 + BROKEN_LENGTH, end: 3 + BROKEN_LENGTH, len: 2, error: undefined },
    ])
    expect(layout.duration).toBe(3 + BROKEN_LENGTH)
  })

  it('a Scene that opened and then broke keeps its last good length', () => {
    const layout = sceneLayout([{ file: 'a.html', total: 2.5, error: 'boom' }, { file: 'b.html', total: 1 }], 30)
    expect(layout.rows().map((r) => [r.start, r.end, r.len])).toEqual([[0, 2.5, 2.5], [2.5, 3.5, 1]])
  })

  it('never changes once built, even when a Scene it was given changes later', () => {
    const b: { file: string; total?: number; error?: string } = { file: 'b.html' }
    const layout = sceneLayout([{ file: 'a.html', total: 1 }, b], 30)
    Object.assign(b, { total: 1, error: 'boom' })
    expect(layout.rows()[1]).toMatchObject({ len: 0, error: undefined })
    expect(layout.settled).toBe(false)
  })

  it('a loading Scene has no Frames, and scenesIn skips it', () => {
    const layout = sceneLayout([{ file: 'a.html', total: 1 }, { file: 'b.html' }, { file: 'c.html', total: 1 }], 30)
    expect(layout.rows()[1]).toMatchObject({ start: 1, end: 1, len: 0 })
    expect(layout.frames).toBe(60)
    expect(layout.settled).toBe(false)
    expect(layout.scenesIn({ start: 0.5, end: 1.5 })).toEqual(['a.html', 'c.html'])
    expect(layout.scenesIn({ start: 0.2, end: 0.5 })).toEqual(['a.html'])
  })

  describe('flag', () => {
    const opened = (...files: string[]) => files.map((file) => ({ file, total: 1 }))

    it('a Note whose Scene is gone', () => {
      expect(sceneLayout(opened('a.html'), 30).flag({ scene: 'x.html', sceneTime: 0 })).toBe('Scene not in the Project')
    })

    it('a span whose crossed Scenes are no longer neighbours', () => {
      const span = { scene: 'a.html', scenes: ['a.html', 'b.html'], sceneTime: 0.5 }
      expect(sceneLayout(opened('b.html', 'a.html'), 30).flag(span, { start: 1.5, end: 2 })).toBe('Scenes around this span changed')
      expect(sceneLayout(opened('a.html', 'b.html'), 30).flag(span, { start: 0.5, end: 1.5 })).toBe('')
    })

    it('past its Scene end, only once that Scene opened', () => {
      const late = { scene: 'a.html', sceneTime: 1.2 }
      expect(sceneLayout(opened('a.html', 'b.html'), 30).flag(late)).toBe('past its Scene end')
      expect(sceneLayout([{ file: 'a.html', total: 1 }], 30).flag({ scene: 'a.html', sceneTime: 29 / 30 })).toBe('')
      expect(sceneLayout([{ file: 'a.html' }, { file: 'b.html', total: 1 }], 30).flag(late)).toBe('') // loading
      expect(sceneLayout([{ file: 'a.html', error: 'boom' }], 30).flag(late)).toBe('') // never opened
      expect(sceneLayout([{ file: 'a.html', total: 1, error: 'boom' }], 30).flag(late)).toBe('') // broke after opening
    })

    it('a span past the Project end, only once every Scene opened or failed', () => {
      const span = { scene: 'a.html', scenes: ['a.html', 'b.html'], sceneTime: 0.5 }
      const far = { start: 0.5, end: 2.5 }
      expect(sceneLayout(opened('a.html', 'b.html'), 30).flag(span, far)).toBe('past the Project end')
      expect(sceneLayout(opened('a.html', 'b.html'), 30).flag(span, { start: 0.5, end: 2 })).toBe('')
      expect(sceneLayout([{ file: 'a.html', total: 1 }, { file: 'b.html', error: 'boom' }], 30).flag(span, far)).toBe('past the Project end')
      expect(sceneLayout([{ file: 'a.html', total: 1 }, { file: 'b.html' }], 30).flag(span, far)).toBe('') // b still loading
    })
  })

  it('a span on a Scene listed twice stays on the copy its scenes follow; other Notes take the first copy', () => {
    const layout = sceneLayout([{ file: 'a.html', total: 1 }, { file: 'b.html', total: 1 }, { file: 'a.html', total: 1 }, { file: 'c.html', total: 1 }], 30)
    expect(layout.noteTime({ scene: 'a.html', scenes: ['a.html', 'c.html'], sceneTime: 0.2 })).toBeCloseTo(2.2)
    expect(layout.noteTime({ scene: 'a.html', sceneTime: 0.2 })).toBeCloseTo(0.2)
    expect(layout.noteTime({ scene: 'x.html', sceneTime: 0.2 })).toBeNaN()
  })

  it('locates a Project time in a Scene by file', () => {
    const layout = sceneLayout([{ file: 'a.html', total: 1 }, { file: 'b.html', total: 1 }], 30)
    expect(layout.locate(1.5)).toEqual({ scene: 1, file: 'b.html', sceneTime: 0.5 })
    expect(layout.frameAt(1.5)).toBe(45)
    expect([layout.sceneStart(1), layout.sceneEnd(1)]).toEqual([1, 2])
  })
})
