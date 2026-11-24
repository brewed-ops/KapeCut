# Look: ink + amber + grain

Kenneth, 2026-11-22: "The design should be like this." Reference: `docs/design/reference-look.png` (the Vibe Ops
course hero). On his say this overrides the white + blue KAPE rule for this app.

Every value lives in `src/renderer/styles/tokens.css`; the names below are its variables. A new colour or size goes
there as a variable before any UI uses it.

- Ground: warm ink `--bg` with the fine grain tile (`src/renderer/styles/grain.png`) over it. Panels one step
  lighter: `--panel`, `--panel-2`.
- One accent: amber `--accent`. Used on the main action, the key words of a headline, the active file or tab, and
  small mono labels. Nothing else is coloured.
- Text: cream `--text`, muted `--muted`, dim `--dim`.
- Type: Archivo Black (`--display`) for headlines, heavy and tight; a clean sans (`--sans`) for body; mono
  (`--mono`) in small caps with wide tracking for eyebrows and labels.
- Panels are windows: thin 1 to 2 px frame `--frame`, `--radius` corners, a title bar with three dots (first dot
  amber) and a mono title. Windows may overlap.
- Main button: solid amber, dark text, heavy caps, small arrow.
- Pixel KAPE stands beside the windows, not inside a card.
- Colour stays flat: no glow, no gradient on text, no second accent colour.

A working page in this exact look, with the tokens and the grain tile embedded:
`C:\Users\kvill\Downloads\matt-pocock-skills-map.html` (Kenneth's machine).

## Light

Settings > Appearance > Theme picks Dark (the default), Light or System (#114). Light is the same tokens again under
`:root[data-theme='light']` in `tokens.css`: warm paper `--bg`, panels a step lighter (`--panel`) and darker
(`--panel-2`), ink `--text`. The grain stays, lighter (`--grain-blend`: soft-light instead of overlay). Nothing else
changes: same type, same single amber.

- The amber darkens (`#965400`) so it reads as text at 5:1 on the paper and still carries `--bg` text on the main
  button.
- `--scrim` (behind the Settings panel) and `--shadow` (under floating panels) are tokens too, lighter in Light.
- The preload sets `data-theme` on `<html>` before the first paint, and main paints the window's ground the same `--bg`
  (`BACKGROUND` in `src/main/settings.ts`, held equal by its test), so neither theme flashes the other. System follows
  the OS live.

Settings itself: `docs/design/settings-reference.png` is the structure it follows (left nav, `Settings / <section>`
header with Close, cards of rows: label and one line left, control right), drawn in these tokens. It is the one panel
without the three-dot title bar: a modal over the windows, not one of them.
