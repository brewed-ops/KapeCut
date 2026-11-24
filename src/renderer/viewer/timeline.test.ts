import { describe, expect, it } from 'vitest'
import { follow, rubberband, rulerTicks, unrubberband, zoomAt, zoomed } from './timeline'

describe('rulerTicks', () => {
  it('labels whole seconds when a second is wide enough', () => {
    expect(rulerTicks(3, 100)).toEqual([
      { t: 0, label: '0s' },
      { t: 1, label: '1s' },
      { t: 2, label: '2s' },
      { t: 3, label: '3s' },
    ])
  })

  it('spaces ticks further apart when zoomed out', () => {
    expect(rulerTicks(30, 10).map((k) => k.label)).toEqual(['0s', '10s', '20s', '30s'])
  })

  it('labels tenths when zoomed in', () => {
    expect(rulerTicks(0.5, 1000).map((k) => k.label)).toEqual(['0s', '0.1s', '0.2s', '0.3s', '0.4s', '0.5s'])
  })

  it('writes minutes past one minute', () => {
    expect(rulerTicks(150, 2).map((k) => k.label)).toEqual(['0s', '1:00', '2:00'])
  })

  it('keeps tenths past one minute', () => {
    const labels = rulerTicks(120, 1000).map((k) => k.label)
    expect(labels.slice(600, 603)).toEqual(['1:00', '1:00.1', '1:00.2'])
    expect(labels.at(-6)).toBe('1:59.5')
  })
})

describe('zoomed', () => {
  it('zooms in from fit by the factor', () => expect(zoomed(null, 2, 100, 1000)).toBe(200))
  it('stops at the maximum', () => expect(zoomed(800, 2, 100, 1000)).toBe(1000))
  it('returns to fit (null) when zooming out past it', () => expect(zoomed(150, 0.5, 100, 1000)).toBeNull())
})

describe('follow', () => {
  it('keeps the scroll while the playhead is in view', () => expect(follow(300, 0, 500)).toBe(0))
  it('pages forward when the playhead nears the right edge', () => expect(follow(490, 0, 500)).toBe(440))
  it('pages back when the playhead is left of the view', () => expect(follow(100, 400, 500)).toBe(50))
})

describe('zoomAt', () => {
  // View 500 px wide, 14 px pad, scrolled 200 px at 100 px/s: the pointer 300 px into the view is over 4.86 s.
  it('keeps the time under the pointer at the pointer when zooming in', () => expect(zoomAt(300, 200, 100, 200, 14)).toBeCloseTo(686, 6))
  it('and when zooming out', () => expect(zoomAt(300, 200, 100, 50, 14)).toBeCloseTo(-43, 6))
  it('keeps the start under the pointer at the pointer', () => expect(zoomAt(14, 0, 100, 400, 14)).toBe(0))
})

describe('rubberband', () => {
  it('follows about half the drag just past the bound', () => expect(rubberband(1, 14)).toBeCloseTo(0.53, 2))
  it('follows less the further it goes, and never reaches the limit', () => {
    expect(rubberband(20, 14)).toBeCloseTo(6.16, 2)
    expect(rubberband(100, 14)).toBeCloseTo(11.16, 2)
    expect(rubberband(1e6, 14)).toBeLessThan(14)
  })
  it('works the same way before the start', () => expect(rubberband(-20, 14)).toBeCloseTo(-6.16, 2))
  it('is 0 at the bound', () => expect(rubberband(0, 14)).toBe(0))
  it('unrubberband finds the drag that shows that far', () => {
    expect(unrubberband(rubberband(-20, 14), 14)).toBeCloseTo(-20, 6)
    expect(unrubberband(6.16, 14)).toBeCloseTo(20, 1)
  })
})
