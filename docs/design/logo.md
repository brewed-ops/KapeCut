# KapeCut logo (#69, 2026-11-23)

**Style line:** a flat geometric mark in the app's ink + amber + cream tokens (`#12100E`, `#F0A726`, `#F6F2EA`), solid
shapes, readable as a silhouette at 16 px, paired with the Archivo Black "Kape**Cut**" wordmark. **Forbidden:**
gradients, glow, 3D, emoji, clip-art, film strip / clapperboard / scissors, anything like CapCut's logo.

## Files

| File | What |
|---|---|
| `resources/logo/kapecut-mark.svg` | The mark on its ink tile (rx 14 of 64). The app icon is drawn from this |
| `resources/logo/kapecut-logo.svg` | Mark (no tile) at the wordmark's cap height + wordmark, for dark grounds. The wordmark is live text in Archivo Black (weight 900, no web font request): without the font installed it falls back to a black-weight sans |
| `resources/logo/kapecut-{16..512}.png`, `kapecut.ico` | Rendered by `node scripts/render-icons.mjs` (Playwright Chromium). The .ico packs 16-256 as PNG entries. Rerun it after editing the mark SVG and commit what it writes |
| `src/renderer/index.html` header | The mark inline (no tile), 0.72 em tall so it stands on the wordmark's baseline at cap height. The heading's accessible name stays "KapeCut" |
| `src/main/index.ts` | BrowserWindow `icon`: `kapecut.ico` on Windows, `kapecut-256.png` elsewhere |

The K's path data lives in three places (mark SVG, logo SVG, header). Edit all three together:
`src/renderer/logo.test.ts` fails when they differ or when an SVG uses a colour that is not in `tokens.css`.

**PNG or .ico on Windows:** BrowserWindow accepts a PNG and the taskbar shows it, but Windows then gets the 256 px
image for both its small and big icon and shrinks it at draw time, read back with `WM_GETICON` on 2026-11-23. With
the .ico it gets the image at the system's own sizes (`SM_CXSMICON` / `SM_CXICON`: 16 and 32 at 100% scaling, 20 and
40 at 125%), all rendered from the mark. `src/e2e/logo.e2e.ts` asserts the small one is the system's size.
An installer will still need the .ico for the exe's own icon.

## Candidates

Check sheet: [logo-check.png](logo-check.png). Each candidate at 64 / 32 / 24 / 16 px on ink, on its tile over cream,
beside the wordmark in a header crop, and as a one-colour 16 px silhouette.

| | Idea | 16 px silhouette reads as | Verdict |
|---|---|---|---|
| A bracket cut | Two frame corners with a cream cut through them | the "open in new window" / external-link glyph; the cut turns to mush | Rejected |
| B bean cut | A coffee bean (KAPE) cut in two, halves slid apart | a slashed circle: "disabled" / empty set | Rejected |
| C K bracket | A bar and a code bracket `<` that make a K, all amber | a K: clear | Close second |
| D frame slice | A frame cut on the diagonal, top half slid off | a square: the app's own Maximise button | Rejected |
| E K bracket cream | C with the bar in cream | a K: clear | **Picked**, with the cut widened |

## The pick: E, the cut K

A cream bar (the cut, like a playhead on the Timeline) and an amber code bracket `<` (Claude writes every Scene as
code), with a gap between them, read together as K for KapeCut. Why it wins:

- The only family whose 16 px silhouette is a letter, not a UI glyph (play, pause, power, search, link, maximise).
- Two colours split the same way the wordmark does: cream "Kape", amber "Cut".
- Nothing like CapCut's ribbon-C mark, and no film or scissors.
- The gap was widened from 3 to 6 units of 64 so it still shows as a cut at 16 px (about 1.5 px).
