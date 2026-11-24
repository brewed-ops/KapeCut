# Workflow: from /implement to merge

Map of the whole loop: `C:\Users\kvill\Downloads\matt-pocock-skills-map.html` (Kenneth's machine).

1. `/implement` one ticket per fresh session, test first.
2. Review twice:
   - `/mattpocock-skills:code-review` checks standards and spec.
   - The built-in `/code-review` hunts bugs: it caught float and async-race bugs the first pass missed.
   - Built-in `/code-review` reviews the main checkout. From a worktree, commit first, then pass the branch:
     `code-review feat/<n>-<slug>`.
3. Visual change: shoot the built app and look at every PNG before `/pr`.
   - `npm run shot -- [projectDir] [out.png]` shoots one state.
   - `npm run shot:states -- [outDir]` shoots the states in `scripts/shot-states.mjs` in one go.
   - Shoot every state the change draws (error, empty, long list), not only the happy path: a clipped badge showed
     only in the narrow shot. A change that draws a new state adds it to `scripts/shot-states.mjs`.
4. `/pr`.
5. Before waiting on CI, `git fetch` and merge `origin/main`: parallel sessions land `main.ts` changes.
6. Merge, then `/retro`.
