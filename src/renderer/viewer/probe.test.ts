import { expect, it } from 'vitest'
import { probeH264 } from './probe'

it('reports hardware and software H.264 support separately', async () => {
  const seen: VideoEncoderConfig[] = []
  const result = await probeH264(async (config) => {
    seen.push(config)
    return { supported: config.hardwareAcceleration === 'prefer-software' }
  })
  expect(result).toEqual({ hardware: false, software: true })
  expect(seen.map((c) => [c.codec.slice(0, 5), c.width, c.height])).toEqual([
    ['avc1.', 1080, 1920],
    ['avc1.', 1080, 1920],
  ])
})

it('treats a throwing probe as unsupported', async () => {
  const result = await probeH264(async () => {
    throw new Error('no WebCodecs')
  })
  expect(result).toEqual({ hardware: false, software: false })
})
