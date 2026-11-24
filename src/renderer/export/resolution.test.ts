import { describe, expect, it } from 'vitest'
import { exportResolutions } from './resolution'
import { scaleSize } from '../viewer/project'

const all = async () => true

describe('exportResolutions', () => {
  it('lists 720p, 1080p, 1440p and 4K as the short side of a 9:16 Project', async () => {
    const list = await exportResolutions({ w: 1080, h: 1920 }, 30, all)
    expect(list.map(({ label, w, h, unsupported }) => ({ label, w, h, unsupported }))).toEqual([
      { label: '720p', w: 720, h: 1280, unsupported: undefined },
      { label: '1080p', w: 1080, h: 1920, unsupported: undefined },
      { label: '1440p', w: 1440, h: 2560, unsupported: undefined },
      { label: '4K', w: 2160, h: 3840, unsupported: undefined },
    ])
  })

  it('keeps the aspect ratio of a landscape Project and scales its short side', async () => {
    const list = await exportResolutions({ w: 320, h: 240 }, 30, all)
    expect(list.map(({ w, h, scale }) => [w, h, scale])).toEqual([[960, 720, 3], [1440, 1080, 4.5], [1920, 1440, 6], [2880, 2160, 9]])
  })

  it('asks the encoder at each output size and fps, and gives a short reason for the ones it cannot do', async () => {
    const asked: string[] = []
    const list = await exportResolutions({ w: 1080, h: 1920 }, 60, async (w, h, fps) => (asked.push(`${w}x${h}@${fps}`), w < 2000))
    expect(asked).toEqual(['720x1280@60', '1080x1920@60', '1440x2560@60', '2160x3840@60'])
    expect(list.map((r) => r.unsupported)).toEqual([undefined, undefined, undefined, 'not on this machine'])
  })

  it('treats an encoder check that throws as unsupported', async () => {
    const list = await exportResolutions({ w: 1080, h: 1920 }, 30, async (w) => {
      if (w > 2000) throw new TypeError('bad config')
      return true
    })
    expect(list[3].unsupported).toBe('not on this machine')
  })
})

describe('scaleSize', () => {
  it('rounds each side to an even number, as H.264 needs, so an odd Design ratio still exports', () => {
    expect(scaleSize({ w: 750, h: 1334 }, 1080 / 750)).toEqual({ w: 1080, h: 1920 }) // 1920.96
    expect(scaleSize({ w: 1170, h: 2532 }, 720 / 1170)).toEqual({ w: 720, h: 1558 }) // 1558.15
    expect(scaleSize({ w: 1080, h: 1920 }, 1)).toEqual({ w: 1080, h: 1920 })
  })
})
