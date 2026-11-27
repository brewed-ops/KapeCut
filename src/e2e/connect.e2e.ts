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
