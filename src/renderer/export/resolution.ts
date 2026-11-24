import { scaleSize, type Size } from '../viewer/project'

// Each Export resolution names the short side of the video.
const SHORT_SIDES = [['720p', 720], ['1080p', 1080], ['1440p', 1440], ['4K', 2160]] as const

export type ExportResolution = Size & { label: string; scale: number; unsupported?: string }

export const DEFAULT_RESOLUTION = '1080p'

/** Every Export resolution for this Design size and fps; `unsupported` says unsupported this machine cannot encode one. */
export function exportResolutions(size: Size, fps: number, canEncode: (w: number, h: number, fps: number) => Promise<boolean>) {
  return Promise.all(
    SHORT_SIDES.map(async ([label, side]): Promise<ExportResolution> => {
      const scale = side / Math.min(size.w, size.h)
      const { w, h } = scaleSize(size, scale)
      const ok = await canEncode(w, h, fps).catch(() => false)
      return { label, scale, w, h, unsupported: ok ? undefined : 'not on this machine' }
    }),
  )
}
