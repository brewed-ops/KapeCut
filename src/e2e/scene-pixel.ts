import type { Page } from '@playwright/test'

/** Top-left pixel of the Scene page on screen, or null while none is shown or a reload swaps the page under the probe. */
export const scenePixel = (page: Page) =>
  page
    .evaluate(() => {
      const c = document.querySelector<HTMLIFrameElement>('iframe.current')?.contentDocument?.querySelector('canvas')
      return c ? Array.from(c.getContext('2d')!.getImageData(0, 0, 1, 1).data.slice(0, 3)) : null
    })
    .catch((e: Error) => {
      if (/Execution context was destroyed/.test(e.message)) return null
      throw e
    })

/** [width, height, r, g, b] of a Note picture at Design pixel (x, y), read through the app's own file server. */
export const pngPixel = (page: Page, file: string, x: number, y: number) =>
  page.evaluate(
    async ({ file, x, y }) => {
      const img = new Image()
      img.src = `/project/${file}?v=${Date.now()}`
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight })
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      return [c.width, c.height, ...Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3))]
    },
    { file, x, y },
  )
