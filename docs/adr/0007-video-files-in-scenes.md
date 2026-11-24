# 0007 Video files in Scenes: KapeCut decodes, the Scene draws

Extends ADR 0001. A Scene can draw a Video file from its Project folder Frame-exact:

```html
<script src="/kc-video.js"></script>
<script>
  const speaker = kcVideo('speaker.mp4') // a path relative to the Scene page, inside the Project folder
  window.ready = speaker.ready // then speaker.duration, .width, .height are set
  window.renderAt = async (t) => ctx.drawImage(await speaker.frameAt(t), 0, 0, 1080, 1920)
</script>
```

`frameAt(t)` resolves to a `VideoFrame`: the Video file's Frame showing at `t` seconds (the last one starting at or
before `t`; before the first, the first; past the end, the last). The same `t` gives the same Frame in any order, so
the viewer, a scrub and Export agree. KapeCut owns the Frame: it closes it on the next `frameAt` of that Video file or
when the page goes, so a Scene draws it inside the `renderAt` that asked and never keeps it.

`kc-video.js` is a classic script, so `kcVideo` exists while the Scene's own classic script runs. It hands the URL to
the KapeCut page around the Scene, which decodes with mediabunny (as Export encodes with it, ADR 0002): one decoder per
Video file, walked forward Frame by Frame and restarted from a keyframe on a jump back or more than 3 s ahead, one call
at a time. The file is fetched through `kapecut://app/project/`, so the path check that guards every Project file
(`fileUnder`) guards it too.

Considered: `<video>` in the Scene. `kapecut://` is not a streaming scheme, so it never loads; made one, seek plus
`drawImage` drew black Frames and `requestVideoFrameCallback` never fired during Export. Browser seeking is not a
Frame-exact source.

Out of scope: a Video file's sound. Stock talking-head videos ship silent; sound comes in as an Audio file. Outside
KapeCut (the skill's still and final checks in a plain browser) `/kc-video.js` does not load; the skill ships a
`<video>` stand-in for those checks, good enough for a still, never for Export.
