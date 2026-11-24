# Coding standards

Read at review time. Each rule here is a judgement call that typecheck, Vitest and the e2e suite cannot make for you.

## e2e tests

- Assert UI that toggles with `hidden` through visibility: `toBeVisible()` / `toBeHidden()`. `toHaveText` reads
  `textContent`, which includes hidden elements, so a text match on a hidden badge passes whether it shows or not
  (caught in #13).
- Prove each new assertion red first: break the behaviour it guards and watch it fail.

## Layout

- A PR that moves or resizes regions of the editor names the reference it follows in `docs/design/` (sketch, canvas
  or screenshot), and its description says how a shot of the built app compares with it side by side. Flag a layout
  PR that has neither: a spec can carry an old grid forward (#52 matched its spec, not the sketch).

## Renderer

- Scene page DOM comes through `SceneWindow` (`src/renderer/viewer/scene.ts`). A lookup like `getElementById('c')`
  keeps its `| null` and is checked; a cast such as `as unknown as HTMLCanvasElement` that drops the null is a finding.
- Work that can fail without breaking the Scene (thumbnails, previews) gets its own `try`, so it never sets
  `slot.error` on a Scene that plays and exports.
