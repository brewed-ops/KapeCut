import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface LaunchOptions {
  /** KAPECUT_PROJECT: the folder the app opens. '' (the default) opens none, so the last Project never reopens. */
  project?: string
  /** --user-data-dir. Left out: a temp one, removed when the app closes. Pass one to keep it across launches. */
  userData?: string
  /** Extra env over process.env, which carries scripts/ready-env.mjs (fake home, dummy claude, KAPECUT_HIDDEN). */
  env?: Record<string, string>
  /** Wait until Export is enabled, that is every Scene has opened. Off for a launch with no Scenes to open. */
  waitForExport?: boolean
  /** Runs right after launch, before the window: dialog stubs, stderr listeners. */
  onLaunch?: (app: ElectronApplication) => unknown
}

/** An onLaunch that answers the native save dialog, which cannot be clicked, with filePath. */
export const answerSave = (filePath: string) => (app: ElectronApplication) =>
  app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
  }, filePath)

const launches = new Map<string, number>() // per test attempt (a retry has its own folder), so its files are launch-1, launch-2...

// use.trace never sees an Electron context (#142). app.close() saves first, as the trace dies with the context; a
// test that times out never reaches its finally, so its app saves and closes when the test function ends. A pass keeps
// nothing (preserveOutput). An app whose main process dies on its own has no context left to save.
async function trace(app: ElectronApplication) {
  const info = test.info()
  // Private, but Playwright's own trace recorder uses it; throw, so an upgrade that drops it goes red, not silent.
  const finished = (info as unknown as { _onDidFinishTestFunctionCallbacks?: Set<() => unknown> })._onDidFinishTestFunctionCallbacks
  if (!finished) throw new Error('Playwright no longer has TestInfo._onDidFinishTestFunctionCallbacks: fix trace() in launch.ts (#142)')
  const key = `${info.testId}#${info.retry}`
  const n = (launches.get(key) ?? 0) + 1
  launches.set(key, n)
  const name = `launch-${n}`
  // No screencast: ~20 JPEGs a second, 95% of a trace's bytes; the DOM snapshots and the png at close show the window
  await app.context().tracing.start({ screenshots: false, snapshots: true })
  let saved: Promise<unknown> | undefined
  const save = () =>
    (saved ??= Promise.all([
      app.windows()[0]?.screenshot({ path: info.outputPath(`${name}.png`), timeout: 5_000 }).catch(() => {}),
      app.context().tracing.stop({ path: info.outputPath(`${name}-trace.zip`) }).catch(() => {}),
    ]))
  let gone = false // closed on its own (a test's Close button): nothing left to save, and a dead context may not answer
  app.on('close', () => (gone = true))
  const close = app.close.bind(app)
  app.close = async () => {
    if (gone) return close()
    // tracing.stop has no timeout of its own: a wedged driver must not keep close from killing the app
    await Promise.race([save(), new Promise((r) => setTimeout(r, 10_000).unref())])
    return close()
  }
  finished.add(() => app.close().catch(() => {})) // a no-op once the test's own finally closed it
}

// The one place e2e launches the app (#97). The Setup checks run before any Project opens (#89), so the ready wait is
// 15 s: 5 s flaked under load (#78, #94).
export async function launch({ project = '', userData, env = {}, waitForExport = true, onLaunch }: LaunchOptions = {}) {
  const dir = userData ?? mkdtempSync(join(tmpdir(), 'kapecut-user-'))
  // Electron's helper processes can hold the profile a moment past close on Windows: then it is left for the OS.
  const drop = () => void (userData || rm(dir, { recursive: true, force: true, maxRetries: 10 }).catch(() => {}))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], env: { ...process.env, KAPECUT_PROJECT: project, ...env } }).catch((e) => {
    drop()
    throw e
  })
  app.on('close', drop)
  try {
    await onLaunch?.(app) // first: its stderr listeners miss nothing
    await trace(app)
    const page = await app.firstWindow()
    if (waitForExport) await expect(page.locator('#export')).toBeEnabled({ timeout: 15_000 })
    return { app, page }
  } catch (e) {
    await app.close().catch(() => {}) // the caller never got the app, so its own finally cannot close it; keep e, not a close error
    throw e
  }
}
