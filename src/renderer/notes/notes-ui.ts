import { kapecut } from '../bridge'
import { $, errorText, HOLD } from '../dom'
import { icon } from '../icons'
import type { Size } from '../viewer/project'
import { frameAt } from '../viewer/project-time'
import type { SceneLayout } from '../viewer/scene-layout'
import { addNote, deleteNote, editNote, mergeNotes, notesOnScene, parseNotes, readNotes, spanAt, spanOf, type Box, type Note, type NotesFile, type Point, type Range } from './notes'

type Here = Pick<Note, 'scene' | 'sceneTime' | 'time' | 'frame'>
type Marks = Required<Pick<Note, 'point' | 'box' | 'stroke' | 'range'>>
type Only<K extends keyof Marks> = Pick<Marks, K> & { [O in Exclude<keyof Marks, K>]?: undefined }
/** Exactly one Mark. */
type Mark = Only<'point'> | Only<'box'> | Only<'stroke'> | Only<'range'>
/** What one save puts on disk: the new list, and a Note picture to write (bytes) or delete (null). `enters`: the Note
 * whose row (added) or check (done) grows in once the save lands. */
type Write = { next: NotesFile; image?: [number, Uint8Array | null]; enters?: { n: number; was: 'added' | 'done' } }
/** A Note on the Timeline: a marker at `start`, or a bar to `end` for a span. In Project time. */
export type TimelineMarker = { n: number; done: boolean; start: number; end?: number; draft?: boolean }

type Options = {
  size: Size
  fps: number
  /** The Frame at Project time t, by default the one on screen. */
  here(t?: number): Here
  /** Its Scene canvas, or null when that Scene is broken. */
  canvas(): HTMLCanvasElement | null
  /** Where the Scenes sit in Project time now: a Note's time, its flag, the Scenes a span covers. */
  layout(): SceneLayout
  frame(): number
  pause(): void
  /** True while an Export runs: the Scene page on screen may hold an Export Frame, not the playhead's. */
  paused(): boolean
  seek(t: number): void
  /** The Notes or the span being drawn changed: the Timeline redraws its marks. */
  changed(): void
  /** Copies the fix prompt for these open Notes, by number. True once it is on the clipboard. */
  copyPrompt(open: number[]): Promise<boolean>
}

const PAUSED = 'Notes wait for the Export'
const NEAR = 4 // screen px: a drag shorter than this is a click, so a point
const STEP = 1 / 400 // of the Frame's longest side: a pencil point closer than this to the last one is dropped
const SVG = 'http://www.w3.org/2000/svg'
const kindOf = (m: Mark) => (m.box ? 'box' : m.stroke ? 'stroke' : m.range ? 'span' : 'point')

/**
 * Notes: point, box and pencil marks over the Frame, spans picked on the Timeline, the popover to type one, the Notes
 * list, and notes.json + notes/ on disk.
 */
export function wireNotes(o: Options) {
  const [marks, list, empty, status, noteBtn, penBtn] = ['marks', 'note-list', 'notes-empty', 'notes-status', 'note', 'pen'].map($)
  const pop = $('note-pop') as HTMLFormElement
  const text = pop.querySelector('textarea')!
  /** Open, or opening: a popover shrinking shut counts as closed. */
  const popOpen = () => !pop.hidden && !pop.classList.contains('closing')
  // Hidden once the shrink ends, or is cut off (a parent hidden mid-shrink never sends transitionend). Opacity 0: a
  // late cancel from a reversed shrink that has since closed again leaves it shrinking.
  pop.ontransitionend = pop.ontransitioncancel = (e) => {
    if (e.target === pop && e.propertyName === 'opacity' && pop.classList.contains('closing') && getComputedStyle(pop).opacity === '0') pop.hidden = true
  }
  let popAt = '' // the Mark the popover belongs to, in the viewer
  const { w, h } = o.size
  let file: NotesFile = parseNotes(null)
  let readable = false // notes.json unread or unreadable: never write over it
  let adding: false | 'note' | 'pen' = false // note: click, drag a box or a span on the Timeline; pen: draw a stroke
  let drag: { at: Point; x: number; y: number; far?: boolean } | undefined // far: it has moved NEAR px at some point
  let stroke: Point[] | undefined // the pencil stroke being drawn
  let span: Range | undefined // the span being picked, or waiting for its text
  let keyFrom: number | undefined // the Frame [ marked as a span's first, while ] is awaited
  let draft: { here: Here & Pick<Note, 'scenes'>; mark: Mark; frame: HTMLCanvasElement | null } | undefined
  let editing: number | undefined
  let preview: HTMLElement | undefined
  let hideDone = false
  let fresh: Write['enters'] // read by the save's own render only
  let copied: { until: ReturnType<typeof setTimeout>; of: string } | undefined // "Copied" while these open Notes are what it copied
  const toldEl = $('notes-told')
  let told: ReturnType<typeof setTimeout> | undefined
  /** What a Note action did, for a moment in the title bar in place of "notes.json": no list below it moves. */
  const tell = (s: string) => {
    toldEl.textContent = s
    clearTimeout(told)
    told = setTimeout(() => (toldEl.textContent = ''), HOLD) // emptied, so a screen reader hears only the news
  }
  const emptyHtml = empty.innerHTML
  const hideBtn = $('hide-done')
  const copyBtn = $('copy-prompt') as HTMLButtonElement
  const openNotes = () => file.notes.filter((n) => !n.done).map((n) => n.n)

  const say = (s: string) => (status.textContent = s)
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  // A done Note's pin is a check.
  const pinEl = (n: number, done = false) => {
    const pin = Object.assign(document.createElement('span'), { className: done ? 'pin done' : 'pin' })
    if (!done) pin.textContent = String(n)
    else {
      pin.innerHTML = icon('checkmark') // a fixed string, never Note text
      pin.setAttribute('role', 'img')
      pin.setAttribute('aria-label', `Note ${n} done`)
    }
    return pin
  }
  const pinAt = (n: number, p: Point, done = false) => {
    const pin = pinEl(n, done)
    return Object.assign(pin.style, { left: pct(p.x, w), top: pct(p.y, h) }), pin
  }
  // The Frame mark of a point, box or stroke. A span has none: it shows on the Timeline.
  // A done Note's box or stroke is fixed, so it no longer covers the picture: only its check pin stays.
  const markEl = (n: number, m: Mark, done = false) => {
    if (done) return pinAt(n, anchor(m), true)
    if (m.box) {
      const box = Object.assign(document.createElement('div'), { className: 'box' })
      Object.assign(box.style, { left: pct(m.box.x, w), top: pct(m.box.y, h), width: pct(m.box.w, w), height: pct(m.box.h, h) })
      box.append(pinEl(n))
      return box
    }
    if (m.stroke) {
      const el = Object.assign(document.createElement('div'), { className: 'stroke' })
      const svg = document.createElementNS(SVG, 'svg')
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      svg.setAttribute('preserveAspectRatio', 'none') // the marks layer has the Frame's aspect ratio already
      const line = document.createElementNS(SVG, 'polyline')
      line.setAttribute('points', m.stroke.map((p) => `${p.x},${p.y}`).join(' '))
      svg.append(line)
      el.append(svg, pinAt(n, m.stroke[0]))
      return el
    }
    return pinAt(n, m.point ?? anchor(m), done)
  }
  const timeOf = (n: Note) => o.layout().noteTime(n)
  /** Where a span is today: it follows its start Scene and keeps its length (NaN while that Scene is gone). */
  const spanNow = (n: Note) => n.range && spanAt(n.range, timeOf(n))
  /** Its Mark today, for its label: a span as drawn while its Scene is gone. */
  const markOf = (n: Note) => {
    const { point, box, stroke, range } = n
    const now = spanNow(n)
    return { point, box, stroke, range: now && Number.isFinite(now.start) ? now : range } as Mark // parseNotes ensures exactly one
  }
  // Where a Note's number and popover sit on the Frame. A span has no spot on the Frame: the middle.
  const anchor = (m: Mark) => m.point ?? m.box ?? m.stroke?.[0] ?? { x: w / 2, y: h / 2 }
  const onFrame = (n: Note) => !n.range && frameAt(timeOf(n), o.fps) === o.frame()
  const inSpan = ({ start, end }: Range) => frameAt(start, o.fps) <= o.frame() && o.frame() < frameAt(end, o.fps)
  /** The Notes the list, the Frame and the Timeline show: all, or the open ones with Hide done on. */
  const shown = () => file.notes.filter((n) => !(hideDone && n.done))

  /** Marks of the Notes on the Frame on screen. Runs on every draw of the transport. */
  const draw = () => {
    if (keyFrom !== undefined) {
      span = spanOf(keyFrom, o.frame(), o.fps) // the arrows grow the span
      o.changed()
    }
    const notes = shown()
    marks.replaceChildren(...notes.filter(onFrame).map((n) => markEl(n.n, markOf(n), n.done)), ...(preview ? [preview] : []))
    list.querySelectorAll('li').forEach((li, i) => {
      const n = notes[i]
      li.classList.toggle('here', !!n && (n.range ? inSpan(spanNow(n)!) : onFrame(n)))
    })
  }
  const showDraft = (m: Mark) => {
    preview = m.range ? undefined : markEl(file.next, m)
    preview?.classList.add('draft')
    draw()
  }

  // Any mode change drops a half-made gesture, so a box drag never lands as a stroke or a cancelled span as a Note.
  const setAdding = (on: typeof adding) => {
    const had = span
    adding = on
    drag = stroke = preview = span = keyFrom = undefined
    if (had) o.changed()
    draw()
    marks.classList.toggle('adding', !!on)
    noteBtn.setAttribute('aria-pressed', String(on === 'note'))
    penBtn.setAttribute('aria-pressed', String(on === 'pen'))
  }
  const closePop = () => {
    // A hidden textarea keeps focus and would swallow the next N; hand focus back to the Note button.
    if (pop.contains(document.activeElement)) noteBtn.focus()
    // It shrinks back into its Mark (app.css) and is hidden once the shrink ends; at once when nothing shows yet.
    // inert: an invisible, shrinking form must not take Tab or Enter.
    if (!pop.hidden) pop.classList.add('closing'), (pop.inert = true)
    if (getComputedStyle(pop).opacity === '0') pop.hidden = true
    draft = editing = undefined
    setAdding(false) // also takes the draft span off the Timeline
  }
  const toggle = (mode: 'note' | 'pen') => {
    if (adding === mode) return setAdding(false)
    if (o.paused()) return tell(PAUSED)
    if (!readable) return say('Notes are off until notes.json can be read')
    if (popOpen()) return
    o.pause()
    setAdding(mode)
  }

  // The popover sits beside the Mark, kept inside the viewer, and grows out of the Mark.
  const openPop = (title: string, value: string, at: Point) => {
    const view = pop.parentElement!.getBoundingClientRect()
    const frame = marks.getBoundingClientRect()
    const x = frame.left - view.left + (at.x / w) * frame.width
    const y = frame.top - view.top + (at.y / h) * frame.height
    const was = popAt
    popAt = `${x},${y}`
    pop.hidden = false
    const left = Math.max(0, Math.min(x + 20, view.width - pop.offsetWidth))
    const top = Math.max(0, Math.min(y + 14, view.height - pop.offsetHeight))
    // Mid-shrink at the same Mark it reverses from the live scale; at another Mark it is hidden first (the read
    // applies it), so it grows from there instead of jumping across.
    if (pop.classList.contains('closing') && was !== popAt) (pop.hidden = true), pop.offsetWidth, (pop.hidden = false)
    pop.classList.remove('closing')
    pop.inert = false
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${x - left}px ${y - top}px` })
    $('note-pop-title').textContent = title
    text.value = value
    text.focus()
  }
  const label = (n: number, at: Pick<Here, 'scene' | 'sceneTime'>, m: Mark) =>
    `Note ${n} · ${at.scene} · ${at.sceneTime.toFixed(2)}s · ${kindOf(m)}` +
    (m.range ? ` ${m.range.start.toFixed(2)}-${m.range.end.toFixed(2)}s` : '')

  // A copy of the Frame on screen at Design size, taken when the Mark is placed, before anything can redraw it.
  const copyFrame = () => {
    const c = o.canvas()
    if (!c) return null
    const out = Object.assign(document.createElement('canvas'), { width: w, height: h })
    out.getContext('2d')!.drawImage(c, 0, 0, w, h)
    return out
  }

  // The copied Frame with the Mark and its number drawn on it, so Claude sees what the user saw. Drawn at save time,
  // when the Note's number is final.
  async function picture(frame: HTMLCanvasElement, mark: Mark, n: number) {
    const out = Object.assign(document.createElement('canvas'), { width: w, height: h })
    const g = out.getContext('2d')!
    g.drawImage(frame, 0, 0)
    const css = getComputedStyle(document.documentElement)
    const [accent, ink] = ['--accent', '--bg'].map((v) => css.getPropertyValue(v).trim())
    const r = Math.max(11, Math.round(Math.max(w, h) / 80))
    g.strokeStyle = accent
    g.lineWidth = Math.max(3, r / 4)
    if (mark.box) g.strokeRect(mark.box.x, mark.box.y, mark.box.w, mark.box.h)
    if (mark.stroke) {
      g.lineCap = g.lineJoin = 'round'
      g.beginPath()
      for (const p of mark.stroke) g.lineTo(p.x, p.y)
      g.stroke()
    }
    const at = anchor(mark)
    g.beginPath()
    g.arc(at.x, at.y, r, 0, Math.PI * 2)
    g.fillStyle = accent
    g.fill()
    g.lineWidth = r / 4
    g.strokeStyle = ink
    g.stroke()
    g.fillStyle = ink
    g.font = `${r}px ${css.getPropertyValue('--display')}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(n), at.x, at.y)
    const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/png'))
    return blob && new Uint8Array(await blob.arrayBuffer())
  }

  // A span is a stretch of Project time, not a Frame: no picture, and it is recorded at its start. Over a cut, it also
  // records the Scenes it covers, so a re-order that splits them can flag it.
  const place = (mark: Mark) => {
    if (o.paused()) return (setAdding(false), tell(PAUSED)) // a mode left on from before the Export
    const crossed = mark.range && o.layout().scenesIn(mark.range)
    const here = { ...o.here(mark.range?.start), ...(crossed && crossed.length > 1 && { scenes: crossed }) }
    draft = { here, mark, frame: mark.range ? null : copyFrame() }
    setAdding(false)
    span = mark.range // shows on the Timeline while its text is typed
    o.changed()
    showDraft(mark)
    openPop(label(file.next, here, mark), '', anchor(mark))
  }

  // One write or reload at a time. Each write is merged with notes.json as it is on disk right then (mergeNotes), so
  // neither a quick second edit nor Claude's last write is undone. Resolves true once on disk.
  let writing: Promise<unknown> = Promise.resolve()
  const save = (change: (f: NotesFile) => Write | Promise<Write>) =>
    (writing = writing.then(async () => {
      let ok = false
      try {
        // Numbered past Claude's next too, so a new Note never takes a number Claude's file already handed out.
        const mine = await change({ ...file, next: Math.max(file.next, parseNotes(await readNotes()).next) })
        const [n, png] = mine.image ?? []
        if (n && png) await kapecut.notes.image(n, png) // the picture lands before notes.json points at it
        // Read again after the slow part (the picture), right before writing.
        // shortcut: a Claude write landing between this read and main's rename is overwritten (ADR 0003); add a
        // compare-and-swap in main if a lost done ever shows up. A locked file (readNotes asks again) is often Claude
        // mid-write, so that window is likeliest right then.
        const merged = mergeNotes(file, mine.next, await readNotes())
        await kapecut.notes.write(JSON.stringify(merged, null, 2) + '\n')
        if (n && png === null) await kapecut.notes.image(n, null)
        file = merged
        ok = true
        fresh = mine.enters
        say('')
      } catch (e) {
        say(`Could not save notes.json: ${errorText(e)}`)
      }
      renderList()
      fresh = undefined // entered once, in this render: any other render draws it still
      return ok
    })) as Promise<boolean>

  let submitting = false // a double Enter or double click on Save adds the Note once
  pop.addEventListener('submit', async (e) => {
    e.preventDefault()
    const said = text.value.trim()
    if (!said || submitting) return
    submitting = true
    const now = new Date().toISOString()
    let saved = true
    let added: number | undefined
    try {
      if (editing !== undefined) {
        const n = editing
        saved = await save((f) => ({ next: editNote(f, n, { text: said }, now) }))
      } else if (draft) {
        const { here, mark, frame } = draft
        saved = await save(async (f) => {
          const n = (added = f.next)
          // A failed capture (broken Scene, tainted canvas) costs only the picture: the Note is saved without `image`.
          const png = frame && (await picture(frame, mark, n).catch(() => null))
          const image = png ? `notes/note-${n}.png` : undefined
          return { next: addNote(f, { text: said, ...here, ...mark, image }, now).file, image: png ? [n, png] : undefined, enters: { n, was: 'added' } }
        })
      }
    } finally {
      submitting = false
    }
    if (saved && added) tell(`Note ${added} added`)
    if (saved) closePop() // a failed write keeps the popover and the typed text, so Save can be tried again
  })
  $('note-cancel').addEventListener('click', closePop)
  noteBtn.addEventListener('click', () => toggle('note'))
  penBtn.addEventListener('click', () => toggle('pen'))

  const toDesign = (e: PointerEvent): Point => {
    const r = marks.getBoundingClientRect()
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)))
    return { x: clamp(((e.clientX - r.left) / r.width) * w, w), y: clamp(((e.clientY - r.top) / r.height) * h, h) }
  }
  const boxOf = (a: Point, b: Point): Box => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  })
  const dragged = (e: PointerEvent) => !!drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= NEAR
  marks.addEventListener('pointerdown', (e) => {
    if (!adding || e.button !== 0) return
    marks.setPointerCapture(e.pointerId)
    drag = { at: toDesign(e), x: e.clientX, y: e.clientY }
    if (adding === 'pen') stroke = [drag.at]
  })
  marks.addEventListener('pointermove', (e) => {
    if (!drag || !(drag.far ||= dragged(e))) return
    const p = toDesign(e)
    if (!stroke) return showDraft({ box: boxOf(drag.at, p) })
    const last = stroke.at(-1)!
    if (Math.hypot(p.x - last.x, p.y - last.y) < STEP * Math.max(w, h)) return // keeps notes.json small on a long stroke
    stroke.push(p)
    showDraft({ stroke })
  })
  marks.addEventListener('pointerup', (e) => {
    if (!drag) return
    const [s, far] = [stroke, drag.far || dragged(e)]
    const end = toDesign(e)
    if (s && far && (end.x !== s.at(-1)!.x || end.y !== s.at(-1)!.y)) s.push(end) // where the pen lifted, even if close
    const at = drag.at
    drag = stroke = undefined
    if (!s) return place(far ? { box: boxOf(at, end) } : { point: at })
    if (far) return place({ stroke: s })
    preview = undefined // a tap draws no line; the pencil stays on for another try
    draw()
  })
  // A pen or touch gesture the OS takes back drops the drag; adding mode stays on for another try.
  marks.addEventListener('pointercancel', () => {
    drag = stroke = preview = undefined
    draw()
  })

  // The transport's own keys (space, arrows) live in main.ts and skip a focused textarea, so typing a Note never plays.
  window.addEventListener('keydown', (e) => {
    if (e.target === text) {
      if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), pop.requestSubmit())
      else if (e.key === 'Escape') closePop()
      return
    }
    if (e.key === 'Escape' && (adding || popOpen())) return closePop()
    const mode = ({ n: 'note', p: 'pen' } as const)[e.key.toLowerCase() as 'n' | 'p']
    if (mode && !e.ctrlKey && !e.metaKey && !e.altKey && !popOpen()) return (e.preventDefault(), toggle(mode))
    // Keyboard spans: [ on the first Frame, the arrows to the last, ] there.
    if (e.key === '[' && adding === 'note') return (keyFrom = o.frame()), draw()
    if (e.key === ']' && keyFrom !== undefined) return place({ range: spanOf(keyFrom, o.frame(), o.fps) })
    // Keyboard only: Enter puts a point in the middle of the Frame. preventDefault keeps a focused button from also clicking.
    if (e.key === 'Enter' && adding === 'note') (e.preventDefault(), place({ point: { x: Math.round(w / 2), y: Math.round(h / 2) } }))
  })

  // Rebuilt on every load, save and Scene reload (a Scene's new length can flag a Note).
  const renderList = () => {
    const allHidden = file.notes.length > 0 && !shown().length
    empty.hidden = !readable || (file.notes.length > 0 && !allHidden)
    empty.innerHTML = allHidden ? 'Every Note is done. Turn off <b>Hide done</b> to see them.' : emptyHtml
    hideBtn.setAttribute('aria-pressed', String(hideDone))
    copyLabel()
    list.replaceChildren(
      ...shown().map((note) => {
        const li = document.createElement('li')
        li.innerHTML =
          '<button class="jump"><span class="pin"></span><span class="text"><span class="said"></span><span class="eyebrow"></span></span></button>' +
          `<div class="acts"><button class="done"></button><button class="edit">${icon('edit')}Edit</button><button class="del">${icon('delete')}Delete</button></div>`
        li.querySelector('.pin')!.replaceWith(pinEl(note.n, note.done))
        li.querySelector('.said')!.textContent = note.text
        const flag = o.layout().flag(note, spanNow(note))
        li.querySelector('.eyebrow')!.textContent = label(note.n, note, markOf(note)).replace(/^Note \d+ · /, '') + (flag && ` · ${flag}`)
        li.classList.toggle('done', note.done)
        li.classList.toggle('flagged', !!flag)
        if (fresh?.n === note.n) (fresh.was === 'added' ? li : li.querySelector('.pin')!).classList.add('fresh')
        const [jump, done, edit, del] = li.querySelectorAll('button')
        done.innerHTML = note.done ? icon('arrow-undo') + 'Undo' : icon('checkmark') + 'Done'
        done.setAttribute('aria-label', `${note.done ? 'Undo' : 'Set'} Note ${note.n} done`)
        // Toggles what is saved by then, so a quick second click undoes the first instead of repeating it. A Note Claude
        // has deleted meanwhile changes nothing and says nothing.
        done.addEventListener('click', () => {
          let news = ''
          void save((f) => {
            const had = f.notes.find((x) => x.n === note.n)
            if (!had) return { next: f }
            news = `Note ${note.n} ${had.done ? 'open again' : 'done'}`
            return { next: editNote(f, note.n, { done: !had.done }, new Date().toISOString()), enters: { n: note.n, was: 'done' } }
          }).then((ok) => ok && news && tell(news))
        })
        edit.setAttribute('aria-label', `Edit Note ${note.n}`)
        for (const b of [done, edit, del]) b.disabled = !readable // every save would be refused (say() tells why)
        del.setAttribute('aria-label', `Delete Note ${note.n}`)
        const jumpTo = () => {
          const t = timeOf(note) // today's Scene order, not the order when the list was drawn
          if (Number.isFinite(t)) o.seek(t)
        }
        jump.addEventListener('click', jumpTo)
        edit.addEventListener('click', () => {
          closePop()
          jumpTo()
          editing = note.n
          const m = markOf(note)
          openPop(label(note.n, note, m), note.text, anchor(m))
        })
        del.addEventListener('click', () => {
          if (editing === note.n) closePop()
          void save((f) => ({ next: deleteNote(f, note.n), image: [note.n, null] })).then((ok) => ok && tell(`Note ${note.n} deleted`))
        })
        return li
      }),
    )
    draw()
    o.changed()
  }
  const copyLabel = () => {
    const open = readable ? openNotes().length : 0 // an unreadable notes.json has no count to trust
    copyBtn.disabled = !readable || !open
    const shows = copied?.of === openNotes().join() && !copyBtn.disabled // the open Notes changed or none are left: the count wins
    copyBtn.classList.toggle('copied', shows)
    copyBtn.querySelector('span')!.textContent = shows ? 'Copied' : `Copy Prompt${open ? ` · ${open} open` : ''}`
  }

  hideBtn.addEventListener('click', () => ((hideDone = !hideDone), renderList()))
  $('notes-foot').hidden = false
  // Queued behind any save, so a Done or Delete clicked just before is in the list it copies.
  copyBtn.addEventListener('click', () =>
    void writing.then(async () => {
      const open = openNotes()
      if (!(await o.copyPrompt(open))) return
      clearTimeout(copied?.until)
      copied = { until: setTimeout(() => ((copied = undefined), copyLabel()), HOLD), of: open.join() }
      copyBtn.classList.remove('copied'), copyBtn.offsetWidth // a second copy pops its check in again
      copyLabel()
    }),
  )

  /** notes.json from disk: at open, and each time someone else (Claude) writes it. Queued behind any write. */
  const reload = () =>
    (writing = writing.then(async () => {
      try {
        const disk = await readNotes()
        // Merged like a write (the user owns the list and text, Claude the done it changed), so an open edit keeps its
        // Note. At open, or after an unreadable file, there is nothing of the user's to keep: the file is taken as is.
        file = readable ? mergeNotes(file, file, disk) : parseNotes(disk)
        if (!readable) say('') // clears only the read error, never a save error still true
        readable = true
      } catch (e) {
        readable = false
        say(`notes.json could not be read (${errorText(e)}). Fix or move it; Notes stay off until then`)
      }
      renderList()
    }))
  reload()

  return {
    draw,
    reload,
    renderList,
    /** False while notes.json is unread or unreadable: every save would be refused. */
    writable: () => readable,
    /** Every shown Note on the Timeline (a Note whose Scene is gone has no time, so no marker), and the span being picked. */
    markers: (): TimelineMarker[] => [
      ...shown()
        .map((n) => ({ n: n.n, done: n.done, start: timeOf(n), end: spanNow(n)?.end }))
        .filter((m) => Number.isFinite(m.start)),
      ...(span ? [{ n: file.next, done: false, ...span, draft: true }] : []),
    ],
    /** The Notes that go when Scene `index` of `order` is deleted. */
    onScene: (index: number, order: string[]) => notesOnScene(file.notes, index, order),
    /** Scene `index` of `order` was deleted: its Notes go too, then their pictures. */
    dropScene(index: number, order: string[]) {
      let gone: Note[] = []
      return save((f) => {
        gone = notesOnScene(f.notes, index, order)
        if (gone.some((n) => n.n === editing)) closePop()
        return { next: { ...f, notes: f.notes.filter((n) => !gone.includes(n)) } }
      }).then(async (ok) => {
        for (const n of ok ? gone.filter((n) => n.image) : []) await kapecut.notes.image(n.n, null).catch((e) => say(`Could not delete notes/note-${n.n}.png: ${errorText(e)}`))
      })
    },
    /** A drag on the Timeline picks a span instead of only seeking. */
    picksSpan: () => adding === 'note' && !popOpen(),
    /** A Timeline drag is over Frames a to b. Ignored once Note mode is left (Escape, N) mid-drag. */
    spanDraft(a: number, b: number) {
      if (adding !== 'note') return
      span = spanOf(a, b, o.fps)
      o.changed()
    },
    /** The drag ended on Frame b: the span gets its Note. */
    spanDone(a: number, b: number) {
      if (adding === 'note') place({ range: spanOf(a, b, o.fps) })
    },
    /** The drag was a click, or the OS took it back: no span. */
    spanCancel() {
      span = undefined
      o.changed()
    },
  }
}
