# 0003 notes.json keeps `next`; Scenes cannot reach the app's bridge

**`next`.** `notes.json` is `{ version: 1, next, notes }`. `next` is the number the next Note gets. Spec #9 lists only `version` and `notes`, but then deleting the highest Note and reopening the Project would hand its number out again, and Claude's "Note 3" would mean two different requests. A file without `next` still opens: the app uses the highest `n` + 1. Claude keeps `next` when it rewrites the file and never lowers it.

**`image` may be missing.** A Note's picture is drawn from the Scene's canvas. When that fails (the Scene is broken, or it drew a cross-origin image and the canvas is tainted), the Note is saved without `image` rather than lost. Claude reads `image` only when it is there. A span Note (`range`) never has one: it marks a stretch of
Project time, not a Frame. Its `scene`, `sceneTime`, `time` and `frame` are those of `range.start`.

**A span follows its start Scene** (#48, Kenneth's option C; it replaces "a span stays in Project time"). Like every
other Note it is about content, so when Scenes are re-ordered, or a Scene before it changes length, it moves with
`scene` + `sceneTime` and keeps its length, `range.end - range.start`. Where it is today is **computed on read**, never
written back: the app does not rewrite `range` after a re-order (no write for Claude's re-order to race, and `time` and
`frame` of every Note are left as drawn the same way). So `range` on disk is the span as the user drew it; Claude and
the app both place it at the start Scene's start + `sceneTime`, for `range.end - range.start` seconds. A span over a cut
also stores `scenes`, the Scenes it covered when drawn, in order from `scene`; it is missing when the span is inside one
Scene, and a file from before #48 without it still opens (that span is never flagged for neighbours). When those Scenes
are no longer next to each other in that order, the Note is flagged "Scenes around this span changed". A span whose
start Scene is gone is flagged "Scene not in the Project" and has no bar, like any Note whose Scene is gone. Keeping
the length means a span can now run further into the next Scene when its own Scene is shortened; that alone is not
flagged (only a start past its Scene's end, or an end past the Project end, is). When a Project lists one Scene file
twice, a span over a cut sits on the copy its `scenes` still follow, so it stays on the cut it was drawn on; other Notes
take the first copy, as before. `scenes` out of step with `scene` (a hand edit) flags the Note rather than making
`notes.json` unreadable. Spans saved before #48 also move with their start Scene now, unflagged, since they have no
`scenes`; only a few days of spans (#17) predate the rule.
Considered: rewriting `range` on disk after each re-order (an app write on every project.json change, racing Claude's
own writes, and a `range` that no longer agrees with the Note's `time` and `frame`).

**Each write is merged with the file on disk, by Note number** (`mergeNotes`, #16). Before writing, the app reads `notes.json` again. Claude owns `done` on the Notes whose `done` changed on disk since the app last read or wrote the file; the user owns the list itself (adds and deletes), text, Marks and every other `done`. A Note numbered at or past the app's `next` was added by someone else and is kept; a lower number the app no longer has was deleted by the user and stays deleted, even when a stale copy brings it back. The higher `next` wins. A file the app cannot read, a newer `version` included, is never written over: the save fails with a message.

**Only Claude's writes reload the Notes.** Main remembers what the app last wrote to `notes.json` and drops a watcher event when the file still holds exactly that, so the app's own writes reload nothing and cannot loop. Any other change reaches the page, which reloads the Notes (never a Scene) through the same merge, so a Note Claude dropped or re-worded stays the user's, and an edit open on it is kept. At open, or after an unreadable file, the file is taken as it is. Shortcut: a Claude write landing between the app's last merge read (taken after the Note picture is written) and its rename is overwritten; the window is one IPC round trip.

**A Note past its Scene's end stays on that Scene.** When Claude shortens a Scene, a Note whose Scene time is now past the end is flagged in the list and pinned on the Scene's last Frame, never on the next Scene's first, so it never reads as a request about another Scene. A span Note is flagged the same way when its start is past its Scene's end, and once its end (where it sits today) runs past the last Frame of the video.

**The bridge is taken once.** Scenes are same-origin frames of the app page (ADR 0001: the viewer calls `renderAt` inside them), so a Scene can read `parent.kapecut`. The preload exposes only `kapecut.take()`. The app's first module calls it before any Scene frame exists, and every later call throws. A Scene from someone else's Project can therefore not open folders, write `notes.json` (the file Claude reads as the user's requests), start an Export, or put a prompt of its own on the clipboard for the user to paste into Claude Code. Main still checks every Notes write (a whole Notes list, a real PNG, size caps) in case the page itself is tampered with through a Scene.

Considered: a cross-origin Scene frame (breaks the synchronous `renderAt` calls the viewer and Export rely on), and checking `event.senderFrame` in main as the guard against Scenes (a Scene calling `parent.kapecut.*` runs in the top frame, so main cannot tell it apart).

**The window stays on the app page, and main answers only it (#126).** A Scene could also send the whole window to another page (`top.location`, a Project file included) or open a new window on the app page (`window.open`). The preload would run there with a bridge nobody has taken. So main blocks any top-frame navigation off `kapecut://app/index.html` and every `window.open`. As a backstop, every main handler goes through `src/main/app-sender.ts`, which refuses any sender but the window's top frame on the app page. Neither replaces take-once: a Scene calling `parent.kapecut` from the app page still looks like the app.
