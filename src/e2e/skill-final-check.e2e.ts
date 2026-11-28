import { expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'

// The skill's Final check is check-scenes.mjs, run by users' Agents with plain node (#25). This runs it the way
// skills/kapecut/SKILL.md says to, so a broken checker fails here instead of in someone's install.
const skill = readFileSync('skills/kapecut/SKILL.md', 'utf8')
const finalCheck = /## Final check[\s\S]*?```sh\r?\n([\s\S]*?)```/.exec(skill)?.[1] ?? ''
// ready-env's temp home breaks Edge's launch ("requires a non-default data directory"): give it the real one.
const home = userInfo().homedir
// An empty global npm folder, so a Playwright installed globally on this machine never answers for "not installed".
const noGlobal = mkdtempSync(join(tmpdir(), 'kapecut-npm-'))

function run(script: string, project: string, cwd = process.cwd(), extra: string[] = []) {
  const r = spawnSync('node', [script, project, ...extra], { cwd, encoding: 'utf8', timeout: 110_000, env: { ...process.env, USERPROFILE: home, HOME: home, npm_config_prefix: noGlobal } })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

function project(scenes: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'kapecut-final-'))
  cpSync('examples/hello/hello.html', join(dir, 'hello.html'))
  for (const [name, html] of Object.entries(scenes)) writeFileSync(join(dir, name), html)
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ size: { w: 1080, h: 1920 }, fps: 30, scenes: ['hello.html', ...Object.keys(scenes)] }))
  return dir
}
const scene = (body: string, head = '') => `<!doctype html><canvas id="c" width="1080" height="1920"></canvas>${head}<script>${body}</script>`

test('SKILL.md makes the checker the Final check', () => {
  expect(finalCheck).toContain('node <this skill folder>/check-scenes.mjs <project folder>')
  expect(skill).toMatch(/Done when every Scene passes/)
})

test('the checker passes good Scenes and fails broken ones, with the error and exit 1', () => {
  const script = resolve('skills/kapecut/check-scenes.mjs')
  const good = project({})
  const stills = mkdtempSync(join(tmpdir(), 'kapecut-stills-'))
  const pass = run(script, good, process.cwd(), [stills])
  expect(pass.out).toContain('PASS hello.html')
  expect(pass.code).toBe(0)
  expect(existsSync(join(stills, 'scene-1-end.png'))).toBe(true)

  // A Scene that draws a Video file: KapeCut's /kc-video.js is missing here, the stand-in draws it, no error.
  const broken = project({
    'throws.html': scene('window.TOTAL = 3; window.renderAt = () => {}; kc.missing()'),
    'no-total.html': scene('window.renderAt = () => {}'),
    'bad-render.html': scene("window.TOTAL = 3; window.renderAt = () => { throw new Error('boom') }"),
    'video.html': scene("const g = document.getElementById('c').getContext('2d'); const s = kcVideo('speaker.mp4'); window.TOTAL = 1; window.ready = s.ready; window.renderAt = async (t) => g.drawImage(await s.frameAt(t), 0, 0, 1080, 1920)", '<script src="/kc-video.js"></script>'),
  })
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(broken, 'speaker.mp4')], { timeout: 30_000 })
  const { code, out } = run(script, broken)
  expect(out).toMatch(/FAIL throws\.html\r?\n {2}.*kc/)
  expect(out).toMatch(/FAIL no-total\.html\r?\n {2}.*TOTAL/)
  expect(out).toMatch(/FAIL bad-render\.html\r?\n {2}.*boom/)
  expect(out).toContain('PASS video.html')
  expect(out).toContain('3 of 5 Scenes failed')
  expect(code).toBe(1)
})

test('without Playwright the checker says how to install it and runs the still check', () => {
  // A copy of the skill outside the repo, run from outside it: no node_modules resolves Playwright.
  const root = mkdtempSync(join(tmpdir(), 'kapecut-skill-'))
  cpSync('skills/kapecut', join(root, 'kapecut'), { recursive: true })
  const script = join(root, 'kapecut', 'check-scenes.mjs')

  const pass = run(script, project({}), root)
  expect(pass.out).toContain('npm install playwright')
  expect(pass.out).toContain('PASS hello.html')
  expect(pass.code).toBe(0)

  const broken = project({
    'throws.html': scene('window.TOTAL = 3; window.renderAt = () => {}; kc.missing()'),
    // The stand-in needs Playwright: a video Scene is never a pass here.
    'video.html': scene("kcVideo('speaker.mp4'); window.TOTAL = 1; window.renderAt = () => {}", '<script src="/kc-video.js"></script>'),
  })
  const { code, out } = run(script, broken, root)
  expect(out).toMatch(/FAIL throws\.html\r?\n {2}.*kc is not defined/)
  expect(out).toMatch(/FAIL video\.html\r?\n {2}.*install Playwright/)
  expect(code).toBe(1)
})
