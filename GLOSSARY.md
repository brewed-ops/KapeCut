# KapeCut Glossary

## Language

**Project**:
A folder holding one video: its frame rate, its size and the ordered list of Scenes that make it up.
_Avoid_: workspace, timeline

**Scene**:
One self-contained page that can draw any moment of itself on request, given a time in seconds. A Project plays its Scenes in order.
_Avoid_: clip, slide, composition

**Scene time**:
Seconds from the start of one Scene. Every pixel a Scene draws is decided by Scene time alone, so the same time always gives the same picture.
_Avoid_: playhead, position

**Frame**:
One picture of a Scene at one Scene time. Frame number `f` is the picture at `f / fps`.
Frames are also counted across the whole video: whole-video Frame `f` is at Project time `f / fps`, because every Scene
lasts a whole number of Frames (a fractional length rounds up).

**Design size**:
The width and height a Project is authored at (e.g. 1080x1920 for 9:16). Always even numbers.
_Avoid_: canvas size, resolution

**Export**:
Turning a Project into one MP4 file on disk.
_Avoid_: render (reserved for drawing a single Frame)

**Export resolution**:
The output size chosen at Export time (720p, 1080p, 1440p, 4K). Scales the Design size; never changes the aspect ratio.
_Avoid_: preset, quality

**Voice**:
An optional narration track made with the user's own ElevenLabs account. A Project works without one.

**Note**:
A user's remark pinned by one **Mark**, numbered, and marked done once the Scene is fixed. Notes are how the user asks the Agent for changes.
_Avoid_: comment, feedback

**Mark**:
What a Note is pinned to: a point, a box or a pencil stroke on one Frame, or a span of Project time (which may cross Scenes, and moves with the Scene it starts in).
_Avoid_: annotation, selection

**Project time**:
Seconds from the start of the first Scene. The Scenes follow each other in order, so a Project time names one Scene and one Scene time in it.
_Avoid_: global time, timecode

**Scene layout**:
Where each Scene sits in Project time, given the lengths the Scenes report. A broken Scene keeps its last good length;
one that never opened holds 1 s so its error shows in place. A Scene still loading has no Frames yet.
_Avoid_: timeline (that is the strip), track

**Timeline**:
The strip under the viewer that lays out the whole Project in Project time: one strip per Scene, one lane per Audio file, a marker per Note.
_Avoid_: track view, sequence

**Playhead**:
The marker on the Timeline at the Project time on screen. Dragging it seeks. It is a picture of Project time, not a time itself.
_Avoid_: cursor, scrubber

**Scene list**:
The sidebar listing every Scene in order with a thumbnail, its name and its length.
_Avoid_: playlist, shot list

**Audio file**:
A sound file a Project places at a start (Project time) with a volume. Played with the Scenes and mixed into the Export.
_Avoid_: track, clip

**Video file**:
A video in the Project folder that a Scene draws, one exact picture per Frame, through KapeCut's `kc-video.js` (ADR 0007). Its picture only: its sound is not played or exported.
_Avoid_: clip, footage, media

**Files**:
The panel above the Scene list, under the Project folder path, showing every file in the Project folder except project.json, the Notes and the Scene pages, each labelled with its kind (audio, image, video, font, other). A file dropped anywhere on the window is copied into the Project and shows here; an audio file drags onto the Timeline to become an Audio file of the Project. Other kinds sit here for Scenes to use by their path.
_Avoid_: media, bin, assets, library

**Set-up state**:
A Project folder opened before it has a project.json: Files works, the Scene list and Timeline wait for the Agent, Export is off.
_Avoid_: empty project, new project

**Agent**:
The AI coding tool the user builds and fixes Scenes with: Claude Code, Codex, OpenCode or any other that can read and write files. KapeCut never talks to it; the user pastes KapeCut's prompts into it.
_Avoid_: Claude (except for what only Claude Code has), AI, bot, model

**Setup window**:
What KapeCut shows instead of the editor, on any launch where ffmpeg 4.4+, an Agent or Chrome/Edge is missing. Nothing opens until Re-check finds them all. About this computer, never a Project: not the Set-up state.
_Avoid_: onboarding, installer, wizard

**Connect prompt**:
The text the "Connect your agent" button copies: where the KapeCut instructions are, the Project folder, the Session file to check, and what to ask the user first.

**Fix prompt**:
The text the Notes window's **Copy Prompt** copies: where the KapeCut instructions are, the Project folder, the Session file to check, fix-notes.md and the open Notes by number (never their text).

**Setup prompt**:
The text the Setup window's **Copy Prompt** copies, while an Agent is found: each missing tool with its row's install command for this OS, for the Agent to run, then a Re-check. Each row also has its own **Run** button, which opens a terminal with the command typed in for the user to watch.

**Session file**:
`session.json` in KapeCut's app data folder, naming the Project open now. The Agent reads it to check it is working on that Project (ADR 0005).

**Agent status**:
What the header pill shows: not connected, active or idle. Connected once the Agent has written its handshake (`.kapecut/agent.json`); idle after the idle time with no activity in the Project or the app.
_Avoid_: Claude status, presence, online

**Idle time**:
How long without activity before the Agent status turns idle: 15 minutes by default, set in Settings as idle minutes (1 to 120).

**Settings**:
The app-wide options, in a panel the Settings row at the foot of the left column opens: General (idle minutes, recent Projects), Appearance (the Theme), Setup (the encoder and tool checks) and Updates. Kept in `settings.json` in KapeCut's app data folder, beside the recent Projects list.

**Theme**:
The app's palette: Dark (the default), Light (cool grey-white), Coffee (cream and amber), Glass (dark, see-through to the desktop), or System (Dark or Light, whichever the OS uses, followed live). Set in Settings > Appearance. Scenes are not themed.

**Update**:
A newer published GitHub Release of KapeCut, found by the check at launch or Check for updates in Settings > Updates. Windows and Linux download and install it there in two clicks; the Mac opens its Release page (ADR 0006).

**Guide**:
The short step panel the header's Guide button opens: open a folder, connect your Agent, watch the Scenes arrive, reorder them and pin Notes, copy the Fix prompt, Export. Opens by itself on the first launch only.
_Avoid_: tutorial, tour, onboarding

**Recent Projects**:
The Projects listed under Open folder in the Projects menu. Removing one takes it off the list only; the folder is never touched.

**Mascot kit**:
The set of Pixel KAPE pictures (poses, mouth shapes, blinks) that Scenes can place and lip-sync.

## Relationships

- A **Project** has one **Design size** and one fps, and contains one or more **Scenes** in order
- A **Scene** is drawn as **Frames**, each picked by **Scene time**
- An **Export** produces one MP4 at one **Export resolution**
- A **Project** has at most one **Voice**
- A **Note** belongs to one **Project** and has exactly one **Mark**
- A **Project** has zero or more **Audio files**, each placed in **Project time**
- The **Timeline** and the **Scene list** both show the same ordered **Scenes**
- A **Scene** draws zero or more **Video files**, each at a time it derives from **Scene time**
- Deleting a **Scene** deletes the **Notes** whose **Mark** is on it or whose span starts in it; the last **Scene** of a **Project** cannot be deleted
- **Files** lists what is in the **Project** folder; an audio file from **Files** placed on the **Timeline** is an **Audio file**

## Flagged ambiguities

- "Render" was used for both drawing one Frame and producing the MP4. Resolved: **Export** is the MP4, render is one Frame.
- "Mark" was banned as a word for a Note. Resolved: a **Note** is the remark, a **Mark** is what it is pinned to.
- "Claude" named both the product and whatever AI the user runs. Resolved: the **Agent** is any tool the user runs; "Claude" only for Claude Code itself.
- "Light" named the cream theme and "Glass" the cool grey one. Resolved: cream is **Coffee**, cool grey is **Light**, **Glass** is the see-through one.
- A Note's span was "Scene time". Resolved: spans are in **Project time**, so one span can cross a cut. It still follows its start Scene when Scenes are re-ordered (ADR 0003, #48).
