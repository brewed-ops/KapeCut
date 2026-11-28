#!/usr/bin/env node
// The skill's final check: node check-scenes.mjs <project folder> [<stills folder>]
// Loads each Scene of project.json by itself in a headless Chrome or Edge, as KapeCut would, and prints PASS or FAIL
// per Scene with its errors. Exits 1 when any Scene fails, 2 when the Project cannot be read.
// With Playwright it also writes start, middle and end stills of each Scene to the stills folder (default: a new temp
// folder). Without it, it prints how to install it and runs the still check fallback, which catches less.
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STAND_IN = join(HERE, 'kc-video-stand-in.js')
const LIMIT = 15_000 // KapeCut waits this long for window.ready

const fail = (message) => {
  console.error(message)
  process.exit(2)
}

const [dirArg, outArg] = process.argv.slice(2)
if (!dirArg) fail('Usage: node check-scenes.mjs <project folder> [<stills folder>]')
const dir = resolve(dirArg)
let project
try {
  project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
} catch (e) {
  fail(`Cannot read ${join(dir, 'project.json')}: ${e.message}`)
}
const { size, fps, scenes } = project ?? {}
if (!size || !fps || !Array.isArray(scenes) || !scenes.length) fail('project.json needs size, fps and scenes')

// Playwright from the Project, the current folder, this skill's folder or the global npm folder.
function findPlaywright() {
  let global = null
  try {
    global = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim()
  } catch {}
  for (const from of [dir, process.cwd(), HERE, global].filter(Boolean))
    for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
      try {
        return createRequire(join(from, 'x.js'))(name)
      } catch {}
    }
  return null
}

async function checkScene(browser, url, out) {
  const page = await browser.newPage()
  const errors = []
  // KapeCut's /kc-video.js is not there outside KapeCut: the stand-in draws the video, and the load error is expected.
  await page.addInitScript({ path: STAND_IN })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/kc-video.js') && errors.push(m.text()))
  try {
    await page.goto(url)
    // What KapeCut checks before the first Frame.
    const total = await page.evaluate(
      async ({ w, h, limit }) => {
        const late = new Promise((_, fail) => setTimeout(() => fail(new Error('window.ready never resolved (waited 15s)')), limit))
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
    for (const [name, t] of [['start', 0], ['middle', total / 2], ['end', end]]) {
      const draw = ({ t, limit }) => {
        const late = new Promise((_, fail) => setTimeout(() => fail(new Error(`renderAt(${t}) never returned (waited 15s)`)), limit))
        return Promise.race([window.renderAt(t), late])
      }
      await page.evaluate(draw, { t, limit: LIMIT })
      await page.locator('#c').screenshot({ path: `${out}-${name}.png` })
    }
  } catch (e) {
    errors.push(e.message.split('\n')[0].replace(/^page\.evaluate: (Error: )?/, '')) // a window.ready that rejects or hangs, a contract check, a renderAt that throws or hangs
  }
  await page.close()
  return errors
}

function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? ''
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  const found = paths.find((p) => existsSync(p))
  if (found) return found
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'])
    try {
      return execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {}
  return null
}

// The still check with logging: a Scene fails on an uncaught error from its own files or a failed window.ready.
function stillCheck(exe, url) {
  const profile = mkdtempSync(join(tmpdir(), 'kapecut-check-'))
  const args = ['--headless', '--disable-gpu', '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--enable-logging=stderr', '--virtual-time-budget=3000', '--dump-dom', `${url}?t=0`]
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 << 20 })
  // dump-dom on stdout, console lines on stderr: read both.
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.error && !log) return [`browser did not run: ${r.error.message}`]
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  const errors = log.split(/\r?\n/).filter((l) => /CONSOLE.*"Uncaught/.test(l) && l.includes('source: file:')).map((l) => /"(.*)", source/.exec(l)?.[1] ?? l)
  const ready = /window\.ready failed[^<]*/.exec(log)
  if (ready) errors.push(ready[0])
  return errors
}

const pw = findPlaywright()
let browser = null
let exe = null
let out = null
if (pw) {
  const opts = { args: ['--allow-file-access-from-files'] }
  browser = await pw.chromium.launch({ ...opts, channel: 'chrome' }).catch(() => pw.chromium.launch({ ...opts, channel: 'msedge' })).catch(() => null)
  out = outArg ? resolve(outArg) : mkdtempSync(join(tmpdir(), 'kapecut-stills-'))
  if (!browser) fail('Playwright found no Chrome or Edge to launch: install Google Chrome, or run npx playwright install chromium')
} else {
  console.log('Playwright is not installed, so this runs the still check fallback, which catches less (no console errors, no Scene contract, no renderAt errors).')
  console.log(`For the full check: npm install playwright, in the Project folder or with -g, then run this again. It uses your Chrome or Edge.`)
  exe = findBrowser()
  if (!exe) fail('No Chrome or Edge found for the still check: install Google Chrome or Microsoft Edge')
}

let failed = 0
for (const [i, file] of scenes.entries()) {
  const path = join(dir, file)
  // One Scene per page, a new page each time, so one Scene's globals never hide another's missing function.
  const errors = !existsSync(path) ? [`${file} is missing`] : browser ? await checkScene(browser, pathToFileURL(path).href, join(out, `scene-${i + 1}`)) : stillCheck(exe, pathToFileURL(path).href)
  if (errors.length) failed++
  console.log(`${errors.length ? 'FAIL' : 'PASS'} ${file}`)
  for (const e of errors) console.log(`  ${e}`)
}
await browser?.close()
if (browser) console.log(`Stills (start, middle, end of each Scene): ${out}`)
console.log(failed ? `${failed} of ${scenes.length} Scenes failed` : `All ${scenes.length} Scenes pass`)
process.exit(failed ? 1 : 0)
