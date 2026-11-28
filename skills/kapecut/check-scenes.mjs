#!/usr/bin/env node
// The skill's final check: node check-scenes.mjs <project folder> [<stills folder>] [--at=<t>,<t>...]
// Loads each Scene of project.json by itself in a headless Chrome or Edge, as KapeCut would, and prints PASS or FAIL
// per Scene with its errors. Exits 1 when any Scene fails, 2 on a usage error, an unreadable Project or no browser.
// With Playwright it also writes start, middle and end stills of each Scene to the stills folder (default: a new temp
// folder), plus one at each --at Scene time. Without it, it prints how to install it and runs the still check
// fallback, which catches less.
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STAND_IN = join(HERE, 'kc-video-stand-in.js')
const LIMIT = 15_000 // KapeCut waits this long for window.ready

const quit = (message) => {
  writeSync(2, `${message}\n`) // sync: process.exit can cut off an async write to a pipe (macOS)
  process.exit(2)
}

const USAGE = 'Usage: node check-scenes.mjs <project folder> [<stills folder>] [--at=<t>,<t>...]'
const argv = process.argv.slice(2)
const [dirArg, outArg] = argv.filter((a) => !a.startsWith('--'))
const atArg = argv.find((a) => a.startsWith('--at='))
// Extra still times (the beats a Scene animates), in Scene seconds.
const at = atArg ? atArg.slice(5).split(',').map(Number) : []
if (!dirArg || at.some((t) => !Number.isFinite(t) || t < 0)) quit(USAGE)
const dir = resolve(dirArg)
let project
try {
  project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
} catch (e) {
  quit(`Cannot read ${join(dir, 'project.json')}: ${e.message}`)
}
const { size, fps, scenes } = project ?? {}
if (!size || !fps || !Array.isArray(scenes) || !scenes.length) quit('project.json needs size, fps and scenes')
// KapeCut's rule (parseProject): every file project.json names stays inside the Project folder.
const outside = (f) => typeof f !== 'string' || !f || f.startsWith('/') || f.includes('\\') || f.split('/').includes('..')

// Playwright from the Project, the current folder, this skill's folder, then the global npm folder.
function findPlaywright() {
  const from = (folder) => {
    try {
      return createRequire(join(folder, 'x.js'))('playwright')
    } catch {
      return null
    }
  }
  for (const folder of [dir, process.cwd(), HERE]) {
    const pw = from(folder)
    if (pw) return pw
  }
  try {
    return from(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim())
  } catch {
    return null
  }
}

async function checkScene(browser, url, out) {
  const page = await browser.newPage()
  const errors = []
  // KapeCut's /kc-video.js is not there outside KapeCut: the stand-in draws the video, and the load error is expected.
  await page.addInitScript({ path: STAND_IN })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/kc-video.js') && errors.push(m.text()))
  // Each runs in the page, so each builds its own timeout: page.evaluate takes no closures.
  try {
    await page.goto(url)
    // What KapeCut checks before the first Frame.
    const total = await page.evaluate(
      async ({ w, h, limit }) => {
        const late = new Promise((_, reject) => setTimeout(() => reject(new Error(`window.ready never resolved (waited ${limit / 1000}s)`)), limit))
        await Promise.race([window.ready ?? document.fonts.ready, late])
        const c = document.getElementById('c')
        if (typeof window.renderAt !== 'function') throw new Error('no window.renderAt(t)')
        if (!c || c.width !== w || c.height !== h) throw new Error(`no <canvas id="c"> of ${w}x${h}`)
        const T = window.TOTAL
        if (typeof T !== 'number' || !(T >= 0) || T === Infinity) throw new Error('no window.TOTAL length in seconds')
        return T
      },
      { ...size, limit: LIMIT },
    )
    const end = Math.max(0, total - 1 / fps)
    for (const [name, t] of [['start', 0], ['middle', total / 2], ['end', end], ...at.map((t) => [`t${t}`, t])]) {
      const draw = ({ t, limit }) => {
        const late = new Promise((_, reject) => setTimeout(() => reject(new Error(`renderAt(${t}) never returned (waited ${limit / 1000}s)`)), limit))
        return Promise.race([window.renderAt(t), late])
      }
      await page.evaluate(draw, { t, limit: LIMIT })
      await page.locator('#c').screenshot({ path: `${out}-${name}.png` })
    }
  } catch (e) {
    // A window.ready that rejects or hangs, a contract check, a renderAt that throws or hangs.
    errors.push(e.message.split('\n')[0].replace(/^page\.evaluate: (Error: )?/, ''))
  }
  await page.close()
  return errors
}

// The places KapeCut's Setup looks (src/main/setup-checks.ts findBrowser), so a browser Setup found is found here.
function findBrowser() {
  const env = process.env
  if (process.platform === 'win32')
    return [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap((root) => ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'].map((b) => join(root, b)))
      .find((p) => existsSync(p))
  if (process.platform === 'darwin')
    return ['/Applications', join(homedir(), 'Applications')]
      .flatMap((apps) => ['Google Chrome', 'Microsoft Edge', 'Chromium'].map((b) => `${apps}/${b}.app/Contents/MacOS/${b}`))
      .find((p) => existsSync(p))
  // Flatpak puts its launchers (named by app id) on PATH too.
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'com.google.Chrome', 'org.chromium.Chromium', 'com.microsoft.Edge']
  return (env.PATH ?? '').split(delimiter).flatMap((d) => names.map((b) => join(d, b))).find((p) => existsSync(p))
}

// The still check with logging: a Scene fails on an uncaught error from its own files or a failed window.ready.
function stillCheck(exe, url) {
  const profile = mkdtempSync(join(tmpdir(), 'kapecut-check-'))
  const args = ['--headless', '--disable-gpu', '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--enable-logging=stderr', '--virtual-time-budget=3000', '--dump-dom', `${url}?t=0`]
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 2 * LIMIT, maxBuffer: 64 << 20 })
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
  } catch {}
  // A browser killed by the timeout or failing to run never drew the Scene: not a pass.
  if (r.error || r.signal) return [`the browser did not finish the Scene (${r.error?.message ?? r.signal}): it may hang`]
  // dump-dom on stdout, console lines on stderr: read both.
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const uncaught = log.split(/\r?\n/).filter((l) => /CONSOLE.*"Uncaught/.test(l) && l.includes('source: file:')).map((l) => /"(.*)", source/.exec(l)?.[1] ?? l)
  // The video stand-in needs Playwright's init script: such a Scene cannot run here, so it is not a pass.
  if (uncaught.some((e) => e.includes('kcVideo is not defined'))) return ['draws a video (kcVideo): install Playwright to check it']
  const ready = /window\.ready failed[^<]*/.exec(log)
  return ready ? [...uncaught, ready[0]] : uncaught
}

const pw = findPlaywright()
let browser = null
let exe = null
let out = null
if (pw) {
  const opts = { args: ['--allow-file-access-from-files'] }
  const launch = (channel) => () => pw.chromium.launch({ ...opts, channel })
  // Chrome, then Edge, then Playwright's own Chromium (npx playwright install chromium).
  browser = await launch('chrome')().catch(launch('msedge')).catch(launch(undefined)).catch(() => null)
  if (!browser) quit('Playwright found no browser to launch: install Google Chrome, or run npx playwright install chromium')
  out = outArg ? resolve(outArg) : mkdtempSync(join(tmpdir(), 'kapecut-stills-'))
} else {
  console.log('Playwright is not installed, so this runs the still check fallback. It catches less: no console.error, Scene contract, renderAt or hanging window.ready checks.')
  console.log('For the full check: npm install playwright, in the Project folder or with -g, then run this again. It uses your Chrome or Edge.')
  exe = findBrowser()
  if (!exe) quit('No Chrome or Edge found for the still check: install Google Chrome or Microsoft Edge')
}

let failed = 0
for (const [i, file] of scenes.entries()) {
  const path = join(dir, String(file))
  // One Scene per page, a new page each time, so one Scene's globals never hide another's missing function.
  const errors = outside(file) ? [`${file} must be a file inside the Project folder`] : !existsSync(path) ? [`${file} is missing`] : browser ? await checkScene(browser, pathToFileURL(path).href, join(out, `scene-${i + 1}`)) : stillCheck(exe, pathToFileURL(path).href)
  if (errors.length) failed++
  console.log(`${errors.length ? 'FAIL' : 'PASS'} ${file}`)
  for (const e of errors) console.log(`  ${e}`)
}
await browser?.close()
// A listed Audio file that is missing stops the Export.
for (const a of Array.isArray(project.audio) ? project.audio : []) {
  const file = a?.file
  const problem = outside(file) ? 'must be a file inside the Project folder' : !existsSync(join(dir, file)) ? 'is missing' : null
  if (problem) failed++, console.log(`FAIL audio ${file}\n  ${file} ${problem}`)
}
if (browser) console.log(`Stills (start, middle, end of each Scene): ${out}`)
console.log(failed ? `${failed} failed` : `All ${scenes.length} Scenes pass`)
process.exitCode = failed ? 1 : 0
