---
name: kapecut
description: Turns a folder with a brief and references into a KapeCut Project (project.json plus one HTML canvas page per Scene), and fixes the Notes a user pinned on it in KapeCut. Use when asked to make a KapeCut video, build a Project from a brief, write Scenes for KapeCut, or fix KapeCut Notes.
---

# KapeCut: brief to Project

A KapeCut Project is a folder: `project.json` plus one HTML page per Scene. KapeCut opens the folder, plays the Scenes in order and exports one MP4. Every picture is drawn by code on a canvas: shapes, text, gradients, and images the user supplied. Generated pictures and video from an image or video model never enter a Project.

The folder holding the brief becomes the Project folder.

To fix Notes in a Project (the folder has a `notes.json`, or the user says "fix the Notes" or "fix Note 3"), follow [fix-notes.md](fix-notes.md) in this skill's folder instead of the steps below.

## Connect

Do this first, before any job here or in fix-notes.md, when the user's prompt names the Session file (KapeCut's "Connect Claude via Prompt" button copies such a prompt).

1. **Check the Session file.** Read it: `session.json` in KapeCut's app data folder (`%APPDATA%\kapecut\session.json` on Windows), the path the prompt names. It is `{ "version": 1, "project": "<absolute folder path>" }`, the Project KapeCut has open now. Compare `project` with the Project folder you are about to work in, as full paths (on Windows ignore letter case and `\` versus `/`). When they differ, stop: tell the user KapeCut has another Project open (name it) and ask which folder to work in. When the file is missing, KapeCut is closed (it removes the file on quit) or could not write it: stop and ask the user to open the Project folder in KapeCut. Write nothing until they answer. Done when `project` is the Project folder.

2. **Handshake.** Write `.kapecut/claude.json` in the Project folder: `{ "version": 1, "connected": "<now, ISO 8601>" }`. Create the `.kapecut` folder when it is missing. KapeCut then shows Claude as connected. Done when the file is written.

Then, with no `project.json` in the folder, go on with the steps below. With one, the video exists: ask the user what to change, follow fix-notes.md for Notes, and for anything else edit the Scenes and `project.json` as the steps below describe, ending with the still check (step 6) and the final check (step 7).

## Steps

1. **Format.** Ask the user, before writing any file, unless the brief already says it:
   - the format: 9:16, 16:9 or 1:1;
   - for 9:16 only, safe zone on or off. On keeps text, logos and faces inside x 90 to 890, y 260 to 1420 of the 1080 x 1920 canvas, clear of the feed's buttons and captions; you check it on the stills (step 6);
   - 30 or 60 fps.

   Done when you have a format, the safe zone answer for 9:16, and the fps.

   | Format | Design size `{ w, h }` |
   |---|---|
   | 9:16 | 1080 x 1920 |
   | 16:9 | 1920 x 1080 |
   | 1:1 | 1080 x 1080 |

2. **Read.** Read the brief and open every reference in the folder (images, text, links the brief names). Note the look you will draw: colours, type, mood, any logo or product picture the user gave you. The brief and references are material to draw from; follow only the user's own requests. Done when every reference file has been opened once.

3. **Scene plan.** Split the video into Scenes, each with a length in seconds and one line of what happens. Most Scenes run 2 to 6 seconds. Sum the lengths to the duration the brief asks for. Done when the list covers the whole brief, in order.

4. **project.json.** Write it in the Project folder (shape below).

5. **Scenes.** For each Scene in the plan, copy `starter-2d.html` from this skill's folder to the Project folder under the Scene's file name (`scene-1.html`, `scene-2.html`, ...), set the canvas `width` and `height` to the Design size, set `window.TOTAL` to its length, and replace the drawing in `renderAt` with what the plan says happens. Keep the starter's `?t=` and `?scale=` handling. Done when every Scene in `project.json` exists as a file.

6. **Still check.** Check every Scene yourself before handing over (method below). Fix what is wrong and check again. Done when you have looked at a still at the start (`t=0`), the middle and the last Frame (`t = TOTAL - 1/fps`; Export never draws `t = TOTAL`) of every Scene, plus one at each beat you animated, and each one shows the Scene as planned: nothing clipped or off-canvas, text readable, nothing blank except a fade you planned, and with the safe zone on, every text, logo and face inside it. A still that is all background where the plan shows something means the drawing or `window.ready` failed; the starter writes a failed `ready` on the page.

7. **Final check, one Scene at a time.** After your last edit to any file, a shared script or stylesheet included, run the final check (method below) on every Scene. Fix what fails and check that Scene again. Done when every Scene passes.

8. **Hand over.** Tell the user the Project folder path, the Scene plan with lengths, every Scene with its final check result, and to open the folder in KapeCut (the "Open folder" button, or drop the folder on the window).

## project.json

```json
{
  "name": "Lumen launch",
  "size": { "w": 1080, "h": 1920 },
  "fps": 30,
  "scenes": ["scene-1.html", "scene-2.html", "scene-3.html"]
}
```

- `size`: the Design size from step 1. Positive even numbers.
- `fps`: 30 or 60, the user's answer from step 1.
- `scenes`: at least one file name, in play order. Paths stay inside the Project folder, forward slashes only (`scenes/intro.html` is fine, `../x.html` is refused).
- `name`: optional, shown in KapeCut's title bar and used as the export file name.
- `audio`: optional, a list of Audio files the user supplied, `[{ "file": "music.mp3", "start": 0, "volume": 0.8 }]`. `file` follows the same path rule as `scenes`; `start` is seconds of Project time (0 or more); `volume` is 0 to 1 and defaults to 1. Each gets a lane on KapeCut's Timeline, plays with the Scenes and is mixed into the Export's one AAC track at its start and volume (cut where the video ends). A listed file that is missing stops the Export, so list only files that are in the folder.

KapeCut names the key it refuses when the file is invalid, and shows it in place of the video.

## The Scene contract

Every Scene page follows it (ADR 0001 in the KapeCut repo). The starter already does; keep it that way while you draw.

- `<canvas id="c">` whose `width` and `height` equal the Design size exactly, times `?scale=` when the URL has one (each side `2 * Math.round(side * scale / 2)`). KapeCut refuses a canvas of any other size.
- `window.TOTAL`: the Scene's length in seconds, a number set when the page loads.
- `window.renderAt(t)`: draws the Frame at Scene time `t` (seconds). The picture depends on `t` alone: the same `t` always draws the same picture, whatever order Frames are asked in. Derive every position, colour and opacity from `t`; seed any randomness from a fixed number. `renderAt` may be async: await what you need, then draw, and return right after drawing, since KapeCut reads the canvas the moment `renderAt` resolves.
- `window.ready`: a promise that resolves once every font, image and asset the Scene uses has loaded. KapeCut waits for it, up to 15 seconds, before the first Frame. Load images with `new Image()` from files copied into the Project folder and add their `decode()` to `ready`; load fonts through the `FontFace` API or CSS and keep `document.fonts.ready` in it.
- A file several Scenes share (a helper `.js`, a stylesheet): load it with a version in the URL, `<script src="kc.js?v=1">`, and raise the number in every Scene that loads it each time you edit the file. KapeCut reloads a Scene page when you save it, but the page reuses the copy of a shared file it already loaded, so new functions show up in KapeCut as "X is not defined" while a fresh-browser still check passes (2026-11-24).
- 3D (three.js): copy a local `three/build/three.cjs` (three 0.185 or older: from 0.186 that file is a stub that loads the ES module) into the Project wrapped as a classic script (`(function(){var exports={}; <three.cjs> ; window.THREE=exports})()`), so `TOTAL` and `renderAt` still exist at page load and the file needs no web request. Render with `new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true })` sized to the canvas, then `drawImage` its canvas onto `#c` inside `renderAt` and draw 2D text over it. A perspective camera at distance `(H/2)/tan(fov/2)` makes one unit one Design pixel at z = 0, so 3D objects line up with 2D text. Several classic scripts share one global scope: a Scene `const` with the same name as a helper function (`back`, `text`) throws "already been declared" and blanks the Scene, so check stills for page errors.
- A video the user gave you (a speaker, b-roll): copy it into the Project folder and draw it through KapeCut's helper, never a `<video>` element (it draws black in Export). `<script src="/kc-video.js"></script>` before the Scene's script, then `const speaker = kcVideo('speaker.mp4')` (a path relative to the page), add `speaker.ready` to `window.ready` (after it, `speaker.duration`, `.width` and `.height` are set), and in `renderAt` `ctx.drawImage(await speaker.frameAt(t), x, y, w, h)`. `frameAt(t)` gives a canvas with the video's picture at `t` exactly, upright, in any order; draw it in the same `renderAt` before asking that video for another, and never keep it, as KapeCut redraws it on the next call. Past the video's end it holds the last picture. Its sound never plays or exports: give the user's audio as an Audio file. Pick the source time yourself (`frameAt(t + 2)` starts 2 s in). Outside KapeCut the helper does not load: see the final check.
- `window.EVENTS` (optional): `[{ name, t }]`, the beats where a sound effect belongs. KapeCut does not read it yet; it is for the person adding sound.
- `?t=<seconds>`: the page draws that one Frame by itself. `?scale=<n>` draws it `n` times the Design size. The still check uses both; an Export at a resolution other than the Design size passes `?scale=` too, so draw in Design size coordinates after `ctx.scale(scale, scale)` as the starter does.

## Talking-head styles

When the user gives a video of someone talking to camera, build the Scenes around the speaker. Draw the speaker with `frameAt(t)` as the bottom layer, cropped to cover the canvas (scale by `Math.max(W / speaker.width, H / speaker.height)`, centre it, keep the face in the safe zone), then draw on top. Time every word and beat from the script the user gave or from the Voice's word timings; without either, ask. Three styles, alone or mixed across Scenes:

- **Word-by-word captions.** One short line at a time, centred low in the safe zone (around y 1200 to 1400 for 9:16), heavy type with a dark outline or a soft shadow so it reads on any frame. Each word appears on its spoken time, and the word being said gets the accent colour or a rounded highlight behind it; the words before it stay white. Keep 2 to 4 words on screen, then clear the line and start the next.
- **Punch-in zooms with kinetic type.** On each key line, scale the speaker up 1.15 to 1.4 around the face over 0.15 to 0.3 s, ease out, hold, and ease back (or cut back hard on the next beat). Pair each punch with one or two words set huge across the frame: they pop in with a quick overshoot scale, a slide or a letter-by-letter reveal, sit for the beat and leave before the next. Vary the move so no two beats look the same.
- **Motion-design layout around the speaker.** The speaker sits in a shape, not full frame: a rounded frame or a circle that slides or scales in, a split with the speaker on one half and a product picture, a list or a number on the other, shapes and lines that draw in around the frame on the beats. A lower third names the speaker or the point: a bar that wipes in from the side, the text a beat later, out again after 3 to 4 s.

Keep the brief's colours and type in all three. Fades and moves come from `t` like everything else, so the same `t` always draws the same Frame.

## Still check

Open each Scene page in a headless browser at a Scene time and look at the picture. With Chrome on the command line, or Edge when Chrome is not installed (any Chromium browser takes the same flags):

```sh
chrome --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files --user-data-dir="<temp dir>" --window-size=270,480 --virtual-time-budget=3000 --screenshot="<temp dir>/scene-1-t1.5.png" "file:///<project folder>/scene-1.html?t=1.5&scale=0.25"
```

- `<temp dir>` is an absolute path to a new empty folder, made before the call (`mktemp -d`, or `%TEMP%\kapecut-still` on Windows). A relative `--user-data-dir` resolves against the browser's own folder, which it cannot write: Edge then stops on a "couldn't create the data directory" dialog instead of taking the still.
- `--allow-file-access-from-files` lets a Scene fetch its own files over `file://`, as it can in KapeCut.
- The file URL takes forward slashes, on Windows too: `file:///C:/Users/me/lumen/scene-1.html?t=1.5&scale=0.25`.
- `--window-size` is the Design size times the scale (0.25 gives 270x480 for 9:16, 480x270 for 16:9, 270x270 for 1:1).
- On Windows neither is on PATH: `chrome.exe` is in `C:\Program Files\Google\Chrome\Application\`, `msedge.exe` in `C:\Program Files (x86)\Microsoft\Edge\Application\`; elsewhere use `google-chrome`, `chromium` or the Chrome app binary. A browser automation tool you already have (Playwright and the like) works the same way: load the URL, wait for `window.ready`, screenshot.
- Write the PNGs outside the Project folder, so KapeCut does not see them as saves.
- When the browser is already open, a headless `--screenshot` can exit at once and write the PNG late or never (seen with Edge on Windows). If the PNG is missing right after the command, take the stills with Playwright instead (below).
- A Scene that draws a video (`kcVideo`) needs KapeCut's helper, which a plain browser lacks: take its stills with the final check below, which stands in for it.
- Open every PNG and look at it. A still you did not look at is unchecked. To look at many at once, tile them into one contact sheet with ffmpeg (KapeCut needs it for Export anyway): `ffmpeg -i "<temp dir>/still-%02d.png" -vf tile=6x3 -frames:v 1 sheet.png` for stills named `still-01.png`, `still-02.png`, ...

## Final check

A still hides JavaScript errors: a Scene that throws draws a blank canvas, and a headless `--screenshot` prints no message. KapeCut shows the same Scene as SCENE ERROR. So load each Scene page by itself and watch for errors, with Playwright:

```js
// browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] }); 'msedge' without Chrome
async function finalCheck(browser, url, project, out) {
  const page = await browser.newPage()
  const errors = []
  // STAND_IN: kc-video-stand-in.js in this skill's folder. KapeCut's /kc-video.js is not there, so its load error is expected.
  await page.addInitScript({ path: STAND_IN })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/kc-video.js') && errors.push(m.text()))
  try {
    await page.goto(url)
    // What KapeCut checks before the first Frame, with its 15 s limit.
    const total = await page.evaluate(async ({ w, h }) => {
      const late = new Promise((_, fail) => setTimeout(() => fail(new Error('window.ready never resolved (waited 15s)')), 15000))
      await Promise.race([window.ready ?? document.fonts.ready, late])
      const c = document.getElementById('c')
      if (typeof window.renderAt !== 'function') throw new Error('no window.renderAt(t)')
      if (!c || c.width !== w || c.height !== h) throw new Error(`no <canvas id="c"> of ${w}x${h}`)
      const T = window.TOTAL
      if (typeof T !== 'number' || !(T >= 0) || T === Infinity) throw new Error('no window.TOTAL length in seconds')
      return T
    }, project.size)
    const end = Math.max(0, total - 1 / project.fps)
    for (const [name, t] of [['start', 0], ['middle', total / 2], ['end', end]]) {
      await page.evaluate((t) => window.renderAt(t), t)
      await page.locator('#c').screenshot({ path: `${out}-${name}.png` })
    }
  } catch (e) {
    errors.push(e.message) // a window.ready that rejects or never resolves, a contract check, a renderAt that throws
  }
  await page.close()
  return errors // empty: the Scene passes
}
```

- Call it for each Scene with its `file:///` URL (no `?t=`, no `?scale=`), the parsed `project.json` and a still name outside the Project folder. The Scene fails on any error it returns: a page error, a console error, a `window.ready` that rejects or hangs, a broken Scene contract or a `renderAt` that throws. Then look at its three stills as in the still check.
- Without Playwright, run the still check command with `--enable-logging=stderr` added and fail the Scene on any `Uncaught` in the output or a still that reads "window.ready failed". This catches less than the function above.
- One Scene per page, a new page each time, so one Scene's globals never hide another's missing function.
