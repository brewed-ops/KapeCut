# Claude connect + layout (approved 2026-11-23)

Picked by Kenneth on the plan canvas [PLAN-claude-connect.html](PLAN-claude-connect.html) (open it in a browser and
click through the seven steps). Built from his sketch of 2026-11-23 ([sketch-2026-11-23.png](sketch-2026-11-23.png)).
Replaces the grid, the left column and the header of [editor-layout.md](editor-layout.md); the Notes list and the
Timeline's insides stay as approved there.

## The flow

1. Open KapeCut, Projects, Open folder: an empty folder he just made.
2. Copy pictures, PDFs, audio into it in Explorer. They show in Files on their own.
3. Connect Claude via Prompt: copies a prompt, toast "Prompt copied" with a check.
4. Paste it in Claude Code. Claude checks the folder is the one KapeCut has open, connects, asks format, safe zone,
   fps, then what the video is about.
5. Claude writes project.json and the Scenes; KapeCut shows them as they land.
6. Notes and Pencil on the Frames, then Copy Prompt (Notes window), paste in Claude Code. Claude fixes them and marks
   them done.
7. The header shows Claude not connected / active / idle (no activity for the idle time, 15 minutes by default).

## Picks

| Choice | Pick |
|---|---|
| How KapeCut knows Claude is active | **Folder watch**: any external file change in the Project, or anything the user does in the app, is activity. Idle after the idle time with none |
| How Claude checks it has the open Project | **Session file** in KapeCut's app data, naming the open Project. The prompts name it; Claude reads it before every job and asks the user when it names another folder |
| What turns "Connected" on | **Handshake**: Claude writes `.kapecut/claude.json` in the Project right after the check |
| An empty folder | **Opens as a Project in set-up state**: Files live, Scenes and Timeline wait for Claude, Export disabled. project.json comes from Claude |
| Settings | **Built now**, bottom left: a modal panel (#114) with General (idle minutes, recent Projects), Appearance (theme) and Setup (encoder, ffmpeg and tool checks, moved out of the footer) |
| Notes and Pencil | **Labelled buttons** with their key, in the viewer title bar beside Connect Claude |
| Copy Prompt covers | **Open Notes only**; disabled when none are open |
| Window frame | **Frameless**: KapeCut's header is the title bar (drag area), with its own minimise / maximise / close; the File/Edit menu bar is hidden, its shortcuts still work |

## Layout (1440 x 900)

- Grid (#66): left column 240 px, viewer 1fr, Notes 290 px. The left column runs from under the header to the window's
  bottom. The viewer and Notes share the top row; the Timeline sits under both, right of the left column.
- Left column: Files window (title, Project folder path, list); Scenes window; Settings card (framed, icon + label,
  opens the Settings panel, a modal over the editor). Lists scroll with thin frame-coloured scrollbars.
- Viewer window fills the middle column; the Scene picture is fitted at its aspect ratio and centred inside it, the
  transport bar at the window's foot.
- Header (right of the logo): Projects menu, Project name / Design size / fps, Claude status pill, Export resolution,
  Export, window buttons.
- Viewer title bar: Connect Claude via Prompt (amber main button until connected, then "Claude connected, copy
  again"), Note (N), Pencil (P).
- Notes window: list, then Copy Prompt at its foot (amber when Notes are open, with the open count).
- Timeline at the bottom, under viewer and Notes, beside the left column. Footer encoder row moves into Settings.
