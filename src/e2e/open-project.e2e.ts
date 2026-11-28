import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch } from './launch'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A Project folder whose one Scene fills the canvas with `color`. Size is small to keep the test fast.
function project(root: string, folder: string, scene: string, color: string, name?: string) {
  const dir = join(root, folder)
  mkdirSync(dir)
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name, size: { w: 200, h: 200 }, fps: 30, scenes: [scene] }))
  writeFileSync(join(dir, scene), sceneHtml(color))
  return dir
}
const sceneHtml = (color: string) => `<canvas id="c" width="200" height="200"></canvas><script>
  const g = document.getElementById('c').getContext('2d')
  window.TOTAL = 1
  window.renderAt = () => { g.fillStyle = '${color}'; g.fillRect(0, 0, 200, 200) }
</script>`

// The native folder dialog cannot be clicked; answer it with dir.
const answerDialog = (app: ElectronApplication, dir: string) =>
  app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog
  }, dir)

async function openViaDialog(app: ElectronApplication, page: Page, dir: string) {
  await answerDialog(app, dir)
  await page.locator('#projects summary').click()
  await page.locator('#open-folder').click()
}

// Top-left pixel of the Scene canvas, or null while no Scene is drawn.
const pixel = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('iframe')?.contentDocument?.querySelector('canvas')
    return c ? Array.from(c.getContext('2d')!.getImageData(0, 0, 1, 1).data.slice(0, 3)) : null
  }).catch(() => null) // the page reloaded mid-read; the poll tries again

test('opening Project B closes A: B is drawn, A is no longer watched or served', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const a = project(root, 'Alpha', 'a.html', '#ff0000', 'Alpha reel')
  const b = project(root, 'Beta', 'b.html', '#0000ff')
  const { app, page } = await launch({ project: a, userData: join(root, 'user') })
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0])
  await expect(page.locator('#project')).toContainText('Alpha reel')
  await expect(page).toHaveTitle('Alpha reel - KapeCut')

  await openViaDialog(app, page, b)
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255])
  await expect(page.locator('#project')).toContainText('Beta') // no name in project.json: the folder name
  await expect(page).toHaveTitle('Beta - KapeCut')
  expect(await page.evaluate(() => fetch('/project/a.html').then((r) => r.status))).toBe(404)

  await page.evaluate(() => {
    ;(window as any).loads = 0
    document.querySelector('iframe')!.addEventListener('load', () => (window as any).loads++)
  })
  writeFileSync(join(a, 'a.html'), sceneHtml('#00ff00'))
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => (window as any).loads)).toBe(0)
  writeFileSync(join(b, 'b.html'), sceneHtml('#00ff00')) // proves the watch now follows B
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0])
  await app.close()
})

test('empty state, clear project.json errors, recent Projects, last Project reopens on launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const userData = join(root, 'user')
  const a = project(root, 'Alpha', 'a.html', '#ff0000')
  const empty = join(root, 'Empty')
  mkdirSync(empty)
  const broken = join(root, 'Broken')
  mkdirSync(broken)
  writeFileSync(join(broken, 'project.json'), '{ not json')

  let { app, page } = await launch({ userData, waitForExport: false })
  await expect(page.locator('.error')).toContainText('Open a Project folder')
  await expect(page).toHaveTitle('KapeCut')

  await openViaDialog(app, page, empty)
  await expect(page.locator('.set-up')).toBeVisible()
  await openViaDialog(app, page, broken)
  await expect(page.locator('.error')).toContainText('project.json is not valid JSON')
  await expect(page).toHaveTitle('Broken - KapeCut')
  await openViaDialog(app, page, a)
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0])
  await app.close()

  ;({ app, page } = await launch({ userData })) // reopens Alpha
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0])
  await page.locator('#projects summary').click()
  await expect(page.locator('#recent > div')).toHaveText(['Alpha', 'Broken', 'Empty'])
  await page.locator('#recent').getByRole('button', { name: 'Empty', exact: true }).click()
  await expect(page.locator('.set-up')).toBeVisible()

  // Writing the missing files opens the Project without the user reopening it.
  writeFileSync(join(empty, 'e.html'), sceneHtml('#0000ff'))
  writeFileSync(join(empty, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, scenes: ['e.html'] }))
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255])

  // Scenes share this page's origin, so the bridge goes to the app once, before any Scene loads. A Scene that reaches
  // for it (open a folder, write notes.json, start an Export) gets nothing.
  expect(await page.evaluate(() => Object.keys(window.kapecut))).toEqual(['take'])
  const fromScene = () =>
    page.evaluate(() => {
      const parent = document.querySelector('iframe')!.contentWindow!.parent as typeof window
      try {
        return Object.keys(parent.kapecut.take())
      } catch (e) {
        return (e as Error).message
      }
    })
  expect(await fromScene()).toMatch(/already taken/)
  // The preload runs in the top frame only: a Scene frame has no bridge of its own.
  expect(await page.evaluate(() => 'kapecut' in document.querySelector('iframe')!.contentWindow!)).toBe(false)
  // Nor can it send the window to another page or open a new one, where the preload would run again with a bridge
  // nobody took (#126). The signal: main's own will-navigate listener, which runs after the app's, saw it refused.
  await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as { seen?: boolean[] }
    g.seen = []
    BrowserWindow.getAllWindows()[0].webContents.on('will-navigate', (e) => g.seen!.push(e.defaultPrevented))
  })
  const opened = await page.evaluate(() => {
    const scene = document.querySelector('iframe')!.contentWindow!
    scene.top!.location.href = '/project/e.html'
    return scene.open('/index.html')
  })
  expect(opened).toBeNull()
  await expect.poll(() => app.evaluate(() => (globalThis as { seen?: boolean[] }).seen)).toEqual([true])
  expect(page.url()).toBe('kapecut://app/index.html')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  // A top URL changed in place (no navigation to refuse) sends the window back to the app page, which works again.
  await page.evaluate(() => {
    ;(window as { old?: boolean }).old = true
    document.querySelector('iframe')!.contentWindow!.top!.history.replaceState(null, '', '/project/e.html')
  })
  await expect.poll(() => page.evaluate(() => !(window as { old?: boolean }).old && location.href).catch(() => null)).toBe('kapecut://app/index.html')
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255])
  await app.close()
})

test('an empty folder opens in Set-up state: Files live, Scenes and Timeline wait, project.json opens the editor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const dir = join(root, 'Lumen')
  mkdirSync(dir)
  const { app, page } = await launch({ project: dir, userData: join(root, 'user'), waitForExport: false })
  await expect(page.locator('.set-up')).toBeVisible()
  await expect(page.locator('.set-up')).toContainText('Drop your files in.Your Agent builds the rest.')
  await expect(page.locator('.error')).toBeHidden()
  await expect(page.locator('#scenes-waiting')).toBeVisible()
  await expect(page.locator('#tl-waiting')).toBeVisible()
  await expect(page.locator('#tl-scroll')).toBeHidden()
  await expect(page.locator('#files-empty')).toBeVisible()
  await expect(page.locator('#files-empty')).toContainText('Empty folder. Copy pictures')
  await expect(page.locator('#export')).toBeDisabled()
  await expect(page.locator('#note')).toBeDisabled()
  await expect(page.locator('#pen')).toBeDisabled()
  await expect(page).toHaveTitle('Lumen - KapeCut')

  // Copied in from Explorer: listed without a refresh.
  writeFileSync(join(dir, 'logo.png'), 'png')
  await expect(page.locator('#file-list li[data-file="logo.png"]')).toBeVisible()
  await expect(page.locator('#files-empty')).toBeHidden()

  // Claude writes project.json and its Scene: the editor opens in place.
  writeFileSync(join(dir, 'k.html'), sceneHtml('#00ff00'))
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['k.html'] }))
  await expect.poll(() => pixel(page)).toEqual([0, 255, 0])
  await expect(page.locator('.set-up')).toBeHidden()
  await expect(page.locator('#export')).toBeEnabled()

  // An invalid project.json still shows its error, not Set-up state.
  writeFileSync(join(dir, 'project.json'), '{ not json')
  await expect(page.locator('.error')).toContainText('project.json is not valid JSON')
  await app.close()
  const again = await launch({ project: dir, userData: join(root, 'user'), waitForExport: false })
  await expect(again.page.locator('.error')).toContainText('project.json is not valid JSON')
  await expect(again.page.locator('.set-up')).toBeHidden()
  await again.app.close()
})

test('a project.json that is there but cannot be read shows an error, not Set-up state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const dir = join(root, 'Odd')
  mkdirSync(join(dir, 'project.json'), { recursive: true }) // a folder by that name: on disk, yet no file to read
  const { app, page } = await launch({ project: dir, userData: join(root, 'user'), waitForExport: false })
  await expect(page.locator('.error')).toContainText('project.json could not be read (500)')
  await expect(page.locator('.set-up')).toBeHidden()
  await app.close()
})

test('removing a recent Project takes it off the list for good, leaves its folder, keeps it open', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  const userData = join(root, 'user')
  const a = project(root, 'Alpha', 'a.html', '#ff0000')
  const b = project(root, 'Beta', 'b.html', '#0000ff')
  mkdirSync(userData)
  const gone = join(root, 'Unplugged') // on the list, its folder not on disk: not shown, never dropped by a remove
  writeFileSync(join(userData, 'recent-projects.json'), JSON.stringify([a, b, gone]))
  let { page, app } = await launch({ userData }) // reopens Alpha, the first on the list
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0])
  await page.locator('#projects summary').click()
  const row = (name: string) => page.locator('#recent > div', { hasText: name })
  const x = (name: string) => row(name).getByRole('button', { name: `Remove ${name} from Recent Projects` })
  await expect(x('Beta')).toBeHidden() // until its row is hovered
  await row('Beta').hover()
  await expect(x('Beta')).toBeVisible()

  // Cancel keeps it.
  await x('Beta').click()
  const warn = page.getByRole('dialog', { name: 'Remove from Recent Projects' })
  await expect(warn).toContainText('The folder and its files stay on disk.')
  await warn.getByRole('button', { name: 'Cancel' }).click()
  await expect(warn).toBeHidden()
  await expect(page.locator('#recent > div')).toHaveText(['Alpha', 'Beta'])

  await row('Beta').hover()
  await x('Beta').click()
  await warn.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(warn).toBeHidden()
  await expect(page.locator('#recent > div')).toHaveText(['Alpha'])
  await expect(row('Alpha').getByRole('button', { name: 'Alpha', exact: true })).toBeFocused() // not the gone X
  // The open Project too, by keyboard: Space presses Remove (not Play behind it), and the Project stays open.
  await x('Alpha').click()
  await warn.getByRole('button', { name: 'Remove', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('#recent > div')).toHaveCount(0)
  await expect(page.locator('#open-folder')).toBeFocused()
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play')
  await page.locator('#settings').click()
  await expect(page.locator('#settings-recent')).toHaveText('None yet')
  await page.keyboard.press('Escape')
  await expect.poll(() => pixel(page)).toEqual([255, 0, 0])
  await expect(page.locator('#project')).toContainText('Alpha')
  expect(readdirSync(a).sort()).toEqual(['a.html', 'project.json'])
  expect(readdirSync(b).sort()).toEqual(['b.html', 'project.json'])
  expect(JSON.parse(readFileSync(join(userData, 'recent-projects.json'), 'utf8'))).toEqual([gone])
  await app.close()

  // Still gone after a relaunch, so nothing reopens.
  ;({ page, app } = await launch({ project: '', userData, waitForExport: false }))
  await expect(page.locator('.error')).toContainText('Open a Project folder')
  await expect(page.locator('#recent > div')).toHaveCount(0)
  // Opening a Project keeps the gone folder's entry too.
  await openViaDialog(app, page, b)
  await expect.poll(() => pixel(page)).toEqual([0, 0, 255])
  expect(JSON.parse(readFileSync(join(userData, 'recent-projects.json'), 'utf8'))).toEqual([b, gone])
  await app.close()
})
