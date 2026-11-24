# KapeCut

**A motion design and video editor made for Claude Code.** You describe the video; Claude Code writes every Scene as
code; you review it, point at what to change, and export an MP4. No AI image or video model, no keyframes to drag.

![KapeCut with a three-Scene promo open: the Scene list, the viewer on the product shot, the Timeline with a sound effect lane, and the Notes Claude is working through](docs/images/kapecut.png)

## How it helps

Claude Code can already write animation as code. Without KapeCut, though, you can't see a frame of it, point at a
spot to fix, or get an MP4 out. KapeCut supplies those parts:

- **Brief in, video out.** Drop a brief, a logo, fonts and a voiceover into a folder and ask Claude Code for "a KapeCut
  video from this brief". The bundled skill plans the shots and writes one HTML canvas page per Scene for 9:16, 16:9
  or 1:1.
- **See every Frame.** KapeCut plays the real Scene pages with your audio, frame-accurately. It reloads a Scene the
  moment Claude saves it, so you watch the fix land.
- **Point instead of describe.** Pause, press **N** and click the spot, draw a path with **P**, or mark a span on the
  Timeline. Then **Copy Prompt** and paste it into Claude Code. Claude reads each Note's Frame and position, fixes the
  Scene, checks it with a still and ticks the Note off while you watch.
- **Export without a render farm.** MP4 (H.264) at 720p, 1080p, 1440p or 4K. The same code that draws the preview
  draws the export, so what you approved is what you get.
- **Yours to edit.** A Project is a plain folder: `project.json`, the Scene pages, your files and `notes.json`. Open it
  in any editor, put it in git, hand it to someone else.

Good for short-form ads, explainers, kinetic type, product promos and social cut-downs: anything where you'd rather
direct than keyframe.

## Install

Download the installer for your OS from [Releases](../../releases): `KapeCut-Setup-<version>.exe` (Windows),
`KapeCut-<version>-arm64.dmg` (Mac, Apple silicon) or `KapeCut-<version>.AppImage` (Linux).

The installers are not signed yet:

- Windows SmartScreen says "Windows protected your PC": click **More info**, then **Run anyway**.
- Mac blocks KapeCut the first time: open **System Settings > Privacy & Security**, scroll down and click **Open
  Anyway**. If it says KapeCut "is damaged", run `xattr -cr /Applications/KapeCut.app` in Terminal and open it again.
- Linux: `chmod +x KapeCut-*.AppImage`, then run it. On Ubuntu 22.04 and later, install FUSE 2 first:
  `sudo apt install libfuse2` (`libfuse2t64` on 24.04).

On first launch the Setup window lists what is still missing (ffmpeg, Claude Code, the KapeCut skill, Chrome or Edge)
with the install command for each.

## Run from source

Needs:

- Node 24, or 26 and newer (`npm ci` stops on any other: vitest skips Node 25)
- ffmpeg 4.4 or newer on your PATH, with ffprobe (Export encodes with them)
- [Claude Code](https://claude.com/claude-code) on your PATH (Claude writes the Scenes)
- the KapeCut skill in `~/.claude/skills/kapecut` (KapeCut installs it for you, see below)
- Chrome or Edge (Claude checks each Scene with a still from it; Windows ships with Edge)

```sh
npm ci
npm run dev
```

KapeCut checks all of these on every launch. While one is missing, the Setup window stands in for the editor and
nothing opens. It shows the install command for your OS with a Copy button (KapeCut never runs an installer) and an
**Install skill** button. With Claude Code found, **Copy Prompt** copies one prompt that has Claude run the other
install commands. Install what is missing, then press **Re-check**. Settings lists the same checks.

Open a Project folder with the "Open folder" button, or drop the folder on the window. `examples/` holds two. Drop any other file on the window to copy it into the open Project: it shows in the Files panel, and audio files drag from there onto the Timeline.

## The KapeCut skill

`skills/kapecut/` is a [Claude Code](https://claude.com/claude-code) skill that turns a folder with a brief and
references into a Project: it asks the format (9:16, 16:9 or 1:1), writes `project.json` and one page per Scene
from the 2D canvas starter (`skills/kapecut/starter-2d.html`), and checks every Scene with a still before handing over.

The Setup window installs it into `~/.claude/skills/kapecut` (**Install skill**), and offers **Update skill** whenever
your copy differs from this checkout's, by a hash of every file. Update asks first, since it replaces the whole folder.

Then, in Claude Code, in a folder holding your `brief.md` and references: "make a KapeCut video from this brief".
Open that folder in KapeCut when Claude is done.

Pin Notes on the Frames you want changed, then tell Claude "fix the Notes". It fixes the Scenes, checks each fix with
a still and sets the Notes done (`skills/kapecut/mark-done.mjs`, needs Node 18 or later); KapeCut reloads the Scenes
and turns each fixed Note into a check while you watch.

The Scene contract every page follows is [ADR 0001](docs/adr/0001-scene-contract.md).

## Test

```sh
npm run typecheck
npm test
npm run e2e
npm run dist   # this OS's installer into release/
```

e2e and shots keep the KapeCut window see-through, click-through and unfocused; `KAPECUT_HIDDEN=0 npm run e2e` shows it for debugging.

## License

MIT, except the icons in `src/renderer/icons.ts` (Jiggicons, licensed for KapeCut only). See [LICENSE](LICENSE).
