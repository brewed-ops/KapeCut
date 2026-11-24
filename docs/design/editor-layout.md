# Editor layout (approved 2026-11-22, ticket #10)

Picked by Kenneth on the plan canvas [PLAN-editor.html](PLAN-editor.html) (open it in a browser, pick
"A. Everything open" to see the approved mock in every state).

| Choice | Pick |
|---|---|
| Direction | **A. Everything open**: Scene list left, viewer centre, Notes list right, Timeline across the bottom |
| Timeline | **Tall**: bigger Scene strips, one lane per Audio file (two shown) |
| Where a Note is typed | **Popover at the Mark**, beside the Frame |
| Export | **Popover under the Export button**, 720p / 1080p / 1440p / 4K with pixel sizes, unsupported sizes greyed with the reason |

Superseded grid (2026-11-23, #66): the left column now runs the full height and the Timeline sits beside it, under
the viewer and Notes; the viewer window fills its column with the picture centred. See
[claude-connect.md](claude-connect.md) and [sketch-2026-11-23.png](sketch-2026-11-23.png).

Every UI ticket of #9 (#13 Scene list, #14 Timeline, #15 / #17 Notes, #18 audio lanes, #4 Export picker) builds
its part of this mock. Sizes in the mock are at a 1440 x 900 window and come from `tokens.css`; the empty state
(no Project open) and the Scene error state are part of the layout too.

Header: logo, Project name with Design size / fps / Scene count, Open Project, encoder status, amber EXPORT.
Viewer title bar: Scene number + file, reload status. Transport: back, play, forward, Note (key N), mute,
Project time / total, Frame number, Scene + Scene time.
