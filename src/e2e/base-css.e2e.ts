import { expect, test } from '@playwright/test'
import { launch } from './launch'

// #95: [hidden] hides whatever display an ID rule gives the element (#89's Re-check stayed visible).
test('a hidden element stays hidden under an ID rule that sets display', async () => {
  const { app, page } = await launch({ waitForExport: false })
  try {
    await expect(page.getByRole('heading', { name: 'KapeCut', exact: true })).toBeVisible() // app.css is in
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '#base-hidden-probe { display: flex; }'
      const el = Object.assign(document.createElement('div'), { id: 'base-hidden-probe', hidden: true, textContent: 'probe' })
      document.body.append(style, el)
    })
    await expect(page.locator('#base-hidden-probe')).toBeHidden()
    await page.evaluate(() => document.getElementById('base-hidden-probe')?.removeAttribute('hidden'))
    await expect(page.locator('#base-hidden-probe')).toBeVisible() // the probe can show, so the hide above is [hidden]'s
  } finally {
    await app.close()
  }
})
