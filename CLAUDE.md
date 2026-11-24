# KapeCut

A desktop video editor where Claude writes every scene as code. You hand it references and a direction, it builds
the scenes, you mark notes on frames, it fixes them, you export MP4. No AI image or video model.

## Decisions (2026-11-22, Kenneth)

| Decision | Choice |
|---|---|
| Base | Rewrite from scratch, not a fork |
| Shell | Desktop app (Electron), its own window and taskbar icon |
| Look | Ink + amber + grain, not the white + blue KAPE palette |
| Built in | Pixel KAPE mascot (poses, lip sync) + Kenneth's ElevenLabs voice |
| Presets | Short-form: 9:16 safe zone guide, FB / Reels / YouTube export presets, captions from the voice track |
| Audience | Open source under brewed-ops, like KAPEVault. Repo stays private until it is ready |
| Name | KapeCut |

First grilling answers: `docs/first-grilling.md`, `GLOSSARY.md`, `docs/adr/`.

**Look**: one accent colour, amber. Before any UI work, read `docs/design/look.md`.

## How this repo is built

Matt Pocock's loop (plugin `mattpocock-skills`, user-wide):

1. `/setup-matt-pocock-skills` once in this repo.
2. `/grill-with-docs` before any feature. It keeps `GLOSSARY.md` and `docs/adr/` current.
3. Big job: `/to-spec`, then `/to-tickets`. Small job: straight to `/implement`.
4. `/implement` one ticket per fresh session. Before `/implement`, read `docs/agents/workflow.md`.

## Rules

- `D:\ClaudeCode\CLAUDE.md` (Influence Flow) loads as an ancestor but does not govern KapeCut: `skills/`, `scripts/`
  and `examples/` are deliberate top-level folders, outside `src/`. Reviews keep flagging them.
- The 12 skills Matt keeps outside his plugin (in-progress and misc) are in `.claude/skills/`, gitignored.
- Secrets (ElevenLabs key) never enter the repo. This repo will go public.
- Icons are Jiggicons (paid, licensed for KapeCut), all in `src/renderer/icons.ts`: copy in only the icons the app
  uses, never the whole set. LICENSE excludes them from MIT.
- Code ponytail-style (`ponytail:ponytail`, full): smallest change that fully solves the ticket, no abstractions or
  options nobody asked for, reuse before adding. Where it clashes with `/implement`, test-first wins: every ticket
  still starts with a failing test. Review is the two passes in the workflow; `/ponytail-review` only when a diff
  feels bloated.
- e2e: before writing or debugging an e2e test, a shot or any app launcher, read `docs/agents/e2e.md`.
- Throwaway scripts, logs and shots go in the worktree's own `.scratch/` (gitignored).
- Agent worktree isolation refused: start the session from `D:\ClaudeCode\Builds\KapeCut` (capital D), or
  `git worktree add` by hand.

## Agent skills

In `docs/agents/`: `issue-tracker.md` (GitHub Issues via `gh`), `triage-labels.md` (the five defaults), `domain.md`
(single-context).
