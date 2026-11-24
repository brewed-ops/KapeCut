import { chromium, expect, test, type Browser } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The skill's Final check snippet ships to users' Claude and was only ever run by hand (#115). This runs it straight
// out of skills/kapecut/SKILL.md, so a broken edit to the skill fails here instead of in someone's v1 install.
type FinalCheck = (browser: Browser, url: string, project: unknown, out: string) => Promise<string[]>
const skill = readFileSync('skills/kapecut/SKILL.md', 'utf8')
const snippet = /## Final check[\s\S]*?```js\r?\n([\s\S]*?)```/.exec(skill)?.[1]
if (!snippet) throw new Error('no ```js block under "## Final check" in skills/kapecut/SKILL.md')
const finalCheck = new Function(`${snippet}\nreturn finalCheck`)() as FinalCheck

const project = { size: { w: 1080, h: 1920 }, fps: 30 }
const dir = mkdtempSync(join(tmpdir(), 'kapecut-final-'))
const scene = (name: string, body: string) => {
  writeFileSync(join(dir, name), `<!doctype html><canvas id="c" width="1080" height="1920"></canvas><script>${body}</script>`)
  return pathToFileURL(join(dir, name)).href
}

let browser: Browser
test.beforeAll(async () => {
  // ready-env's temp home breaks Edge's launch ("requires a non-default data directory"): give it the real one.
  const home = userInfo().homedir
  const opts = { args: ['--allow-file-access-from-files'], env: { ...process.env, USERPROFILE: home, HOME: home } }
  browser = await chromium.launch({ ...opts, channel: 'chrome' }).catch(() => chromium.launch({ ...opts, channel: 'msedge' }))
})
test.afterAll(() => browser?.close())

test('the skill snippet passes a good Scene and fails broken ones', async () => {
  const good = pathToFileURL('examples/hello/hello.html').href
  expect(await finalCheck(browser, good, project, join(dir, 'good'))).toEqual([])

  const throws = scene('throws.html', 'window.TOTAL = 3; window.renderAt = () => {}; kc.missing()')
  expect((await finalCheck(browser, throws, project, join(dir, 'throws'))).join()).toContain('kc')

  const noTotal = scene('no-total.html', 'window.renderAt = () => {}')
  expect((await finalCheck(browser, noTotal, project, join(dir, 'no-total'))).join()).toContain('TOTAL')

  const badRender = scene('bad-render.html', "window.TOTAL = 3; window.renderAt = () => { throw new Error('boom') }")
  expect((await finalCheck(browser, badRender, project, join(dir, 'bad-render'))).join()).toContain('boom')
})
