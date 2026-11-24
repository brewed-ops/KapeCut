import { expect, type Locator, type Page } from '@playwright/test'

/** The on-screen box of the element `at` finds. A relayout replaces elements (Audio lane blocks, Scene and Files rows):
 * one measured as it goes has no box, so it is found and measured again (#130). */
export async function boxOf(at: Locator) {
  let b: Awaited<ReturnType<Locator['boundingBox']>> = null
  await expect.poll(async () => (b = await at.boundingBox())).not.toBeNull()
  return b!
}

/** The boxes of the first element each selector finds, read in one go: two reads could straddle a relayout and mix an
 * old layout with a new one (#130). */
export async function boxesOf(page: Page, ...selectors: string[]) {
  let boxes: DOMRect[] | null = null
  const read = (list: string[]) => {
    const els = list.map((s) => document.querySelector(s))
    return els.every(Boolean) ? els.map((el) => el!.getBoundingClientRect().toJSON() as DOMRect) : null
  }
  await expect.poll(async () => (boxes = await page.evaluate(read, selectors))).not.toBeNull()
  return boxes!
}
