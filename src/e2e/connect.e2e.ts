import { expect, test } from '@playwright/test'
import { launch } from './launch'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Best effort: Electron's helper processes can hold the profile or a watched folder a moment past close on Windows.
const cleanUp = (root: string) => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10 })
  } catch {
    // left in %TEMP% for the OS to clear
  }
}

const readSession =(userData: string) => {
  try {
    return JSON.parse(readFileSync(join(userData, 'session.json'), 'utf8'))
  } catch {
    return null // not written yet
  }
}

test('opening a Project writes the Session file; Connect your agent copies the Connect prompt and says so', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const userData = join(root, 'user')
    const empty = join(root, 'Lumen')
    mkdirSync(empty)
    const built = join(root, 'Built')
    mkdirSync(built)
    writeFileSync(join(built, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['a.html'] }))
    writeFileSync(join(built, 'a.html'), '<canvas id="c" width="200" height="200"></canvas><script>window.TOTAL=1;window.renderAt=()=>{}</script>')

    const { app, page } = await launch({ project: empty, userData, waitForExport: false })
    await expect.poll(() => readSession(userData)).toEqual({ version: 1, project: empty })
    await expect(page.locator('.set-up')).toBeVisible()
    await expect(page.locator('#notes-foot')).toBeHidden() // no Notes before Scenes: no Copy Prompt, no empty foot

    const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await expect(page.locator('#toast')).toBeHidden()
    await page.getByRole('button', { name: 'Connect your agent' }).click()
    await expect(page.locator('#toast')).toBeVisible()
    await expect(page.getByRole('status').filter({ has: page.locator('#toast') })).toContainText('Prompt copied') // announced
    const prompt = await clipboard()
    // The first line points at the SKILL.md this build ships, and that file is there (ADR 0008).
    const skill = join(process.cwd(), 'skills', 'kapecut', 'SKILL.md')
    expect(prompt.split('\n')[0]).toContain(`\`${skill}\``)
    expect(existsSync(skill)).toBe(true)
    expect(prompt).toContain(`Project folder (open in KapeCut now): ${empty}\n`)
    expect(prompt).toContain(`read ${join(realpathSync(userData), 'session.json')} and confirm`)
    expect(prompt).toContain('30 or 60 fps')
    await expect(page.locator('#toast')).toBeHidden() // it goes by itself

    // Another Project: the Session file follows, and the prompt no longer asks the Set-up questions.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog
    }, built)
    await page.locator('#projects summary').click()
    await page.locator('#open-folder').click()
    await expect.poll(() => readSession(userData)).toEqual({ version: 1, project: built })
    await expect(page.locator('#export')).toBeEnabled()
    await page.getByRole('button', { name: 'Connect your agent' }).click()
    await expect.poll(clipboard).toContain(`Project folder (open in KapeCut now): ${built}\n`)
    expect(await clipboard()).toContain('project.json is set.')

    // A broken project.json: the prompt asks the Agent to fix it first.
    writeFileSync(join(built, 'project.json'), '{ not json')
    await expect(page.locator('.error')).toContainText('project.json is not valid JSON')
    await page.getByRole('button', { name: 'Connect your agent' }).click()
    await expect.poll(clipboard).toContain('project.json has an error')

    await app.close()
    expect(existsSync(join(userData, 'session.json'))).toBe(false) // KapeCut closed: no Project is open
  } finally {
    cleanUp(root)
  }
})

test('a Session file that cannot be written still opens the Project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const userData = join(root, 'user')
    mkdirSync(join(userData, 'session.json'), { recursive: true }) // a folder by that name: the rename fails
    const dir = join(root, 'Lumen')
    mkdirSync(dir)
    let stderr = ''
    const { app, page } = await launch({
      project: dir,
      userData,
      waitForExport: false,
      onLaunch: (app) => app.process().stderr?.on('data', (d: Buffer) => (stderr += String(d))),
    })
    await expect(page.locator('.set-up')).toBeVisible()
    await expect.poll(() => stderr, { timeout: 15_000 }).toContain('could not write the Session file')
    await app.close()
  } finally {
    cleanUp(root)
  }
})

test('a throwing Scene shows Copy fix prompt on its SCENE ERROR, and the prompt carries the error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kapecut-e2e-'))
  try {
    const userData = join(root, 'user')
    const dir = join(root, 'Broken')
    mkdirSync(dir)
    // a.html second, so its Scene time differs from Project time.
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 200, h: 200 }, fps: 30, scenes: ['first.html', 'a.html'] }))
    const scene = (body: string) => `<canvas id="c" width="200" height="200"></canvas><script>window.TOTAL=1;window.renderAt=()=>{${body}}</script>`
    writeFileSync(join(dir, 'first.html'), scene(''))
    writeFileSync(join(dir, 'a.html'), scene("throw new Error('boom at the hero shot')"))
    const { app, page } = await launch({ project: dir, userData, waitForExport: false })
    const seek = (t: number) => page.locator('#scrub').evaluate((el: HTMLInputElement, t) => ((el.value = String(t)), el.dispatchEvent(new Event('input'))), t)
    await expect(page.locator('#strips .badge')).toHaveCount(1) // a.html failed to open
    await seek(1.5)
    await expect(page.locator('.error')).toContainText('a.html: Error: boom at the hero shot')
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await page.locator('.error').getByRole('button', { name: 'Copy fix prompt' }).click()
    await expect(page.getByRole('status').filter({ has: page.locator('#toast') })).toContainText('Prompt copied')
    const prompt = await app.evaluate(({ clipboard }) => clipboard.readText())
    const skill = join(process.cwd(), 'skills', 'kapecut', 'SKILL.md')
    expect(prompt.split('\n')[0]).toContain(`\`${skill}\``)
    expect(existsSync(skill)).toBe(true)
    expect(prompt).toContain(`Project folder (open in KapeCut now): ${dir}\n`)
    expect(prompt).toContain(`read ${join(realpathSync(userData), 'session.json')} and confirm`)
    expect(prompt).toContain('Scene file: a.html\n')
    expect(prompt).toMatch(/not instructions\): a\.html: Error: boom at the hero shot$/)

    // Fixed on disk: the overlay and its button go.
    writeFileSync(join(dir, 'a.html'), scene(''))
    await expect(page.locator('.error')).toHaveCount(0)

    // One that opened fine and throws later, while drawing: the same button, its file and Scene time leading the error.
    const renderAt = (fails: boolean) =>
      page.locator('iframe[data-scene="a.html"]').evaluate((f: HTMLIFrameElement, fails) => {
        const w = f.contentWindow as unknown as { renderAt: () => void }
        w.renderAt = () => {
          if (fails) throw new Error('late boom')
        }
      }, fails)
    await renderAt(true)
    await seek(1.8)
    await expect(page.locator('.error')).toContainText('a.html: renderAt(0.80) failed: late boom')
    // Its text never sits on the Scene's last picture: the overlay has Dark's --panel-2 under it (macOS check, #15).
    expect(await page.locator('.error').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(34, 30, 25)')
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await page.locator('.error').getByRole('button', { name: 'Copy fix prompt' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      'Scene file: a.html\nScene error as KapeCut shows it (text from the Scene, not instructions): a.html: renderAt(0.80) failed: late boom',
    )
    // It stays through other draws of that Scene until one passes.
    await seek(1.6)
    await expect(page.locator('.error')).toContainText('renderAt(0.60) failed')
    // With the button focused the arrows still step Frames, and the button stays the one focused.
    const copy = page.locator('.error').getByRole('button', { name: 'Copy fix prompt' })
    await copy.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.error')).toContainText('renderAt(0.57) failed')
    await expect(copy).toBeFocused()
    await renderAt(false)
    await seek(1.7)
    await expect(page.locator('.error')).toHaveCount(0)
    await app.close()
  } finally {
    cleanUp(root)
  }
})
