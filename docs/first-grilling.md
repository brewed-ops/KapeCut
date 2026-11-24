# First grilling (2026-11-22)

The idea: every Scene is a plain HTML page with one canvas and one function, `renderAt(t)`, that draws the Frame at
time `t`. Because every pixel is a function of time, the preview, a still and the final Export all draw the same
Frame. A Claude Code skill writes the Scene pages from a folder of references and a short brief. KapeCut plays the
real pages, the user marks Notes on Frames, Claude reads the Notes from a file and fixes the Scenes, and Export turns
the pages into an MP4.

## Product decisions

- A desktop app (Electron), not a CLI plus a browser tab.
- KAPE look on the editor.
- Pixel KAPE mascot (poses, lip sync) and an ElevenLabs voice built into the skill.
- Short-form presets: 9:16 safe zone guide (every element inside x 90..890, y 260..1420 on a 1080x1920 frame),
  FB / Reels / YouTube export presets, captions from the voice track.
- Open source under brewed-ops.

## Answers

1. First slice: open `examples/hello/`, play one Scene (play, pause, scrub, frame step), reload on save, Export MP4
   at a chosen Export resolution (720p / 1080p / 1440p / 4K, default 1080p, unsupported sizes greyed out). No audio,
   notes, voice, mascot, captions, transitions or multi-scene yet. Audio is slice 2. Done when ffprobe shows H.264,
   right size and frame count, BT.709, faststart, and one Playwright `_electron` test covers the export.
2. Look: ink + amber + grain, see `docs/design/look.md`. Slice UI is one framed viewer window, transport bar, amber
   EXPORT. Full layout via plan-canvas when timeline and notes arrive.
3. Files: the app writes `notes.json` in the Project folder, Claude fixes and sets `done`, the app watches the folder.
   Claude checks its own fixes with a still (`?t=`). An MCP may come later on top of the same files.
4. Voice optional, user's own ElevenLabs key in app settings via Electron `safeStorage`, never in a Project or repo.
5. The Scene contract is ADR 0001. `project.json` holds `size {w,h}` and `fps` (30 default, 60 allowed); a Scene
   whose canvas does not match is an error, never stretched.
6. Reuse: Pixel KAPE kit copied into the repo under its own asset license; lip sync rewritten in TS (audio to 6 mouth
   shapes at 15/s); HyperFrames and the dd-motion engine are not used.

Stack: Electron + electron-vite + TypeScript, plain TS + CSS tokens UI (React when the timeline earns it), Vitest +
Playwright `_electron`. Export: WebCodecs H.264 + mediabunny (new dependency), ffmpeg remux only, user-installed
ffmpeg checked at start (ADR 0002). First ticket: probe avc1 `isConfigSupported` in Electron on Windows.
