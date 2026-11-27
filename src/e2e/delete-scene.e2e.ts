import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch } from './launch'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sceneHtml = (color: string) => `<canvas id="c" width="200" height="200"></canvas><script>
  const g = document.getElementById('c').getContext('2d')
  window.TOTAL = 0.5
  window.renderAt = () => { g.fillStyle = '${color}'; g.fillRect(0, 0, 200, 200) }
</script>`
const T = '2026-11-27T10:00:00.000Z'
const note = (n: number, scene: string, extra: object = { point: { x: 100, y: 100 } }) => ({
  n, text: `Note on ${scene}`, done: false, scene, sceneTime: 0.1, time: 0.1, frame: 3, ...extra, created: T, updated: T,
})

function project(scenes: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes }))
  for (const [i, f] of scenes.entries()) writeFileSync(join(dir, f), sceneHtml(['#ff0000', '#00ff00', '#0000ff'][i]))
  return dir
}
const readJson = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'))

// shell.trashItem moves the page into `trash` instead of the OS trash, and says what it was handed.
const fakeTrash = (trash: string) => (app: ElectronApplication) =>
  app.evaluate(({ shell }, trash) => {
    const { renameSync } = process.getBuiltinModule('node:fs')
    const { basename, join } = process.getBuiltinModule('node:path')
    const g = globalThis as unknown as { trashed: string[] }
    g.trashed = []
    shell.trashItem = async (path: string) => (g.trashed.push(path), renameSync(path, join(trash, basename(path))))
  }, trash)
const trashed = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { trashed: string[] }).trashed)

// Every file event main forwards to the page, own ones marked: each unmarked one is Claude activity.
async function recordForwarded(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as { forwarded: string[] }
    g.forwarded = []
    const wc = BrowserWindow.getAllWindows()[0].webContents
    const send = wc.send.bind(wc)
    wc.send = (channel: string, ...args: unknown[]) => (channel === 'file-saved' && g.forwarded.push(String(args[0]) + (args[1] ? ' (own)' : '')), send(channel, ...args))
  })
  return () => app.evaluate(() => (globalThis as unknown as { forwarded: string[] }).forwarded)
}

const rows = (page: Page) => page.locator('#scene-list > li')
const seekButton = (page: Page, i: number) => rows(page).nth(i).locator('button:first-child') // the row itself, not its trash
const names = (page: Page) => page.locator('#scene-list .name').allTextContents()

test('the trash icon deletes a Scene, its page goes to the trash, its Notes go, and nothing counts as Claude activity', async () => {
  const dir = project(['a.html', 'b.html', 'c.html'])
  const trash = mkdtempSync(join(tmpdir(), 'kapecut-trash-'))
  // Notes 2 and 3 go: a point on b.html and a span that starts in it. Note 4 is a span from a.html into b.html: it stays.
  mkdirSync(join(dir, 'notes'))
  writeFileSync(join(dir, 'notes', 'note-2.png'), 'x')
  writeFileSync(
    join(dir, 'notes.json'),
    JSON.stringify({
      version: 1,
      next: 5,
      notes: [
        note(1, 'a.html'),
        { ...note(2, 'b.html'), image: 'notes/note-2.png' },
        note(3, 'b.html', { range: { start: 0.6, end: 1.2 }, scenes: ['b.html', 'c.html'] }),
        note(4, 'a.html', { range: { start: 0.4, end: 0.6 }, scenes: ['a.html', 'b.html'] }),
      ],
    }),
  )
  const { app, page } = await launch({ project: dir, onLaunch: fakeTrash(trash) })
  try {
    await expect(page.locator('#note-list li')).toHaveCount(4)
    const forwarded = await recordForwarded(app)
    const del = rows(page).nth(1).getByRole('button', { name: 'Delete Scene b.html' })
    await expect(del).toBeHidden()
    await rows(page).nth(1).hover()
    await expect(del).toBeVisible()
    await del.click()
    const confirm = page.getByRole('dialog', { name: 'Delete Scene' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('Delete b.html and its 2 Notes?')
    // Cancel changes nothing.
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    expect(readJson(dir, 'project.json').scenes).toEqual(['a.html', 'b.html', 'c.html'])

    await rows(page).nth(1).hover()
    await del.click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirm).toBeHidden()
    // The Scene list and the Timeline drop it without a reopen.
    await expect(rows(page)).toHaveCount(2)
    expect(await names(page)).toEqual(['01  a.html', '02  c.html'])
    await expect(page.locator('#strips > div')).toHaveCount(2)
    expect(readJson(dir, 'project.json').scenes).toEqual(['a.html', 'c.html'])
    expect(await trashed(app)).toEqual([join(dir, 'b.html')])
    expect(existsSync(join(trash, 'b.html'))).toBe(true) // moved, never erased
    await expect.poll(() => readJson(dir, 'notes.json').notes.map((n: { n: number }) => n.n)).toEqual([1, 4])
    await expect.poll(() => existsSync(join(dir, 'notes', 'note-2.png'))).toBe(false)
    await expect(page.locator('#note-list li')).toHaveCount(2)
    // A file saved after the delete is reported after it: the page's move is the only other event, and it is the app's own.
    writeFileSync(join(dir, 'later.txt'), 'x')
    await expect.poll(forwarded).toContain('later.txt')
    expect(await forwarded()).toEqual(['b.html (own)', 'later.txt'])
  } finally {
    await app.close()
  }
})

test('the Delete key on the selected Scene opens the confirm; a Scene with no Notes says so', async () => {
  const dir = project(['a.html', 'b.html'])
  const trash = mkdtempSync(join(tmpdir(), 'kapecut-trash-'))
  const { app, page } = await launch({ project: dir, onLaunch: fakeTrash(trash) })
  try {
    await seekButton(page, 0).click()
    await page.keyboard.press('Delete')
    const confirm = page.getByRole('dialog', { name: 'Delete Scene' })
    await expect(confirm).toContainText('Delete a.html?')
    await page.keyboard.press('Enter') // Delete has the focus
    await expect(rows(page)).toHaveCount(1)
    expect(readJson(dir, 'project.json').scenes).toEqual(['b.html'])
    expect(await trashed(app)).toEqual([join(dir, 'a.html')])
  } finally {
    await app.close()
  }
})

test('the last Scene cannot be deleted: its button is off with a tooltip, and main refuses it too', async () => {
  const dir = project(['a.html'])
  const trash = mkdtempSync(join(tmpdir(), 'kapecut-trash-'))
  const { app, page } = await launch({ project: dir, onLaunch: fakeTrash(trash) })
  try {
    const del = rows(page).nth(0).getByRole('button', { name: 'Delete Scene a.html' })
    await rows(page).nth(0).hover()
    await expect(del).toBeDisabled()
    await expect(del).toHaveAttribute('title', 'The last Scene of a Project cannot be deleted')
    // The key does nothing either.
    await seekButton(page, 0).click()
    await page.keyboard.press('Delete')
    const confirm = page.getByRole('dialog', { name: 'Delete Scene' })
    await expect(confirm).toBeHidden()
    // A page that skips its own check (forced on here) still meets main's.
    await del.evaluate((b: HTMLButtonElement) => ((b.disabled = false), b.click()))
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirm).toContainText('The last Scene of a Project cannot be deleted')
    expect(readJson(dir, 'project.json').scenes).toEqual(['a.html'])
    expect(await trashed(app)).toEqual([])
    expect(existsSync(join(dir, 'a.html'))).toBe(true)
  } finally {
    await app.close()
  }
})
