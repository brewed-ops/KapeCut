# 0004 The app writes only project.json's `audio` list (and deletes Scenes); drops copy files in

**project.json stays Claude's file, with two exceptions.** The Timeline adds, moves and removes Audio files, and those edits are `audio` in project.json. The page sends main the whole new list, never the file. Main reads project.json as it is on disk, refuses to write over one that is broken now, sets `audio`, runs the merged file through `parseProject`, checks every Audio file stays inside the Project after following links (`staysUnder`), and writes it with a temp file and rename (`writeOwned`, as for notes.json). Every other key stays as Claude wrote it; the file is re-indented. Writes run one after another, so the last edit wins.

**A second exception: deleting a Scene (#17).** The page sends main a Scene's index and file name, never a path. Main
checks project.json still lists that file at that index, refuses the last Scene of a Project (and a delete while an
Export writes its file; the page turns the trash off for the whole Export), writes `scenes` without it the same way as
`audio`, then moves the Scene's page to the OS trash (`shell.trashItem`, never an erase). A failed move puts project.json
back. Only a plain `.html` file inside the Project is moved, and only when no other entry still names it; a hand-edited
entry naming anything else loses only the entry. The move is marked as the
app's own (`markLanded`), so like the write it is not Claude activity (ADR 0005). The page then drops the Notes Marked on
that Scene or whose span starts in it (ADR 0003), matched against the list main checked.

**Only external writes reload.** As with notes.json, main drops a watcher event when project.json holds exactly what the app last wrote. If the file had changed since the app's own last write (Claude edited it, or this is the first write of the session), the write still merges into Claude's version and main tells the page to read the file again, so Claude's change is not lost on screen. Shortcut, as in ADR 0003: a Claude write landing between main's read and its rename is overwritten.

**A drop copies, never moves or overwrites.** Files dropped on the window come to main as paths only through the preload's `webUtils.getPathForFile` (a real OS drop; Scenes cannot reach the bridge, ADR 0003). One dropped folder opens as a Project, as before. Files of any kind are copied to the top of the Project with `COPYFILE_EXCL`; a taken name gets `-2`, `-3`... A file already inside the Project is not copied again. Over 1 GB is refused. Main cannot tell a dropped path from one the page made up, so a page taken over by a Scene could copy any readable file into the Project, where the Project's own pages can read it. The take-once bridge (ADR 0003) is what stops that, as it already does for opening a dropped folder.

**Sound files reload no Scene.** Scenes draw; the app plays every sound. A saved audio file that is not on the Timeline only refreshes Files, so dropping one in never pauses playback or reopens the Scene pages. A Scene that reads a sound file itself is not picked up when that file changes.

Considered: the page writing project.json itself (it would overwrite Claude's edits made since it last read the file) and a separate `audio.json` (two files for Claude to keep in step).
