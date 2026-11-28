// Screenshots of the editor in the states a visual change must be checked in, not only the happy path.
// Usage: npm run shot:states -- [outDir]   (default: test-results/states). Works on a copy of examples/three-scenes.
// Writes: default.png (with the click.wav Audio lane, its name above the waveform; the narrow viewer's Scene name),
// files.png (the Files panel, one file of each kind), files-copied.png (a row's path copied: its check), drop-overlay.png (files from disk over the window), export-progress.png
// (the stage paused: "Exporting", play and step off)
// and exported.png (Export filling its button, then done: the amber status), timeline-drop.png (an audio file dragged over the Timeline), notes-done.png (a done Note: check, dimmed; Copy Prompt amber, 2 open),
// notes-done-{light,coffee,glass}.png (the same in Light, Coffee and Glass: its marks on that theme's accent, #125),
// notes-copied.png (Copy Prompt clicked: the toast, the button reads Copied with a check), notes-hidden.png
// (Hide done on), notes-flagged.png (a Note past its shortened Scene), zoomed.png (Timeline zoomed in, mid Scene 2),
// playing.png (Pause showing), muted.png (mute on), broken.png (Scene 2 fails to open, largest usable resolution picked, Export refused),
// audio-broken.png (a missing Audio file errors on its own lane),
// narrow.png (15 Scenes: narrow strips, a Scene list that scrolls), notes-long.png (15 Notes: the list scrolls, Copy
// Prompt stays at the foot), note-pop.png (a point Note's popover open at its Mark), stroke-draft.png (a pencil stroke
// waiting for its text), notes.png (a done point Note, a span across a cut, a stroke: Frame marks and Timeline markers),
// span-flagged.png (Scenes re-ordered to b, c, a: the span moved with a.html and is flagged, its cut is gone),
// setup.png and setup-files.png (Set-up state: an empty folder, then four files copied in), prompt-copied.png (Connect
// your agent clicked: the "Prompt copied" toast), agent-active.png and agent-active-narrow.png (the Agent's handshake lands:
// the pill turns active, Connect reads "copy again"; again at 1024 px wide), settings-narrow.png (Settings open at 1024 px,
// one recent Project), settings-{general,appearance,setup,updates}-{dark,light,coffee,glass}.png (each Settings section in each theme),
// settings-update-{off,idle,checking,latest,available,downloading,ready,out,error}.png (each Update status, as main sends it;
// out is the Mac's),
// default-{light,coffee,glass}.png (the editor in Light, Coffee and Glass; Glass shot hidden shows no desktop behind it). default.png opens with a handshake: idle pill.
// scene-delete-hover.png (a Scene row's trash on hover) and scene-delete-confirm.png (its confirm, then cancelled).
// setup-window.png and setup-window-pass.png (the Setup window: ffmpeg, Claude Code and the skill missing, then all set),
// setup-window-prompt.png and setup-window-prompt-copied.png (Claude Code found, ffmpeg missing: Copy Prompt beside
// Re-check, then clicked: its toast).
import { _electron as electron } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readyEnv from './ready-env.mjs'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node
const dropEnv = readyEnv() // past the Setup window, the real home untouched

const out = resolve(process.argv[2] ?? 'test-results/states')
mkdirSync(out, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'kapecut-states-'))
const userData = mkdtempSync(join(tmpdir(), 'kapecut-shot-'))
const exportDir = mkdtempSync(join(tmpdir(), 'kapecut-shot-out-')) // the MP4 goes outside the Project
cpSync(resolve('examples/three-scenes'), dir, { recursive: true })
// The Agent's handshake: the Agent status pill shows connected.
const handshake = (folder) => {
  mkdirSync(join(folder, '.kapecut'), { recursive: true })
  writeFileSync(join(folder, '.kapecut', 'agent.json'), JSON.stringify({ version: 1, connected: new Date().toISOString() }))
}
handshake(dir) // opened with it: idle
// A copy button writes the system clipboard: give back what the user had on it.
const keepClipboard = async (app, copy) => {
  const had = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await copy()
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), had)
  }
}
const shoot = async (page, name) => (await page.screenshot({ path: join(out, `${name}.png`) }), console.log(join(out, `${name}.png`)))
// Mid-animation is not a state: wait until the element's transitions (and its children's) have run out.
const settled = (page, selector) => page.locator(selector).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})))) // a cancelled one rejects

// The Setup window: an empty PATH and a home without the skill (setup-window.png: commands to copy, Install skill),
// then PATH back and Install skill pressed (setup-window-pass.png).
const bare = mkdtempSync(join(tmpdir(), 'kapecut-home-bare-'))
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH' // Windows spells it Path
const gate = await electron.launch({
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'kapecut-shot-'))}`],
  env: { ...process.env, KAPECUT_PROJECT: '', USERPROFILE: bare, HOME: bare, [pathKey]: '' },
})
try {
  const page = await gate.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#setup li[data-check="skill"].no').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1000) // fonts settle
  await shoot(page, 'setup-window')
  await gate.evaluate((_e, path) => void (process.env.PATH = path), process.env.PATH)
  await page.getByRole('button', { name: 'Install skill' }).click()
  await page.locator('#setup-status', { hasText: 'All set' }).waitFor({ timeout: 15_000 })
  await shoot(page, 'setup-window-pass')
} finally {
  await gate.close()
  rmSync(bare, { recursive: true, force: true })
}
// Only ready-env's dummy claude on PATH: ffmpeg missing, so Copy Prompt shows (setup-window-prompt.png), then its click
// (setup-window-prompt-copied.png).
// shortcut: off Windows main appends Homebrew's dirs to PATH, so a brew ffmpeg hides this state (and setup-window.png's
// ffmpeg row); shoot it on Windows, or point those dirs elsewhere when a Mac shoots it.
const claudeOnlyData = mkdtempSync(join(tmpdir(), 'kapecut-shot-'))
const claudeOnly = await electron.launch({
  args: ['.', `--user-data-dir=${claudeOnlyData}`],
  env: { ...process.env, KAPECUT_PROJECT: '', [pathKey]: process.env.KAPECUT_DUMMY_BIN },
})
try {
  const page = await claudeOnly.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#setup-prompt:not([hidden])').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1000) // fonts settle
  await shoot(page, 'setup-window-prompt') // also warms capture: a window's first shot took 3 s, past the toast's HOLD
  await keepClipboard(claudeOnly, async () => {
    await page.locator('#setup-prompt').click()
    await page.locator('#toast', { hasText: 'Prompt copied' }).waitFor()
    await shoot(page, 'setup-window-prompt-copied')
  })
} finally {
  await claudeOnly.close()
  rmSync(claudeOnlyData, { recursive: true, force: true, maxRetries: 10 })
}

// Set-up state: an empty folder (setup.png), then files copied in from outside (setup-files.png).
const empty = mkdtempSync(join(tmpdir(), 'kapecut-setup-'))
const setUp = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, KAPECUT_PROJECT: empty } })
try {
  const page = await setUp.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('.set-up').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1000) // fonts settle
  await shoot(page, 'setup')
  for (const f of ['logo.png', 'brief.pdf', 'voice.wav', 'Geist-Black.woff2']) writeFileSync(join(empty, f), f)
  await page.locator('#file-list li[data-file="voice.wav"]').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(300)
  await shoot(page, 'setup-files')
  await keepClipboard(setUp, async () => {
    await page.getByRole('button', { name: 'Connect your agent' }).click()
    await page.locator('#toast').waitFor()
  })
  await shoot(page, 'prompt-copied')
  handshake(empty)
  await page.locator('#agent-status[data-s="active"]').waitFor({ timeout: 15_000 })
  await settled(page, '#agent-status')
  await page.locator('#toast').waitFor({ state: 'hidden' })
  await shoot(page, 'agent-active')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForTimeout(300)
  await shoot(page, 'agent-active-narrow')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('#encoder b').first().waitFor({ state: 'attached' })
  await settled(page, '#settings-panel')
  await shoot(page, 'settings-narrow')
} finally {
  await setUp.close()
  rmSync(empty, { recursive: true, force: true })
}

writeFileSync(join(userData, 'recent-projects.json'), JSON.stringify([dir])) // Settings lists a recent Project
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`], // never touches the real recent-Projects list
  env: { ...process.env, KAPECUT_PROJECT: dir },
})
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#export:enabled').waitFor({ timeout: 30_000 }) // every Scene has opened
  await page.waitForTimeout(500) // fonts and the ResizeObserver fit settle
  const shot = (name) => shoot(page, name)
  await shot('default')
  // Kenneth's sketch proportions (docs/design/sketch-2026-11-23.png, #66): compare the grid side by side.
  await page.setViewportSize({ width: 1903, height: 1015 })
  await page.waitForTimeout(300)
  await shot('sketch-1903')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)
  // Settings (#114): each section, in Dark, Light, Coffee and Glass, and the editor in each but Dark.
  const settingsShots = async (theme) => {
    for (const section of ['General', 'Setup', 'Updates', 'Appearance']) { // ends on Appearance: its radios pick the theme, and it reopens there
      await page.getByRole('dialog', { name: 'Settings' }).getByRole('navigation').getByRole('button', { name: section }).click()
      await shot(`settings-${section.toLowerCase()}-${theme}`)
    }
  }
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('#encoder b').first().waitFor({ state: 'attached' })
  await settled(page, '#settings-panel')
  await settingsShots('dark')
  // Each Update status (#138), sent as main sends it: one platform cannot reach both the Mac's and the others'.
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('navigation').getByRole('button', { name: 'Updates' }).click()
  for (const status of [
    { state: 'off' },
    { state: 'idle' },
    { state: 'checking' },
    { state: 'latest' },
    { state: 'available', version: '9.9.9' },
    { state: 'downloading', version: '9.9.9', percent: 42 },
    { state: 'ready', version: '9.9.9' },
    { state: 'out', version: '9.9.9' },
    { state: 'error', message: 'Cannot find latest.yml in the latest release artifacts (https://github.com/brewed-ops/KapeCut/releases/download/v9.9.9/latest.yml): HttpError: 404' },
  ]) {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('updates:status', s), status)
    await page.locator('#update-text', { hasText: /./ }).waitFor()
    await page.waitForTimeout(100)
    await shot(`settings-update-${status.state}`)
  }
  for (const theme of ['Light', 'Coffee', 'Glass']) {
    const name = theme.toLowerCase()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('navigation').getByRole('button', { name: 'Appearance' }).click()
    await page.getByRole('radio', { name: theme }).check()
    await page.locator(`html[data-theme="${name}"]`).waitFor({ state: 'attached' })
    await settingsShots(name)
    await page.keyboard.press('Escape')
    await settled(page, '#settings-panel')
    await page.locator('#settings-panel').waitFor({ state: 'hidden' })
    await shot(`default-${name}`)
    await page.getByRole('button', { name: 'Settings' }).click()
  }
  await page.getByRole('radio', { name: 'Dark' }).check() // the later shots as before, Settings on General
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('navigation').getByRole('button', { name: 'General' }).click()
  await page.keyboard.press('Escape')
  await page.locator('#settings-panel').waitFor({ state: 'hidden' })

  // Deleting a Scene (#17): a row's trash on hover, then the confirm naming it; cancelled, so the later shots keep b.html.
  await page.locator('#scene-list > li').nth(1).hover()
  await page.waitForTimeout(200)
  await shot('scene-delete-hover')
  await page.getByRole('button', { name: 'Delete Scene b.html' }).click()
  await settled(page, '#delete-scene')
  await shot('scene-delete-confirm')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.mouse.move(0, 0)

  // Files: one of each kind beside click.wav, then an audio file dragged over the Timeline (the drop line at 3 s).
  mkdirSync(join(dir, 'img'))
  for (const [f, body] of [['img/logo.png', 'png'], ['Geist-Black.woff2', 'font'], ['intro.mp4', 'mp4'], ['lines.json', '{}']]) writeFileSync(join(dir, f), body)
  await page.locator('#file-list li[data-file="lines.json"]').waitFor({ timeout: 15_000 })
  await page.locator('#export:enabled').waitFor({ timeout: 30_000 }) // a new file may be used by any Scene: they reload
  await page.waitForTimeout(500)
  await shot('files')
  await page.getByRole('button', { name: 'Copy the path lines.json' }).click()
  await page.waitForTimeout(300)
  await shot('files-copied')
  await page.evaluate(() => (document.getElementById('files-status').textContent = '')) // the later shots as before
  // Files from disk over the window: the drop overlay, settled (#81).
  const dragFiles = (type) =>
    page.evaluate((type) => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'x.txt'))
      document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, type)
  await dragFiles('dragover')
  await page.waitForTimeout(700)
  await shot('drop-overlay')
  await dragFiles('dragleave')
  // Export running (the button fills by scaleX, the stage says the preview is paused), then done (the status turns amber).
  await app.evaluate(({ dialog }, filePath) => (dialog.showSaveDialog = async () => ({ canceled: false, filePath })), join(exportDir, 'out.mp4'))
  await page.locator('#export').click()
  await page.locator('#export-progress:not([hidden])').waitFor({ timeout: 30_000 })
  await shot('export-progress')
  await page.locator('#export-status.done').waitFor({ timeout: 60_000 })
  await shot('exported')
  await page.locator('#export-status').evaluate((el) => (el.textContent = '')) // later shots keep the header as before
  await page.evaluate(() => {
    const [item, trackEl, over] = ['#file-list li[data-file="click.wav"]', '#tl-track', '#tl-scroll'].map((s) => {
      const el = document.querySelector(s)
      if (!el) throw new Error(`${s} missing from the page`)
      return el
    })
    const dt = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
    const track = trackEl.getBoundingClientRect()
    over.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: track.left + track.width / 2, clientY: track.top + 60 }))
  })
  await shot('timeline-drop')
  await page.evaluate(() => document.dispatchEvent(new DragEvent('dragend')))

  // Notes: Claude marks Note 1 done live (a check, dimmed), the filter hides it, then c.html is cut to 1 s so Note 3 is flagged.
  const T = '2026-11-23T10:00:00.000Z'
  const noteJson = (n, text, scene, sceneTime, time, done, point) =>
    ({ n, text, done, scene, sceneTime, time, frame: Math.round(time * 30), point, created: T, updated: T })
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 4, notes: [
    noteJson(1, 'Bigger headline', 'a.html', 0.5, 0.5, true, { x: 540, y: 700 }),
    noteJson(2, 'Warmer background, less blue in the shadows', 'a.html', 0.5, 0.5, false, { x: 300, y: 1400 }),
    noteJson(3, 'Hold the last line longer', 'c.html', 1.5, 5.5, false, { x: 540, y: 1200 }),
  ] }))
  await page.locator('#note-list .pin.done').waitFor({ timeout: 15_000 })
  await page.locator('#note-list .jump').first().click()
  await page.waitForTimeout(300)
  await shot('notes-done')
  // The same Notes in Light, Coffee and Glass, then back to Dark with Settings on General, so the later shots stay as they were.
  const nav = (section) => page.getByRole('dialog', { name: 'Settings' }).getByRole('navigation').getByRole('button', { name: section }).click()
  const pickTheme = async (name) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await nav('Appearance')
    await page.getByRole('radio', { name }).check()
    await page.locator(`html[data-theme="${name.toLowerCase()}"]`).waitFor({ state: 'attached' })
  }
  const closeSettings = async () => {
    await page.keyboard.press('Escape')
    await settled(page, '#settings-panel')
    await page.locator('#settings-panel').waitFor({ state: 'hidden' })
  }
  for (const theme of ['Light', 'Coffee', 'Glass']) {
    await pickTheme(theme)
    await closeSettings()
    await shot(`notes-done-${theme.toLowerCase()}`)
  }
  await pickTheme('Dark')
  await nav('General')
  await closeSettings()
  await keepClipboard(app, async () => {
    await page.getByRole('button', { name: /^Copy Prompt/ }).click()
    await page.locator('#toast').waitFor()
  })
  await page.locator('#copy-prompt .ok').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => null))) /* a cancelled one rejects */) // its check has popped in
  await shot('notes-copied')
  await page.locator('#toast').waitFor({ state: 'hidden' }) // later shots stay as they were
  await page.locator('#hide-done').click()
  await shot('notes-hidden')
  await page.locator('#hide-done').click()
  const c = readFileSync(join(dir, 'c.html'), 'utf8')
  writeFileSync(join(dir, 'c.html'), c.replace('TOTAL = 2', 'TOTAL = 1'))
  await page.locator('#note-list li.flagged').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)
  await shot('notes-flagged')
  writeFileSync(join(dir, 'c.html'), c)
  await page.locator('#note-list li.flagged').waitFor({ state: 'detached', timeout: 15_000 })
  // The later states are shot without Notes, as before this state existed. The user owns the list, so delete them in it.
  for (let left = 3; left > 0; left--) {
    await page.locator('#note-list .del').first().click()
    await page.locator('#note-list li').nth(left - 1).waitFor({ state: 'detached', timeout: 15_000 })
  }
  await page.locator('#notes-empty').waitFor({ timeout: 15_000 })
  await page.locator('#scrub').evaluate((el) => ((el.value = '0'), el.dispatchEvent(new Event('input'))))

  await page.locator('#zoom-in').click()
  await page.getByRole('button', { name: /b\.html/ }).click()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  await shot('zoomed')

  const zoomedAt = await page.locator('#scrub').inputValue()
  await page.keyboard.press('Space')
  await page.waitForTimeout(400) // the play icon's cross-fade settles
  await shot('playing')
  await page.keyboard.press('Space')
  await page.locator('#scrub').evaluate((el, t) => ((el.value = t), el.dispatchEvent(new Event('input'))), zoomedAt) // later shots as before

  await page.locator('#mute').click()
  await page.waitForTimeout(400)
  await shot('muted')

  // Notes: a stroke on the Frame, a done point, a span crossing the a/b cut, markers on the Timeline.
  const marks = page.locator('#marks')
  const onFrame = async (x, y) => {
    const r = await marks.boundingBox()
    return [r.x + x * r.width, r.y + y * r.height]
  }
  const onTimeline = async (f) => {
    const r = await page.locator('#tl-track').boundingBox()
    const s = await page.locator('#strips').boundingBox()
    return [r.x + f * r.width, s.y + s.height / 2]
  }
  const note = async (said) => {
    await page.locator('#note-pop textarea').fill(said)
    await page.keyboard.press('Enter')
    await page.locator('#note-pop').waitFor({ state: 'hidden' }) // saved
  }
  // The popover has grown open from its Mark (#79): shot settled, never mid-spring.
  const popOpen = () => page.locator('#note-pop:not([hidden])').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => null))) /* a cancelled one rejects */)
  await page.locator('#zoom-fit').click()
  await page.keyboard.press('n')
  await page.mouse.click(...(await onFrame(0.7, 0.2)))
  await popOpen()
  await shot('note-pop')
  await note('Smaller')
  await page.keyboard.press('n')
  await page.mouse.move(...(await onTimeline(0.25)))
  await page.mouse.down()
  await page.mouse.move(...(await onTimeline(0.45)))
  await page.mouse.up()
  await note('Slower here')
  await page.keyboard.press('p')
  await page.mouse.move(...(await onFrame(0.2, 0.4)))
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(...(await onFrame(0.2 + i * 0.05, 0.4 + Math.sin(i / 2) * 0.1)))
  await page.mouse.up()
  await popOpen()
  await shot('stroke-draft')
  await note('Follow this path')
  await page.waitForFunction(() => document.querySelectorAll('#note-list li').length === 3)
  const notesFile = join(dir, 'notes.json')
  const file = JSON.parse(readFileSync(notesFile, 'utf8'))
  file.notes[0].done = true
  writeFileSync(notesFile, JSON.stringify(file))
  await page.locator('#note-list .edit').last().click() // a save picks up Claude's done flag (numbers start after the deleted 1 to 3)
  await note('Follow this path, slower')
  await page.locator('#note-lane .marker.done').waitFor()
  await page.waitForTimeout(300)
  await shot('notes')

  const projectFile = join(dir, 'project.json')
  const original = readFileSync(projectFile, 'utf8')
  writeFileSync(projectFile, JSON.stringify({ ...JSON.parse(original), scenes: ['b.html', 'c.html', 'a.html'] }))
  await page.locator('#note-list li.flagged').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)
  await shot('span-flagged')
  writeFileSync(projectFile, original)
  await page.locator('#note-list li.flagged').waitFor({ state: 'detached', timeout: 15_000 })

  writeFileSync(join(dir, 'b.html'), '<canvas id="c" width="300" height="300"></canvas><script>window.TOTAL=2;window.renderAt=()=>{}</script>')
  await page.locator('#strips .badge').waitFor({ timeout: 15_000 })
  await page.locator('#zoom-fit').click()
  await page.locator('#resolution').selectOption((await page.locator('#resolution option:not([disabled])').last().getAttribute('value')) ?? '')
  await page.locator('#export').click() // refused before any save dialog: a long status beside the picker
  await page.waitForTimeout(300)
  await shot('broken')

  const audio = [{ file: 'click.wav', start: 0, volume: 0.6 }, { file: 'gone.wav', start: 2 }]
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Three Scenes', size: { w: 1080, h: 1920 }, fps: 30, scenes: ['a.html', 'b.html', 'c.html'], audio }))
  await page.locator('#lanes .badge').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(300)
  await shot('audio-broken')

  const scenes = Array.from({ length: 15 }, (_, i) => 'abc'[i % 3] + '.html')
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Narrow', size: { w: 1080, h: 1920 }, fps: 30, scenes }))
  await page.locator('#strips > div').nth(14).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1500) // every Scene page reloads its thumbnail
  await shot('narrow')

  // A list longer than the window: Claude adds 12 Notes past `next`; the list scrolls, Copy Prompt stays at the foot.
  const long = JSON.parse(readFileSync(notesFile, 'utf8'))
  for (let i = 0; i < 12; i++) long.notes.push(noteJson(long.next + i, `Long list Note ${i + 1}`, 'a.html', 0.5, 0.5, false, { x: 540, y: 700 }))
  long.next += 12
  writeFileSync(notesFile, JSON.stringify(long))
  await page.locator('#note-list li').nth(long.notes.length - 1).waitFor({ timeout: 15_000 })
  await shot('notes-long')
} finally {
  await app.close()
  for (const d of [dir, userData, exportDir]) rmSync(d, { recursive: true, force: true })
  dropEnv()
}
