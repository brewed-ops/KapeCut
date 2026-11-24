# e2e: driving the built app

`npm run e2e` builds, then runs Playwright `_electron` over `src/e2e/*.e2e.ts` (`playwright.config.ts`). It tests the
build only. Filter by file path (`npx playwright test src/e2e/logo.e2e.ts`): a bare word matches the full path, so a
worktree whose name holds the word runs every file. `KAPECUT_HIDDEN=0 npm run e2e` shows the windows. A test that
is flaky locally and fails on CI is a real bug, not noise.

## Launching

Every spec launches through `launch(opts)` in `src/e2e/launch.ts`, which returns `{ app, page }`:
`launch({ project?, userData?, env?, waitForExport? = true, onLaunch? })`. It passes args `'.'` plus
`--user-data-dir` (a temp folder removed on close, unless you pass `userData` to keep one across launches), env
`{ ...process.env, KAPECUT_PROJECT: project, ...env }`, and waits 15 s for Export to enable. Pass
`waitForExport: false` for a launch with no Scenes to open. `onLaunch(app)` runs before the window: stubs such as
`answerSave(out)` for the save dialog, and stderr listeners. `src/e2e/launch-env.test.ts` (Vitest) fails on any
`electron.launch` outside the helper and the shot scripts, and on any launch whose env does not start with
`...process.env`.

- The fresh `--user-data-dir`: the app reopens the last Project from `<userData>/recent-projects.json`, and a temp
  folder keeps the real list untouched. `KAPECUT_PROJECT` wins over that list; `''` with a fresh folder opens none.
- `scripts/ready-env.mjs` gets every launch past the Setup window: a temp `USERPROFILE` / `HOME` holding
  `skills/kapecut`, a dummy `claude` on `PATH`, and `KAPECUT_HIDDEN=1` unless set. Playwright runs it as
  globalSetup; the shot scripts call it. ffmpeg 4.4+ and Chrome or Edge come from the machine.
- `readyEnv()` also holds `kapecut-e2e.lock` in the git dir every worktree shares, so runs from parallel agents
  queue ("Waiting for another KapeCut e2e or shot run") instead of starving each other into timeouts. A crashed run's
  lock is taken over once its pid is gone. Run the specs your change touches; CI runs the full suite. An edit to `skills/kapecut/SKILL.md` touches
  `skill-final-check.e2e.ts`, which runs the skill's Final check snippet as written.
- A new launcher (script or config) spreads `process.env` (or calls `readyEnv()`) and deletes
  `ELECTRON_RUN_AS_NODE` at its top, as `scripts/shot.mjs` does. With it set, every test fails in 0.3 s with
  "Process failed to launch!".
- A launch runs the Setup checks before the editor, which is why the helper waits 15 s. Give any other first UI wait
  15 s too, and the wait for an Export's first Frames: it starts with the same ffmpeg checks, and away from the
  Design size it opens each Scene again. Under parallel load, rerun a launch timeout alone before blaming the change.

## When a test fails

Each launch traces itself (`use.trace` never sees an Electron context). A failed or timed-out test leaves
`test-results/<test>/launch-<n>-trace.zip` (actions, DOM snapshots, renderer console; no screencast) and
`launch-<n>.png` (the window at close, or when a timed-out test ends); a passing test leaves nothing
(`preserveOutput: 'failures-only'`). Open one with `npx playwright show-trace <zip>`.
On CI, a red `check` uploads `test-results` as `e2e-results-<os>`:
find its id with `gh api repos/brewed-ops/KapeCut/actions/runs/<run>/artifacts --jq '.artifacts[] | "\(.id) \(.name)"'`,
then `gh api repos/brewed-ops/KapeCut/actions/artifacts/<id>/zip > e2e.zip` (`gh run download` sometimes fails on the
blob host).

## Setup state

- "Installed since launch": set `process.env.PATH` in main through `app.evaluate`, under the key `process.env`
  already has (Windows: `Path`).
- The Update skill question is `dialog.showMessageBox` in main: stub it as the specs stub `showOpenDialog`.

## Hidden windows

`KAPECUT_HIDDEN=1` makes the window see-through, click-through, a tool window (no taskbar or Alt+Tab entry) and shown
without focus. Why it stays shown and on screen: the comment above it in `src/main/index.ts`.

- Only `window.e2e.ts` takes focus, since menu accelerators need it: `focus()`, then poll `isFocused()` before
  `sendInputEvent`.
- What the OS mouse hits: user32 `WindowFromPoint`, as in `hidden.e2e.ts`. Call `setAlwaysOnTop` first, or the
  check passes on whatever covers the window.

## Window size

- The CI runner's screen is smaller than a local one: a test without `setViewportSize` gets a narrower window, and
  fixed pixel drags fall short. Reproduce with `page.setViewportSize({ width: 1024, height: 768 })` on that test.
- After `page.setViewportSize`, `BrowserWindow.setSize` no longer changes the page (emulation pins it). Test or shoot
  the minimum window first, or set the viewport to the minimum (1000 x 700, `minWidth` / `minHeight` in main).
- CI fonts render wider than local: leave slack in the narrowest layout and hide labels before they touch.
- Shots go through the shot scripts (`docs/agents/workflow.md` step 3), never a one-off: `playwright test` empties
  `test-results/`, and a script outside the repo cannot import `@playwright/test`.
- Shoot a plain state of a window (nothing on a timer) before any timed state such as a toast: a window's first shot
  takes about 3 s, longer than `HOLD` (`src/renderer/dom.ts`), and the plain shot warms capture
  (`setup-window-prompt` in `scripts/shot-states.mjs`).
- The README image is `npm run shot:readme` (`scripts/readme-shot.mjs` on the demo Project from
  `scripts/readme-demo.mjs`, the Lumen 3D ad). The raw footage for the demo film is
  `npm run footage:demo -- <out> <clip.mp4>` (`scripts/demo-footage.mjs`: a UGC edit of a talking-head clip from
  `scripts/ugc-demo.mjs`, then the Lumen ad, recorded at 2x with each step's time and boxes). Never commit the clip.
  The packaged app: `npm run dist`, then `npm run smoke:packaged` (Windows).

## Assertions that hold

- Reload-safe polls: anything that reloads the page (Project switch, a fixed `project.json`) ends its probe in
  `.catch(() => null)` inside `expect.poll`, because poll does not retry "Execution context was destroyed".
- Proving something does NOT happen needs a signal from the code that defers it, never a fixed wait and never a race
  on the progress %. Model: the Export test in `export.e2e.ts` holds the Export on a gated Frame (`openGate`), saves
  `project.json`, waits for "saves apply after Export", then asserts the title is unchanged.
- Write an exported MP4 outside the Project folder, or the Export's scratch files arrive as saves first.
- Exported pixels: `pixelAt` in `export.e2e.ts`. The crop stays even: `crop=1:1` fails on yuv420.
- A test that proves "every control follows a token" checks again after mutating the token: a control hardcoded at
  today's value passes the first check.
- A button whose click closes the window: its `:active` repaint can make Playwright's click reject with "has been
  closed". Allow only that error and assert the close event (`window.e2e.ts`).
- Press tests read computed `scale` / `filter` during a raw `mouse.down()`, with a capture click blocker so Export
  and copy do not fire (`motion.e2e.ts`).
- Anything about the taskbar icon: copy `logo.e2e.ts` (user32 `SendMessage` WM_GETICON + `GetSystemMetrics`).

## macOS

CI runs the suite on `macos-latest` too (the Windows-only `hidden` and `logo` specs skip there), and on a private
repo a Mac round is billed at 10x: the local run of the specs your change touches (Launching) is what keeps Mac
rounds to one. Key presses: `src/e2e/mac-keys.test.ts` flags `Control+`, `Meta+`, `Home` and `End`, each with its
Mac-safe key.

- Paths the app reports from `tmpdir()` are realpaths (`/var` is `/private/var`): compare against
  `realpathSync(dir)` (`connect.e2e.ts`, `notes.e2e.ts`).
- Menu shortcuts: on a Mac, `webContents.sendInputEvent` never reaches the native menu, and the menu bar stays even
  on a frameless window. On darwin, assert the item exists through `Menu.getApplicationMenu()`
  (`window.e2e.ts`).
- `MenuItem.role` comes back lowercase: compare against `toggledevtools`.
- A radio the app switches back at once (a failed save): `.click()` it, as `.check()` throws "did not change its
  state" (`settings.e2e.ts`).

## Prove it red

The red-first rule (`CODING_STANDARDS.md`) runs as a mutation loop: a script in `.scratch/` applies
one source mutation at a time (assert it matches exactly once), runs `npx electron-vite build` and
`npx playwright test <file> -g <name>`, prints RED or GREEN, and restores the file in `finally`.

A mutation or rename done with sed: grep the file's imports first, as a new name can collide with a dependency's
export.

## Vitest with real tools

- Every `execFileSync('ffmpeg')` gets a `timeout`: it is a sync call, so Vitest's own timeout cannot stop a run
  that never ends (`src/main/mix.test.ts`).
- Audio levels: `volumedetect` after `atrim`. A lavfi sine peaks at -18 dBFS; ffmpeg's own mono to stereo upmix is
  -3 dB, so `mix.ts` sets its own `pan` to match WebAudio.
- Windows: `rename(tmp, file)` over a file another process has open fails with EPERM, and a test polling
  `readFileSync` on that file is that process. Temp-then-rename writes go through `src/main/owned-writes.ts`, which
  retries on EPERM / EBUSY / EACCES.
- Windows reads fail the same way: a file another process holds for a moment is a 500 from `/project/`, so the page's
  `readNotes` (`src/renderer/notes/notes.ts`) asks again too. To reproduce one, hold the file from PowerShell:
  `[IO.File]::Open(path, 'Open', 'Read', 'None')` (#137).
