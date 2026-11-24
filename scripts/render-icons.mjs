// Renders the window / taskbar icons from the mark SVG with Playwright's Chromium (docs/design/logo.md): one PNG per
// size, and kapecut.ico holding 16-256 so Windows shows the hand-checked small sizes instead of shrinking the 256.
// Usage: node scripts/render-icons.mjs   (needs `npx playwright install chromium` once). Commit what it writes.
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../resources/logo/', import.meta.url))
const svg = readFileSync(`${dir}kapecut-mark.svg`, 'utf8')
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512] // 20 and 40: the small and big icon at 125% scaling
const pngs = new Map()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const px of sizes) {
    await page.setViewportSize({ width: px, height: px })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`)
    pngs.set(px, await page.screenshot({ path: `${dir}kapecut-${px}.png`, omitBackground: true }))
    console.log(`${dir}kapecut-${px}.png`)
  }
} finally {
  await browser.close()
}

// ICO with PNG entries (Windows Vista and later): 6-byte header, a 16-byte entry per image, then the PNGs. 256 is the
// format's largest size and is written as 0.
const inIco = sizes.filter((px) => px <= 256)
const head = Buffer.alloc(6 + 16 * inIco.length)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(inIco.length, 4)
let offset = head.length
inIco.forEach((px, i) => {
  const at = 6 + 16 * i
  head.writeUInt8(px % 256, at)
  head.writeUInt8(px % 256, at + 1)
  head.writeUInt16LE(1, at + 4) // planes
  head.writeUInt16LE(32, at + 6) // bits per pixel
  head.writeUInt32LE(pngs.get(px).length, at + 8)
  head.writeUInt32LE(offset, at + 12)
  offset += pngs.get(px).length
})
writeFileSync(`${dir}kapecut.ico`, Buffer.concat([head, ...inIco.map((px) => pngs.get(px))]))
console.log(`${dir}kapecut.ico`)
