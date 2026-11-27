import { LAST_SCENE, parseProject, type Audio, type Project, type Size } from './viewer/project'
import { openScene, type SceneWindow } from './viewer/scene'
import { createTransport } from './viewer/transport'
import { frameAt, frameCount } from './viewer/project-time'
import { sceneLayout } from './viewer/scene-layout'
import { follow, rubberband, rulerTicks, unrubberband, zoomAt, zoomed } from './viewer/timeline'
import { createAudio, loadLanes, peaks, wavePath, type Lane } from './viewer/audio'
import { canEncodeVideo, exportVideo } from './export/export-video'
import { DEFAULT_RESOLUTION, exportResolutions, type ExportResolution } from './export/resolution'
import { wireNotes } from './notes/notes-ui'
import { AUDIO_FILE_TYPE, wireFiles } from './files/files-ui'
import { fileKind } from './files/kind'
import { kapecut } from './bridge'
import { $, errorText, toast } from './dom'
import { connectPrompt, fixPrompt } from './claude/connect-prompt'
import { wireClaudeStatus } from './claude/status-ui'
import { wireSettings } from './settings/settings-ui'
import { fillIcons, icon } from './icons'
import { wireSetup } from './setup/setup-ui'
import { ffmpegDetail } from './setup/setup'
import { openVideo } from './video/kc-video'

fillIcons()
Object.assign(window, { kapecutVideo: openVideo }) // what a Scene's /kc-video.js calls (ADR 0007)
const stage = $('stage')
const view = $('view')
const sceneList = $('scene-list')
// The list's one highlight (app.css #scene-list::before) slides to the current row, so it survives the list's rebuild.
const placeHighlight = () => {
  const row = sceneList.querySelector('[aria-current]')?.parentElement
  if (!row) return
  sceneList.style.setProperty('--current-y', `${row.offsetTop}px`)
  sceneList.style.setProperty('--current-h', `${row.offsetHeight}px`)
}
// A row that changes size after (a thumbnail landing, fonts, zoom) moves the rows under it: renderSceneList observes each.
const rowSizes = new ResizeObserver(placeHighlight)

// An overlay, so the Scene frame survives and a later save can still reload it.
function showError(message: string, label = 'Scene error') {
  stage.querySelector('.error')?.remove()
  stage.insertAdjacentHTML('beforeend', '<div class="error"><span class="eyebrow"></span><p></p></div>')
  stage.querySelector('.error .eyebrow')!.textContent = label
  stage.querySelector('.error p')!.textContent = message
}

// Fit the Scene's Design size into the viewer without changing its aspect ratio.
function fit(size: Size, frame: HTMLIFrameElement) {
  const border = 3 // .window frame, 1.5px each side
  // Title bar and transport bar: the window fills its cell (#66), so its own height says nothing about the stage's room.
  // Every other child of the window counts: an overlay added there must go inside the stage or #view instead.
  const chrome = [...stage.parentElement!.children].reduce((h, el) => (el === stage ? h : h + (el as HTMLElement).offsetHeight), border)
  const k = Math.max(0, Math.min((view.clientWidth - border) / size.w, (view.clientHeight - chrome) / size.h))
  stage.style.width = `${size.w * k}px`
  stage.style.height = `${size.h * k}px`
  frame.style.transform = `scale(${k})`
}


// The frameless window's own buttons (the header is the title bar).
$('win-min').onclick = () => void kapecut.window.minimize()
$('win-max').onclick = () => void kapecut.window.toggleMaximize()
$('win-close').onclick = () => void kapecut.window.close()
kapecut.window.onMaximized((maximized) => {
  const label = maximized ? 'Restore' : 'Maximise'
  $('win-max').classList.toggle('restore', maximized)
  $('win-max').setAttribute('aria-label', label)
  $('win-max').title = label
})

const folderName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir

const SET_UP = 'set-up'
// What the Connect prompt asks Claude to do; follows project.json breaking and being fixed under an open Project.
let projectState: Parameters<typeof connectPrompt>[0]['state'] = 'error'
const PROJECT_TMP = /^project\.json\..*\.tmp$/ // temp files of a project.json write, before its rename
// Writing or fixing project.json opens the Project. shortcut: a fresh page, as no Scene is open yet to keep.
const reopenOn = (file: string) => file === 'project.json' && (location.reload(), true)

/**
 * The open Project, null when none is open, or SET_UP when its folder has no project.json yet. Throws a message naming
 * what is wrong with project.json.
 */
async function readProject(current: string | null) {
  if (!current) return null
  showName(folderName(current)) // until project.json gives a name, or fails to
  const res = await fetch('/project/project.json', { cache: 'no-store' })
  if (res.status === 404) return SET_UP
  if (!res.ok) throw new Error(`project.json could not be read (${res.status})`)
  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    throw new Error(`project.json is not valid JSON (${errorText(e)})`)
  }
  const project = parseProject(json)
  return { ...project, name: project.name ?? folderName(current) }
}

function showName(name: string, detail = '') {
  document.title = `${name} - KapeCut`
  $('project').replaceChildren(name, Object.assign(document.createElement('span'), { textContent: detail })) // the detail dimmed
}

type Slot = { file: string; frame: HTMLIFrameElement; total?: number; error?: string; thumb?: string } // total: unknown until it first opens

// A small copy of the Scene canvas as it is now, longest side 192 px (sharp at 2x in the 96 px list slot).
function thumbOf(c: HTMLCanvasElement) {
  const k = 192 / Math.max(c.width, c.height)
  const t = Object.assign(document.createElement('canvas'), { width: Math.round(c.width * k), height: Math.round(c.height * k) })
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height)
  return t.toDataURL()
}
const projectUrl = (file: string) => `/project/${file.split('/').map(encodeURIComponent).join('/')}`

/** session: the Session file's path, which the fix prompt names. */
async function openProject(dir: string, opened: Project & { name: string }, session: string) {
  let project = opened
  let projectError: string | undefined // project.json broke after opening; the last good Scene order keeps playing
  // shortcut: every Scene page stays loaded, so the next one is always preloaded; keep only current + next if long Projects use too much memory.
  const slots = new Map<string, Slot>()
  let layout = sceneLayout([], project.fps)
  let shown: Slot | undefined // the Scene page on screen
  let draws = 0 // bumped per draw, so a slow async draw never shows its page over a later one
  const win = (slot: Slot) => slot.frame.contentWindow as unknown as SceneWindow
  // The Scene's output canvas (ADR 0001), as the DOM element, so it can be drawn from. null when the page has none.
  const canvasOf = (slot: Slot) => win(slot).document.getElementById('c') as unknown as HTMLCanvasElement | null
  const slotAt = (t: number) => {
    const at = layout.locate(t)
    return { ...at, slot: slots.get(at.file)! }
  }
  // The slots are the adapter: they feed each Scene's length or error into the layout.
  const retime = () => (layout = sceneLayout(project.scenes.map((f) => slots.get(f)!), project.fps))
  const show = (slot: Slot) => {
    shown?.frame.classList.remove('current')
    slot.frame.classList.add('current')
    shown = slot
  }

  /** Matches the Scene pages to project.json: drops removed Scenes, adds new ones. Returns the new ones. */
  const sync = () => {
    for (const [file, slot] of slots) if (!project.scenes.includes(file)) (slot.frame.remove(), slots.delete(file))
    if (shown && !slots.has(shown.file)) shown = undefined
    const fresh = [...new Set(project.scenes)]
      .filter((f) => !slots.has(f))
      .map((file) => {
        const frame = Object.assign(document.createElement('iframe'), { width: String(project.size.w), height: String(project.size.h) })
        frame.dataset.scene = file
        stage.prepend(frame) // under the error overlay
        fit(project.size, frame)
        const slot: Slot = { file, frame }
        slots.set(file, slot)
        return slot
      })
    retime()
    return fresh
  }

  // (Re)loads one Scene page and draws Scene time t. ?v= makes each save a fresh fetch. A failure stays with that Scene.
  const load = async (slot: Slot, t: number) => {
    try {
      const src = projectUrl(slot.file)
      const head = await fetch(src, { method: 'HEAD' })
      if (!head.ok) throw new Error(`Scene file ${slot.file} ${head.status === 404 ? 'not found in the Project' : 'could not be read'}`)
      const loaded = new Promise((r) => slot.frame.addEventListener('load', r, { once: true }))
      slot.frame.src = `${src}?v=${Date.now()}`
      await loaded
      // The canvas is the Scene's output (ADR 0001): show it alone at 0,0, as Export does, whatever the page's own CSS.
      slot.frame.contentDocument?.head.insertAdjacentHTML(
        'beforeend',
        '<style>html,body{margin:0!important;overflow:hidden!important}#c{display:block}</style>',
      )
      const w = win(slot)
      const total = (slot.total = (await openScene(w, project.size, t)).total)
      slot.error = undefined
    } catch (e) {
      slot.error = `${slot.file}: ${errorText(e)}`
      slot.thumb = undefined // the Scene list never shows a picture the Scene no longer draws
      return
    }
    // The thumbnail is the Scene's middle Frame, drawn by the Scene itself, then back to the Frame on screen. With a sync
    // renderAt all of it runs before the next paint (awaits are microtasks), so no flash and a WebGL buffer is still there.
    // shortcut: an async renderAt can flash the middle Frame on screen; capture off screen if a real Scene shows it.
    // A failed capture (tainted canvas) costs only the thumbnail: the Scene itself plays and exports.
    try {
      const w = win(slot)
      await w.renderAt!(slot.total! / 2)
      const canvas = canvasOf(slot)
      slot.thumb = canvas ? thumbOf(canvas) : undefined
      await w.renderAt!(Math.min(t, slot.total!))
    } catch {
      slot.thumb = undefined
    }
  }

  // Draws Project time t. At a cut the next Scene page shows only once it has drawn, so no blank Frame shows.
  const render = (t: number) => {
    const { slot, sceneTime, scene } = slotAt(t)
    tl.at(t, scene)
    const me = ++draws
    const item = sceneList.children[scene]?.firstElementChild
    if (item && !item.hasAttribute('aria-current')) {
      sceneList.querySelector('[aria-current]')?.removeAttribute('aria-current')
      item.setAttribute('aria-current', 'true')
      placeHighlight()
    }
    $('scene-name').textContent = slot.file
    notes.draw()
    const problem = projectError ?? slot.error
    if (problem) showError(problem, projectError ? 'Project error' : 'Scene error')
    else stage.querySelector('.error')?.remove()
    if (slot.error) return show(slot)
    if (exporting) return // an Export may be drawing the viewer's own pages, so only the labels move
    const drawn = win(slot).renderAt?.(sceneTime)
    if (slot === shown) return drawn
    return Promise.resolve(drawn).then(() => me === draws && slot.frame.isConnected && show(slot))
  }

  showName(project.name, ` · ${project.fps} fps`)
  const listed = listResolutions(project) // a new Design size or fps reloads the page, so once per open
  $('transport').hidden = false
  $('note-tools').hidden = false
  $('timeline').hidden = false
  new ResizeObserver(() => slots.forEach((s) => fit(project.size, s.frame))).observe(view)
  const audio = createAudio(new AudioContext()) // one per page: switching Projects reloads the page
  const tr = wireTransport(project.fps, render, audio)
  const tl = wireTimeline(project.fps, tr, { list: () => project.audio, edit: (list) => void saveAudio(list) })
  // A Note finds its Frame by Scene + Scene time, so it stays put when Claude re-orders the Scenes; a span by its start.
  const notes = wireNotes({
    size: project.size,
    fps: project.fps,
    here: (t = tr.time) => {
      const { slot, sceneTime } = slotAt(t)
      return { scene: slot.file, sceneTime, time: t, frame: frameAt(t, project.fps) }
    },
    canvas: () => {
      const { slot } = slotAt(tr.time)
      return slot.error ? null : canvasOf(slot)
    },
    layout: () => layout,
    frame: () => tr.frame,
    pause: () => tr.pause(),
    paused: () => viewerPaused,
    seek: (t) => (tr.pause(), tr.seek(t)),
    changed: tl.layoutNotes,
    copyPrompt: (open) => copyPrompt(fixPrompt({ project: dir, session, open })),
  })
  tl.showNotes(notes)
  const mute = $('mute')
  mute.addEventListener('click', () => {
    const on = mute.getAttribute('aria-pressed') !== 'true'
    mute.setAttribute('aria-pressed', String(on))
    audio.mute(on)
  })
  // (Re)decodes every Audio file; keep: only files not decoded yet (a moved or removed lane, a project.json edit). A
  // later call wins, so two quick saves never land out of order; a keep call that overtakes a full one decodes in full,
  // so a sound file saved meanwhile is never played from its old buffer.
  let audioLoads = 0
  let decoded: Lane[] = []
  let fullPending = false
  const loadAudio = async (keep = false) => {
    keep &&= !fullPending
    if (!keep) fullPending = true
    const me = ++audioLoads
    const list = project.audio
    const have = new Map(keep ? decoded.map((l) => [l.file, l]) : [])
    const fresh = await loadLanes(audio.context, list.filter((a) => !have.has(a.file)), projectUrl)
    if (me !== audioLoads) return
    if (!keep) fullPending = false
    for (const l of fresh) have.set(l.file, l)
    const lanes = (decoded = list.map((a) => ({ ...have.get(a.file)!, ...a })))
    audio.setLanes(lanes)
    if (tr.playing) audio.play(tr.time) // decoded while playing: join in at the Frame on screen
    mute.hidden = !lanes.length
    tl.lanes(lanes)
  }
  const isAudio = (file: string) => project.audio.some((a) => a.file === file)
  void loadAudio()
  const files = wireFiles({
    dir,
    scenes: () => project.scenes,
    audio: () => project.audio.map((a) => a.file),
    place: (file) => saveAudio([...project.audio, { file, start: frameAt(tr.time, project.fps) / project.fps, volume: 1 }]),
  })
  // The Timeline's edits: shown at once, then written to project.json by main, which merges them into the file on disk.
  // A re-read keeps the page's own list when an edit was being written or was made while it read: the disk it read may
  // hold an older edit.
  let audioWrites = 0
  let audioEdits = 0
  const saveAudio = async (list: Audio[]) => {
    if (projectError) return files.say('project.json has an error. Fix it, save, then try again') // main would refuse it too
    project = { ...project, audio: list }
    void loadAudio(true)
    void files.refresh()
    audioEdits++
    audioWrites++
    try {
      if (await kapecut.project.setAudio(list)) queueSave('project.json') // changed on disk meanwhile: take it whole
    } catch (e) {
      files.say(errorText(e))
      queueSave('project.json') // the list on disk comes back
    } finally {
      audioWrites--
    }
  }

  // Reloads the given Scene pages and keeps the Project time; the Scene on screen reopens at its own Scene time.
  const reload = (list: Slot[]) =>
    tr.reload(async (t) => {
      try {
        const { slot, sceneTime } = slotAt(t)
        await Promise.all(list.map((s) => load(s, s === slot ? sceneTime : 0)))
      } finally {
        retime() // even after a throw: the list, Notes and Timeline show the lengths and errors the Scenes have now
        renderSceneList() // even after a throw: a stale list would seek by an old Scene index
        notes.renderList() // new Scene lengths and order: flags and labels
        tl.scenes(
          layout.rows().map(({ file, start, end, error }) => ({ file, start, end, thumb: slots.get(file)!.thumb, error: !!error })),
          layout.duration,
        )
      }
      return { total: layout.duration }
    })

  // Rebuilt after every reload; render() then marks the current Scene. Clicking a Scene seeks to its first Frame.
  // The rebuild marks the playhead's Scene itself, so the highlight never drops out (and stays right if a reload threw
  // and render() does not follow); a changed row slides there.
  const renderSceneList = () => {
    const current = layout.locate(tr.time).scene
    const rows = layout.rows()
    sceneList.replaceChildren(
      ...rows.map(({ file, start, len, error }, i) => {
        const { thumb } = slots.get(file)!
        const item = document.createElement('li')
        item.innerHTML =
          '<button><img alt=""><span class="text"><span class="name"></span><span class="eyebrow"></span><span class="badge" hidden>' + icon('error-circle') + 'Scene error</span></span></button>'
        const button = item.firstElementChild as HTMLButtonElement
        if (thumb) button.querySelector('img')!.src = thumb
        button.querySelector('.name')!.textContent = `${String(i + 1).padStart(2, '0')}  ${file}`
        button.querySelector('.eyebrow')!.textContent = `${len.toFixed(2)}s · ${frameCount(len, project.fps)} F`
        button.querySelector<HTMLElement>('.badge')!.hidden = !error
        button.addEventListener('click', () => (tr.pause(), tr.seek(start)))
        if (i === current) button.setAttribute('aria-current', 'true')
        // Shown on the row's hover or focus (app.css). Off for the last Scene and while an Export runs (pauseViewer).
        const del = item.appendChild(Object.assign(document.createElement('button'), { className: 'del', innerHTML: icon('delete') }))
        del.setAttribute('aria-label', `Delete Scene ${file}`)
        del.setAttribute('aria-keyshortcuts', 'Delete Backspace')
        setTrash(del, rows.length)
        del.addEventListener('click', () => askDelete(i, file))
        return item
      }),
    )
    placeHighlight() // rows may have changed height (a Scene error badge)
    rowSizes.disconnect()
    for (const li of sceneList.children) rowSizes.observe(li, { box: 'border-box' }) // the row's whole height, padding too
  }

  // Deleting a Scene (#17): main takes it out of project.json and trashes its page, then the page re-reads project.json
  // and drops the Scene's Notes. Both writes are the app's own, so neither is Claude activity.
  const confirmDelete = $('delete-scene') as HTMLDialogElement
  const deleteStatus = $('delete-scene-status')
  const [okDelete, cancelDelete] = ['delete-scene-ok', 'delete-scene-cancel'].map($) as HTMLButtonElement[]
  // While main works the confirm cannot close or be sent again, so its answer always lands in it, for the Scene it names.
  const lockDelete = (on: boolean) => {
    okDelete.disabled = cancelDelete.disabled = on
    confirmDelete.setAttribute('closedby', on ? 'none' : 'any')
  }
  let deleting: { index: number; file: string } | undefined
  // file: the row's own, so a list about to redraw after Claude's re-order never names another Scene.
  const askDelete = (index: number, file: string) => {
    if (project.scenes[index] !== file) return // the list redraws in a moment
    const n = notes.onScene(index, project.scenes).length
    deleting = { index, file }
    $('delete-scene-text').textContent = `Delete ${file}${n ? ` and its ${n} Note${n === 1 ? '' : 's'}` : ''}?`
    // Refused up front when it could not finish: main would refuse a broken project.json, and Notes that cannot be
    // written could not go with their Scene.
    const why = projectError ? 'project.json has an error. Fix it, save, then try again' : notes.writable() ? '' : 'notes.json could not be read, so its Notes could not go with it. Fix notes.json first'
    deleteStatus.textContent = why
    confirmDelete.showModal()
    okDelete.disabled = !!why
  }
  cancelDelete.addEventListener('click', () => confirmDelete.close())
  okDelete.addEventListener('click', async () => {
    const d = deleting
    if (!d) return
    let order: string[]
    lockDelete(true)
    try {
      order = await kapecut.project.deleteScene(d.index, d.file)
    } catch (e) {
      deleteStatus.textContent = errorText(e) // still open: Delete can be tried again
      queueSave('project.json') // the list as main left it, whatever went wrong
      return
    } finally {
      lockDelete(false)
    }
    deleting = undefined
    confirmDelete.close()
    queueSave('project.json')
    void notes.dropScene(d.index, order) // the order main checked, so a Claude re-order meanwhile picks no other Scene's Notes
  })
  // Delete (Backspace on a Mac keyboard) on a focused Scene row, or on the current Scene when nothing has focus. Its trash
  // button opens the confirm, so a disabled one (the last Scene, an Export) does nothing.
  window.addEventListener('keydown', (e) => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const row = e.target === document.body ? sceneList.querySelector('[aria-current]')?.parentElement : (e.target as Element).closest?.('#scene-list > li')
    if (!row) return
    e.preventDefault()
    row.querySelector<HTMLButtonElement>('.del')?.click()
  })

  let queue = reload(sync())
  // One reload at a time; saves landing meanwhile collapse into one pass over every file saved.
  const saved = new Set<string>()
  const applySaves = async () => {
    const changed = [...saved]
    saved.clear()
    if (changed.includes('project.json')) {
      try {
        const [writing, edits] = [audioWrites, audioEdits]
        const next = (await readProject(dir))!
        if (next === SET_UP) throw new Error(`No project.json in ${folderName(dir)}`) // deleted: the last good Project keeps playing
        // shortcut: a new Design size or fps reopens the page; rebuild in place if that turns out common.
        if (next.size.w !== project.size.w || next.size.h !== project.size.h || next.fps !== project.fps) return location.reload()
        project = writing || audioWrites || edits !== audioEdits ? { ...next, audio: project.audio } : next
        projectError = undefined
        projectState = 'ready'
      } catch (e) {
        projectError = errorText(e)
        projectState = 'error'
      }
      showName(project.name, ` · ${project.fps} fps`)
      void files.refresh() // the Scenes it leaves out and the Audio files it adds
    }
    const fresh = sync()
    const others = changed.filter((f) => f !== 'project.json')
    if (changed.includes('project.json') || others.some(isAudio)) void loadAudio(!others.some(isAudio))
    // A saved file no Scene is named after (a script, an image) may be used by any Scene. Dotfiles and .git
    // (editor swap files, git) are not. Folders never arrive: watchProject drops them.
    const shared = others.some((f) => !slots.has(f) && !isAudio(f) && !/(^|\/)\./.test(f))
    await reload(shared ? [...slots.values()] : [...new Set([...fresh, ...others.filter((f) => slots.has(f)).map((f) => slots.get(f)!)])])
  }
  const queueSave = (file: string) => {
    if (encoding && !encoding.savesWaiting) showProgress(Object.assign(encoding, { savesWaiting: true }))
    if (!saved.size) queue = queue.catch(() => {}).then(applySaves).catch((e) => showError(errorText(e)))
    saved.add(file)
  }
  kapecut.onFileSaved((file, own) => {
    // Notes never change a Scene. Main sends notes.json only when someone else (Claude) wrote it.
    if (file === 'notes.json') return void notes.reload()
    if (/^notes(\.json\.|\/note-\d+\.png)/.test(file)) return // the Notes' pictures, and temp files of a notes.json write
    if (PROJECT_TMP.test(file)) return // temp files of the app's own project.json write
    void files.refresh() // a file added, changed or deleted
    // A deleted Scene's page leaving: its own project.json reload drops it, so reloading it now would flash its error.
    // An Export's MP4 (own too) still reloads, as a Scene may draw it.
    if (own && fileKind(file) !== 'video') return
    if (fileKind(file) === 'audio' && !isAudio(file)) return // a sound file off the Timeline: only the Files panel shows it
    queueSave(file)
  })
  exportButton.onclick = () => {
    if (exporting) {
      exporting.abort()
      kapecut.export.abort().catch(() => {}) // also stops ffmpeg if the remux has started; the export's own catch reports
      return
    }
    exportButton.disabled = true
    exportQueued = true
    tr.pause()
    pauseViewer(true)
    // In the reload queue, so a save waits for the Export instead of swapping the Scene page under it.
    queue = queue
      .catch(() => {})
      .then(() => {
        exportQueued = false // exportProject sets exporting from here, or refuses
        if (projectError) return refuse('project.json has an error. Fix it, save, then Export') // its Scene list is not the one on screen
        const resolution = resolutions.find((r) => r.label === picker.value)
        if (!resolution) return refuse('Pick an Export resolution')
        return exportProject(
          project,
          // The length the viewer lays out; a broken Scene has no page, so Export refuses it.
          layout.rows().map(({ file, len, error }) => ({ file, frame: error ? null : slots.get(file)!.frame, total: len })),
          resolution,
        )
      })
      .finally(() => (pauseViewer(false), tr.seek(tr.time))) // the viewer shows the transport's Frame again
  }
  await Promise.all([queue, listed])
  exportButton.disabled = false
}

const picker = $('resolution') as HTMLSelectElement
let resolutions: ExportResolution[] = []
// Every Export resolution, 1080p picked; one this machine cannot encode is listed greyed out with the reason.
async function listResolutions(project: Project) {
  resolutions = await exportResolutions(project.size, project.fps, canEncodeVideo)
  picker.replaceChildren(
    ...resolutions.map((r) =>
      Object.assign(document.createElement('option'), {
        value: r.label,
        textContent: `${r.label}${r.unsupported ? ` · ${r.unsupported}` : ''}`,
        title: `${r.w}x${r.h}`,
        disabled: !!r.unsupported,
      }),
    ),
  )
  const usable = resolutions.filter((r) => !r.unsupported)
  // None usable: the default stays picked, greyed out, and preflight says why on Export.
  picker.value = (usable.find((r) => r.label === DEFAULT_RESOLUTION) ?? usable[0])?.label ?? DEFAULT_RESOLUTION
  picker.disabled = false
}

const exportButton = $('export') as HTMLButtonElement
const exportLabel = $('export-label')
const exportStatus = $('export-status')
// Fills the Export button while Frames encode: a transform, so the bar never re-lays out the header.
const exportProgress = $('export-progress')
// Done is the one status in amber, whichever code wrote the text before or after it.
const EXPORTED = 'Exported '
new MutationObserver(() => exportStatus.classList.toggle('done', !!exportStatus.textContent?.startsWith(EXPORTED))).observe(exportStatus, { childList: true })

const COPY_FAILED = 'Could not copy the prompt: '
// Connect and the fix prompt: a failed copy says why in the header's message line, beside the other "could not"
// messages, and the next good copy clears it (only it, never an Export message).
const copyPrompt = (text: string) =>
  kapecut.clipboard.write(text).then(
    () => {
      toast('Prompt copied')
      if (exportStatus.textContent?.startsWith(COPY_FAILED)) exportStatus.textContent = ''
      return true
    },
    (e) => ((exportStatus.textContent = COPY_FAILED + errorText(e)), false),
  )
let exporting: AbortController | null = null
// Export clicked but still waiting in the reload queue (a Scene reload ahead of it): a Project switch is refused already.
let exportQueued = false
// The picker is locked while an Export runs: the resolution was read when it started.
function setExporting<C extends AbortController | null>(ctl: C) {
  picker.disabled = !!ctl
  $('export-paused').hidden = !ctl // render() draws nothing from here (#123), so the stage says why
  exporting = ctl
  return ctl
}
// From the Export click until it ends or is refused (#123): play, step, their keys and new Notes are off. Seeks still
// move the playhead and labels. The click's seek redraws the playhead's Frame after.
let viewerPaused = false
function pauseViewer(on: boolean) {
  viewerPaused = on
  for (const id of ['play', 'back', 'fwd', 'note', 'pen']) ($(id) as HTMLButtonElement).disabled = on
  for (const b of sceneList.querySelectorAll<HTMLButtonElement>('.del')) setTrash(b, sceneList.children.length)
}
/** A Scene row's trash, of `scenes` rows: off, saying why, for the last Scene and while an Export runs (main refuses both too). */
function setTrash(b: HTMLButtonElement, scenes: number) {
  b.disabled = viewerPaused || scenes < 2
  b.title = scenes < 2 ? LAST_SCENE : viewerPaused ? 'Delete Scenes once the Export is done' : 'Delete Scene (Delete)'
}
const refuse = (why: string) => void ((exportButton.disabled = false), (exportStatus.textContent = why))
// Set while Frames encode. A save that lands then waits in the reload queue; the status says so, or it looks lost.
let encoding: { done: number; savesWaiting: boolean } | null = null
const showProgress = (e: typeof encoding) => {
  if (!e) return
  exportProgress.style.transform = `scaleX(${e.done})`
  exportStatus.textContent = `Exporting ${Math.floor(e.done * 100)}%${e.savesWaiting ? ' · saves apply after Export' : ''}`
}

type ExportPages = { scenes: { canvas: HTMLCanvasElement; renderAt: (t: number) => unknown; total: number }[]; close: () => void }

// A Scene page's output canvas and renderAt (ADR 0001), or null when it has lost either.
function drawable(frame: HTMLIFrameElement, total: number) {
  const canvas = frame.contentDocument?.querySelector<HTMLCanvasElement>('canvas#c')
  const renderAt = (frame.contentWindow as unknown as SceneWindow | null)?.renderAt
  return canvas && typeof renderAt === 'function' ? { canvas, renderAt, total } : null
}

/**
 * Exports every Scene, in Project time order, as one MP4 at the given Export resolution. `frame` is the viewer's page
 * for that Scene, null when it has a Scene error.
 */
async function exportProject(project: Project & { name: string }, list: { file: string; frame: HTMLIFrameElement | null; total: number }[], resolution: ExportResolution) {
  const broken = list.find((s) => !s.frame || !drawable(s.frame, s.total))
  if (broken) return refuse(`Scene ${broken.file} is not open. Fix its Scene error, save, then Export`)
  exportButton.disabled = true // no second Export while the checks and the save dialog are open
  const ctl = setExporting(new AbortController()) // from here a Project switch is refused, the checks and save dialog included
  let path: string | null = null
  let pages: ExportPages | undefined
  try {
    if (await preflight(project, resolution)) {
      // At the Design size the viewer's own pages draw the Export, as they already are; any other size opens each Scene
      // again at ?scale=. Either way every page is open before the first Frame, so a save never lands mid-file.
      if (resolution.scale === 1) pages = { scenes: list.map((s) => drawable(s.frame!, s.total)!), close: () => {} }
      else {
        exportStatus.textContent = `Opening Scenes at ${resolution.w}x${resolution.h}`
        exportLabel.textContent = 'Cancel' // a Scene may take up to 15 s to open
        exportButton.disabled = false
        pages = await openForExport(project.size, list.map((s) => s.file), resolution, ctl.signal)
        exportLabel.textContent = 'Export'
        exportButton.disabled = true
        // Clears only its own line: a refusal shown meanwhile (a Project switch) stays.
        if (exportStatus.textContent?.startsWith('Opening Scenes')) exportStatus.textContent = ''
      }
      // Checked before the save dialog, so the user never picks a file for nothing. The lengths are the pages' own.
      if (!pages.scenes.some((s) => frameCount(s.total, project.fps) > 0)) throw new Error('The video has no length. Set window.TOTAL in a Scene, save, then Export')
      path = await kapecut.export.begin(project.name.replace(/[\\/:*?"<>|]/g, '-') + '.mp4', project.audio) // a name Windows accepts
    }
  } catch (e) {
    exportStatus.textContent = ctl.signal.aborted ? 'Export cancelled' : `Export failed: ${errorText(e)}`
  } finally {
    exportButton.disabled = false
    if (!path) {
      setExporting(null)
      exportLabel.textContent = 'Export'
      pages?.close()
    }
  }
  if (!path || !pages) return
  exportLabel.textContent = 'Cancel'
  try {
    encoding = { done: 0, savesWaiting: false }
    exportProgress.style.transform = 'scaleX(0)'
    exportProgress.hidden = false
    await exportVideo({
      scenes: pages.scenes,
      fps: project.fps,
      sink: kapecut.export,
      signal: ctl.signal,
      onProgress: (done) => showProgress(encoding && Object.assign(encoding, { done })),
    })
    encoding = null
    ctl.signal.throwIfAborted()
    exportStatus.textContent = 'Finishing MP4'
    await kapecut.export.finish()
    exportStatus.textContent = EXPORTED + path
  } catch (e) {
    await kapecut.export.abort().catch(() => {}) // the status below matters more than a leftover temp file
    exportStatus.textContent = ctl.signal.aborted ? 'Export cancelled' : `Export failed: ${e instanceof Error ? e.message : e}`
  } finally {
    encoding = null
    exportProgress.hidden = true
    setExporting(null)
    exportLabel.textContent = 'Export'
    pages.close()
  }
}

/** Says why an Export cannot start, or returns true. */
async function preflight(project: Project, resolution: ExportResolution) {
  const say = (text: string) => ((exportStatus.textContent = text), false)
  const media = await kapecut.media()
  if (!media.ffmpeg || !media.ffprobe) return say(`${ffmpegDetail(media)}. Install it, then restart KapeCut`)
  await kapecut.export.check(project.audio)
  if (!(await canEncodeVideo(resolution.w, resolution.h, project.fps))) return say(`This machine cannot encode H.264 at ${resolution.w}x${resolution.h} ${project.fps} fps`)
  return true
}

/**
 * Opens each Scene again, one after another, in a hidden page of its own at ?scale=, so the Export draws every Frame at
 * the Export resolution rather than upscaling. Each page reads its Scene file as it is now. close() removes them.
 * shortcut: every Scene has two pages while exporting (WebGL Scenes hold two contexts each; Chromium keeps about 16);
 * open one at a time during the encode if long WebGL Projects lose contexts, once saves can be held back for it.
 */
async function openForExport(size: Size, files: string[], resolution: ExportResolution, signal: AbortSignal): Promise<ExportPages> {
  const frames: HTMLIFrameElement[] = []
  const close = () => frames.forEach((f) => f.remove())
  // Cancel stops the wait at once; a page still opening is removed and its own timeout settles unseen.
  const cancelled = new Promise<never>((_, fail) => signal.addEventListener('abort', () => fail(new Error('Export cancelled')), { once: true }))
  const open = async () => {
    const scenes = []
    for (const file of files) {
      signal.throwIfAborted()
      const frame = Object.assign(document.createElement('iframe'), { className: 'export', width: String(resolution.w), height: String(resolution.h) })
      frame.dataset.export = file
      frames.push(frame)
      document.body.append(frame)
      const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }))
      frame.src = `${projectUrl(file)}?scale=${resolution.scale}&v=${Date.now()}` // ?v=: never a cached copy from before a save
      await loaded
      // One at a time, so each Scene gets openScene's whole 15 s however many there are.
      const { total } = await openScene(frame.contentWindow as unknown as SceneWindow, size, 0, resolution.scale).catch((e) =>
        Promise.reject(new Error(`${file}: ${errorText(e)}`)),
      )
      const scene = drawable(frame, total)
      if (!scene) throw new Error(`${file}: Scene lost its canvas#c or renderAt`)
      scenes.push(scene)
    }
    return scenes
  }
  try {
    return { scenes: await Promise.race([open(), cancelled]), close }
  } catch (e) {
    close()
    throw e
  }
}


function wireTransport(fps: number, render: (t: number) => unknown, audio: ReturnType<typeof createAudio>) {
  const scrub = $('scrub') as HTMLInputElement
  const play = $('play')
  const [time, frameNo] = [$('time'), $('frame-no')]
  scrub.step = String(1 / fps)
  const fail = (t: number, e: unknown) => {
    tr.pause()
    play.classList.remove('playing') // an async failure lands after draw already set the icon
    play.setAttribute('aria-label', 'Play')
    showError(`renderAt(${t.toFixed(2)}) failed: ${errorText(e)}`)
  }
  const tr = createTransport({
    fps,
    total: 0,
    // A suspended context's clock stands still, so scheduling now would start the sound late: wait, then join in.
    onPlay: (t) => (audio.context.state === 'suspended' ? void audio.context.resume().then(() => tr.playing && audio.play(tr.time)) : audio.play(t)),
    onStop: () => audio.stop(),
    draw(t) {
      // A Scene that throws stops playback instead of leaving it stuck on Pause.
      try {
        Promise.resolve(render(t)).catch((e) => fail(t, e))
      } catch (e) {
        fail(t, e)
      }
      scrub.max = String(tr.end)
      scrub.value = String(t)
      time.textContent = `${t.toFixed(2)}s`
      frameNo.textContent = `F ${tr.frame}`
      play.classList.toggle('playing', tr.playing)
      play.setAttribute('aria-label', tr.playing ? 'Pause' : 'Play')
    },
  })
  const toggle = () => (tr.toggle(), tr.seek(tr.time)) // seek refreshes the play icon
  play.addEventListener('click', toggle)
  $('back').addEventListener('click', () => tr.step(-1))
  $('fwd').addEventListener('click', () => tr.step(1))
  scrub.addEventListener('input', () => (tr.pause(), tr.seek(Number(scrub.value))))
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement) return // typing a Note
    const action = { Space: toggle, ArrowLeft: () => tr.step(-1), ArrowRight: () => tr.step(1) }[e.code]
    if (!action) return
    e.preventDefault() // stops a focused button or slider from also acting on the key
    if (viewerPaused) return // an Export runs
    if (!(e.code === 'Space' && e.repeat)) action() // holding space would flicker play / pause
  })
  return tr
}


type Strip = { file: string; start: number; end: number; thumb?: string; error: boolean } // start, end in Project time
const PLAYHEAD_HALF = 7 // px: half the playhead's widest part, its 12 px head, plus a pixel
const WAVE_PER_SECOND = 50 // waveform buckets per second of audio: sharp enough at the Timeline's usual zooms

// The Timeline: one strip per Scene in Project time under a ruler and a lane of Note markers, one lane per Audio
// file under them. Click or drag anywhere seeks (while adding a Note, a drag also picks a span); zoom by the buttons,
// + / - or Ctrl + wheel. Playing or seeking from elsewhere scrolls it to keep the playhead in view.
// Audio lanes move by drag or arrow keys (a Frame a press) and leave by their remove button or Delete; an audio file
// dragged from the Files panel lands at the drop's Frame. `audio` is project.json's list as the page has it, and the way to change it.
function wireTimeline(fps: number, tr: ReturnType<typeof createTransport>, audio: { list(): Audio[]; edit(list: Audio[]): void }) {
  const [scroll, track, ruler, noteLane, strips, lanes, playhead, dropAt] = ['tl-scroll', 'tl-track', 'ruler', 'note-lane', 'strips', 'lanes', 'playhead', 'drop-at'].map($)
  const pad = () => parseFloat(getComputedStyle(scroll).paddingLeft) // .tl-scroll pads both sides alike
  const MAX_PPS = 40 * frameCount(1, fps) // zoomed all the way in, a Frame is 40 px wide
  let pps: number | null = null // px per second; null fits the whole Project in view
  let duration = 0
  let list: Strip[] = []
  let waves: { lane: Lane; wave?: { d: string; n: number } }[] = []
  const waveOf = new WeakMap<AudioBuffer, { d: string; n: number }>()
  // A Timeline block's name, and a short Error badge (it must fit a narrow strip).
  const label = (el: HTMLElement, text: string, error: boolean) => {
    el.append(Object.assign(document.createElement('span'), { textContent: text }))
    if (error) el.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'Error' }))
  }
  let now = 0
  let current = -1
  let settles: { i: number; file: string }[] = [] // lanes let go off their rest, springing back across relayouts
  // Lanes held by a drag (one per pointer), and whether a layout waits for the last to let go: a relayout would replace
  // a held block, and its pointer capture and drag with it (a save landing mid-drag, #130).
  let lanesHeld = 0
  let layoutPending = false
  // px per second and seconds the Timeline is drawn at: pointers, Notes and the playhead go by what shows, not a layout
  // to come.
  let drawn = 0
  let drawnLength = 0
  let notes: ReturnType<typeof wireNotes> | undefined
  const fit = () => (duration ? Math.max(0, scroll.clientWidth - 2 * pad()) / duration : 0)
  const k = () => drawn

  // Only layout() calls this.
  const drawTimeline = () => {
    const px = (drawn = pps ?? fit())
    drawnLength = duration
    track.style.width = `${duration * px}px`
    ruler.replaceChildren(
      ...rulerTicks(duration, px).map(({ t, label }) => {
        const tick = Object.assign(document.createElement('span'), { textContent: label })
        tick.style.left = `${t * px}px`
        if (t > 0 && (duration - t) * px < 24) tick.className = 'end' // centred, it would hang past the track's end
        return tick
      }),
    )
    strips.replaceChildren(
      ...list.map((s, i) => {
        const el = document.createElement('div')
        el.style.left = `${s.start * px + 2}px`
        el.style.width = `${Math.max(0, (s.end - s.start) * px - 4)}px`
        if (s.thumb) el.style.backgroundImage = `url("${s.thumb}")`
        if (i === current) el.setAttribute('aria-current', 'true')
        label(el, s.file, s.error)
        return el
      }),
    )
    layoutNotes()
    const focused = [...lanes.children].findIndex((row) => row.contains(document.activeElement)) // a relayout keeps it
    lanes.replaceChildren(
      ...waves.map(({ lane, wave }, i) => {
        const row = document.createElement('div')
        const remove = row.appendChild(Object.assign(document.createElement('button'), { className: 'remove', title: 'Remove from the Timeline (Delete)' }))
        remove.innerHTML = icon('dismiss')
        remove.setAttribute('aria-label', `Remove ${lane.file} from the Timeline`)
        remove.addEventListener('pointerdown', (e) => e.stopPropagation()) // the track would seek
        remove.addEventListener('click', () => removeLane(i, lane.file))
        const el = row.appendChild(laneControl(lane, i))
        const text = lane.error ?? lane.file
        // Starting at or after the video's end it is never heard; it spans the row so it and its error stay visible.
        const late = lane.start >= duration
        const length = late ? duration : (lane.buffer?.duration ?? duration - lane.start) // a bad file runs to the end, so its error shows
        const left = late ? 0 : lane.start * px
        el.style.left = remove.style.left = `${left}px`
        el.style.width = `${length * px}px`
        if (wave && !late)
          el.innerHTML = `<svg viewBox="0 -1 ${wave.n} 2" width="${length * px}" preserveAspectRatio="none" aria-hidden="true"><path d="${wave.d}" /></svg>`
        label(el, late ? `${text} · starts at ${lane.start}s, after the video ends` : text, !!lane.error)
        return row
      }),
    )
    ;(lanes.children[focused]?.querySelector('.lane') as HTMLElement | null)?.focus({ preventScroll: true })
    playhead.style.left = `${Math.min(now, duration) * px}px`
  }
  // Moves an Audio lane's row (its block and remove button) by px; 0 takes it back to its start.
  const shiftRow = (row: Element | null | undefined, px: number) => {
    for (const c of row?.children ?? []) (c as HTMLElement).style.translate = px ? `${px}px` : ''
  }
  // Lays the Timeline out anew. A lane let go off its rest (`settles`) starts its new row where the old one shows,
  // mid-spring included, and springs back from there: its own edit lays the Timeline out more than once.
  const layout = () => {
    if (lanesHeld) return void (layoutPending = true)
    const laneAt = (i: number) => lanes.children[i]?.querySelector<HTMLElement>('.lane')
    const shown = settles.map(({ i, file }) => {
      const old = laneAt(i)
      return old?.getAttribute('aria-label') === `${file} start` ? old.getBoundingClientRect().left : undefined
    })
    drawTimeline()
    settles = settles.filter((s, n) => {
      const el = waves[s.i]?.lane.file === s.file ? laneAt(s.i) : null
      const back = shown[n] === undefined || !el ? 0 : shown[n]! - el.getBoundingClientRect().left
      if (Math.abs(back) < 0.5) return false // settled, or laid out without it
      const row = el!.parentElement!
      row.classList.add('held')
      shiftRow(row, back)
      row.getBoundingClientRect() // the spring's start is laid out before it is let go
      row.classList.remove('held')
      shiftRow(row, 0)
      springsOut(el!, s)
      return true
    })
  }
  // Springs lane i back across relayouts from where it shows (replacing any spring it had).
  const settleLane = (i: number, file: string) => {
    const s = { i, file }
    settles = [...settles.filter((x) => x.i !== i), s]
    return s
  }
  // Its spring done (the block's move, not a press's scale), a later edit moves the lane in one step.
  const springsOut = (el: HTMLElement, s: { i: number; file: string }) => {
    el.ontransitionend = (e) => void (e.propertyName === 'translate' && (settles = settles.filter((x) => x !== s)))
  }
  // A lane acts on its index only while the list still has its file there: a re-read may change the list before the
  // lanes are laid out anew.
  const removeLane = (i: number, file: string) => {
    if (audio.list()[i]?.file === file) audio.edit(audio.list().filter((_, j) => j !== i))
  }
  const moveLane = (i: number, file: string, start: number) => {
    settles = settles.filter((s) => s.i !== i) // a key press moves in one step
    start = Math.max(0, start)
    const a = audio.list()[i]
    if (a?.file === file && a.start !== start) audio.edit(audio.list().map((a, j) => (j === i ? { ...a, start } : a)))
  }
  // Lane i's start in the list, a save while it was held included; else the start its block was laid out at.
  const listedStart = (i: number, lane: Lane) => {
    const a = audio.list()[i]
    return a?.file === lane.file ? a.start : lane.start
  }
  // One Audio file's block: a slider over its start, in Frames. Dragging previews by transform and writes on release.
  const laneControl = (lane: Lane, i: number) => {
    const el = Object.assign(document.createElement('div'), { className: 'lane', tabIndex: 0, title: 'Drag or arrow keys to move, Delete to remove' })
    el.setAttribute('role', 'slider')
    el.setAttribute('aria-label', `${lane.file} start`)
    el.setAttribute('aria-valuemin', '0')
    el.setAttribute('aria-valuenow', String(lane.start))
    el.setAttribute('aria-valuetext', `${lane.start.toFixed(2)}s`)
    el.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Delete')
    // over: px the block shows past the Timeline's start (rubber-band), which it springs back from on release. far: it
    // went NEAR px or more, so it is a drag, not a click.
    let drag: { x: number; to: number; over: number; far: boolean } | null = null
    // The one pointer dragging this block (counted in lanesHeld): another on it, or a capture on a child (a pen's other
    // button) bubbling here, is ignored.
    let heldBy: number | null = null
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.stopPropagation() // the track would seek
      if (heldBy !== null) return
      el.setPointerCapture(e.pointerId)
      heldBy = e.pointerId
      lanesHeld++
      el.focus({ preventScroll: true })
      const row = el.parentElement!
      // Where the block shows, mid-spring included: held (app.css) stops it there, and the drag carries on from it.
      const live = el.getBoundingClientRect().left - (row.getBoundingClientRect().left + el.offsetLeft)
      row.classList.add('held')
      shiftRow(row, live)
      const shown = lane.start * k() + live // px the block's start shows at
      drag = { x: e.clientX - ((shown < 0 ? unrubberband(shown, pad()) : shown) - lane.start * k()), to: lane.start, over: 0, far: false }
    })
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== heldBy || !k()) return
      const dx = e.clientX - drag.x
      const px = lane.start * k() + dx // where the block's start would be
      // A click (under NEAR px) moves nothing, so a start Claude set between Frames is not snapped by it.
      drag.to = Math.abs(dx) < NEAR ? lane.start : Math.max(0, frameAt(px / k(), fps) / fps)
      drag.over = Math.abs(dx) >= NEAR && px < 0 ? rubberband(px, pad()) : 0
      drag.far ||= Math.abs(dx) >= NEAR
      shiftRow(el.parentElement, (drag.to - lane.start) * k() + drag.over)
    })
    el.addEventListener('pointerup', (e) => {
      // Nothing to write (a click, or let go where the list has it): it springs back below.
      if (!drag || e.pointerId !== heldBy || !drag.far || drag.to === listedStart(i, lane)) return
      moveLane(i, lane.file, drag.to)
      if (listedStart(i, lane) !== drag.to || audio.list()[i]?.file !== lane.file) return // refused: it springs back below
      // Moved: this block holds where it shows until its own edit lays the lanes out anew (after saveAudio's await,
      // with whatever came meanwhile: loadLanes never rejects), and past the start the new block springs back from
      // there. A layout held back by the drag is dropped: run now, it would jump the block back to its old start.
      if (drag.over) settleLane(i, lane.file) // moveLane dropped any spring it had
      drag = null
      layoutPending = false
    })
    el.addEventListener('lostpointercapture', (e) => {
      if (e.pointerId !== heldBy) return
      heldBy = null
      el.parentElement?.classList.remove('held')
      // Off its rest (refused, rubber-banded, let go where it is): a layout during its spring starts the new block where
      // it shows. Settled with no layout, the spring is done.
      if (drag && Math.abs(el.getBoundingClientRect().left - (el.parentElement!.getBoundingClientRect().left + el.offsetLeft)) >= 0.5) {
        springsOut(el, settleLane(i, lane.file))
      }
      if (drag) shiftRow(el.parentElement, 0) // springs back from where it shows
      drag = null
      if (--lanesHeld || !layoutPending) return
      layoutPending = false
      layout()
    })
    el.addEventListener('keydown', (e) => {
      // The list's start, not this block's: a held key presses again before the lanes are laid out anew.
      const start = audio.list()[i]?.start ?? lane.start
      // The Frame before or after the start (a start between Frames goes to the nearest one that way).
      if (e.key === 'Delete') removeLane(i, lane.file)
      else if (e.key === 'ArrowLeft') moveLane(i, lane.file, (frameCount(start, fps) - 1) / fps)
      else if (e.key === 'ArrowRight') moveLane(i, lane.file, (frameAt(start, fps) + 1) / fps)
      else return
      e.preventDefault()
      e.stopPropagation() // not the transport's Frame step
    })
    return el
  }
  // A marker per Note at its time, a bar across a span; clicking one jumps to its Note.
  const layoutNotes = () => {
    const px = k()
    noteLane.replaceChildren(
      ...(notes?.markers() ?? []).map(({ n, done, start, end, draft }) => {
        const [a, b] = [start, end ?? start].map((t) => Math.min(t, drawnLength) * px) // a Note past the end waits at it
        const el = Object.assign(document.createElement('button'), { className: end === undefined ? 'marker' : 'span', textContent: String(n) })
        el.classList.toggle('done', done)
        el.classList.toggle('draft', !!draft)
        el.style.left = `${a}px`
        if (end !== undefined) el.style.width = `${b - a}px`
        el.setAttribute('aria-label', `Note ${n}${end === undefined ? '' : ', span'}${done ? ', done' : ''}`)
        el.addEventListener('pointerdown', (e) => e.stopPropagation()) // the track would seek to the click, not the Note
        el.addEventListener('click', () => (tr.pause(), tr.seek(start)))
        return el
      }),
    )
  }
  const zoom = (by: number | null, at?: number) => {
    // Dropped, like a seek: the pointer belongs to the drag, and the scroll needs a layout that waits for it.
    if (lanesHeld) return
    const [from, left] = [k(), scroll.scrollLeft] // read before the relayout clamps the scroll
    pps = by === null ? null : zoomed(pps, by, fit(), MAX_PPS)
    settles = [] // the lanes move to the new zoom in one step
    layout()
    const x = at === undefined ? undefined : at - scroll.getBoundingClientRect().left
    // Under the pointer the time stays put; else the playhead goes to the middle.
    scroll.scrollLeft = x === undefined || !from ? now * k() + pad() - scroll.clientWidth / 2 : zoomAt(x, left, from, k(), pad())
  }
  const refit = () => {
    if (pps !== null && pps <= fit()) pps = null // the view outgrew this zoom: fit, so the track still fills it
    layout()
  }
  let dragX: number | null = null // cursor x while dragging on the Timeline, else null
  // While adding a Note: the Frame and screen x a drag started at, and whether it has moved NEAR px (else a click).
  let span: { from: number; x: number; far: boolean } | null = null
  const NEAR = 4
  const seekAt = (x: number) => {
    if (!k()) return // no length or no room: every x would be time 0 / 0
    const r = scroll.getBoundingClientRect()
    x = Math.min(Math.max(x, r.left), r.right) // past an edge, the playhead waits at that edge while the view scrolls
    tr.pause()
    tr.seek(frameAt((x - track.getBoundingClientRect().left) / k(), fps) / fps) // seek lands on a Frame
  }

  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    track.setPointerCapture(e.pointerId)
    track.classList.add('held') // held (app.css): the playhead is at the pointer at once, mid-settle too
    dragX = e.clientX
    seekAt(e.clientX)
    if (notes?.picksSpan()) span = { from: tr.frame, x: e.clientX, far: false }
  })
  track.addEventListener('pointerup', () => {
    if (span?.far) notes?.spanDone(span.from, tr.frame)
    else if (span) notes?.spanCancel() // a click only seeks
    span = null
  })
  track.addEventListener('lostpointercapture', () => {
    if (span) notes?.spanCancel() // taken back by the OS before pointerup
    dragX = span = null
    track.classList.remove('held')
    playhead.style.translate = '' // springs back to the end it was pulled past
  })
  track.addEventListener('pointermove', (e) => {
    if (dragX === null) return
    // Past an edge, moving further out scrolls by as much as the cursor moved, so off-screen time is reachable.
    const r = scroll.getBoundingClientRect()
    const dx = e.clientX - dragX
    dragX = e.clientX
    if (e.clientX > r.right) scroll.scrollLeft += Math.max(0, Math.min(dx, e.clientX - r.right)) // only the part past the edge
    else if (e.clientX < r.left) scroll.scrollLeft += Math.min(0, Math.max(dx, e.clientX - r.left))
    seekAt(e.clientX)
    // Past an end of the Timeline that is in view, the playhead (waiting at the first or last Frame) follows a little,
    // held back the further it goes. Its line and head stay inside the view's padding, so it never widens what the view
    // scrolls.
    const t = track.getBoundingClientRect()
    const past = (e.clientX > t.right && t.right <= r.right) || (e.clientX < t.left && t.left >= r.left)
    const rest = t.left + tr.time * k()
    // Room up to the padding's far edge, or the view's edge when less of the padding is in view.
    const room = (e.clientX > t.right ? Math.min(t.right + pad(), r.right) - rest : rest - Math.max(t.left - pad(), r.left)) - PLAYHEAD_HALF
    playhead.style.translate = past ? `${rubberband(e.clientX - rest, Math.max(0, room))}px` : ''
    if (span && (span.far ||= Math.abs(e.clientX - span.x) >= NEAR)) notes?.spanDraft(span.from, tr.frame)
  })
  $('zoom-in').addEventListener('click', () => zoom(2))
  $('zoom-out').addEventListener('click', () => zoom(0.5))
  $('zoom-fit').addEventListener('click', () => zoom(null))
  // An audio file from the Files panel over the Timeline: an amber line marks the Frame it would start at.
  const timeline = scroll.parentElement!
  const dropTime = (x: number) => Math.min(Math.max(0, frameAt((x - track.getBoundingClientRect().left) / k(), fps) / fps), tr.end)
  const endDrop = () => ((dropAt.hidden = true), timeline.classList.remove('dropping'))
  scroll.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(AUDIO_FILE_TYPE) || !k()) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    dropAt.hidden = false
    dropAt.style.left = `${dropTime(e.clientX) * k()}px`
    timeline.classList.add('dropping')
  })
  scroll.addEventListener('dragleave', (e) => !scroll.contains(e.relatedTarget as Node | null) && endDrop())
  document.addEventListener('dragend', endDrop) // dropped elsewhere, or Esc
  scroll.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.getData(AUDIO_FILE_TYPE)
    endDrop()
    if (!file || !k()) return
    e.preventDefault()
    e.stopPropagation() // not a drop of files from disk
    audio.edit([...audio.list(), { file, start: dropTime(e.clientX), volume: 1 }])
  })
  scroll.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault() // stops the page zoom
      zoom(2 ** (-e.deltaY / 100), e.clientX) // a wheel notch (100) doubles or halves; a trackpad pinch's small steps zoom smoothly
    },
    { passive: false },
  )
  window.addEventListener('keydown', (e) => {
    const by = { Equal: 2, NumpadAdd: 2, Minus: 0.5, NumpadSubtract: 0.5 }[e.code]
    // Ctrl + / - stays the window's own zoom; typing in a text field never zooms.
    const typing = e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== 'range')
    if (by && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) zoom(by)
  })
  new ResizeObserver(refit).observe(scroll)

  return {
    layoutNotes,
    /** The Notes whose markers the lane shows and whose drags pick spans. */
    showNotes(n: ReturnType<typeof wireNotes>) {
      notes = n
      layoutNotes()
    },
    /** New Scene lengths or thumbnails, after a reload. */
    scenes(next: Strip[], total: number) {
      ;[list, duration] = [next, total]
      refit()
    },
    /** New Audio files, decoded or failed. The waveform is worked out here once, not on every zoom. */
    lanes(next: Lane[]) {
      waves = next.map((lane) => {
        const { buffer } = lane
        if (!buffer) return { lane }
        // One pass over the samples per decode (a 3 min stereo file is ~16M samples, tens of ms), not per zoom or edit.
        let wave = waveOf.get(buffer)
        if (!wave) {
          const p = peaks(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), Math.ceil(buffer.duration * WAVE_PER_SECOND))
          waveOf.set(buffer, (wave = { d: wavePath(p), n: p.length }))
        }
        return { lane, wave }
      })
      layout()
    },
    /** Project time t is on screen, in Scene `scene`. */
    at(t: number, scene: number) {
      const moved = t !== now // a redraw at the same time (after a save or an Export) leaves the user's scroll alone
      now = t
      const x = Math.min(t, drawnLength) * k()
      playhead.style.left = `${x}px`
      if (scene !== current) {
        strips.children[current]?.removeAttribute('aria-current')
        strips.children[scene]?.setAttribute('aria-current', 'true')
        current = scene
      }
      // Any move but a drag on the Timeline itself (the cursor holds the playhead there) brings the playhead into view.
      if (moved && dragX === null) scroll.scrollLeft = follow(x + pad(), scroll.scrollLeft, scroll.clientWidth)
    },
  }
}

// Set-up state (GLOSSARY): the folder has no project.json yet. Files works; Scenes, Timeline, Export, Note and Pencil wait
// for Claude to write it.
function showSetUp(dir: string) {
  showName(folderName(dir), ' · set up')
  stage.insertAdjacentHTML(
    'beforeend',
    '<div class="set-up"><h2>Drop your files in.<br><b>Claude builds the rest.</b></h2><p>Put pictures, PDFs and audio in the folder. Then Connect Claude and paste the prompt into Claude Code.</p></div>',
  )
  for (const id of ['scenes-waiting', 'timeline', 'tl-waiting', 'note-tools']) $(id).hidden = false
  for (const id of ['tl-scroll', 'zoom']) $(id).hidden = true
  for (const id of ['note', 'pen']) ($(id) as HTMLButtonElement).disabled = true
  $('files-empty').textContent = 'Empty folder. Copy pictures, PDFs, audio or fonts into it (or drop them on this window). They show here as they land.'
  const files = wireFiles({ dir, scenes: () => [], audio: () => [], place: () => files.say($('tl-waiting').textContent ?? '') })
  kapecut.onFileSaved((file) => reopenOn(file) || PROJECT_TMP.test(file) || void files.refresh())
  // A project.json written while the page read the folder sent its event before anyone listened: look once more.
  void fetch('/project/project.json', { method: 'HEAD', cache: 'no-store' }).then((r) => r.status !== 404 && location.reload())
}

// Switching Projects reloads the page from main, so every open starts from a clean page.
async function switchProject(open: () => Promise<string | undefined>) {
  if (exporting || exportQueued) return void (exportStatus.textContent = 'Cancel the Export before opening another Project')
  ;($('projects') as HTMLDetailsElement).open = false
  const problem = await open().catch(errorText)
  if (problem) exportStatus.textContent = problem
}
const chooseProject = () => switchProject(kapecut.project.choose)
$('open-folder').addEventListener('click', chooseProject)
window.addEventListener('dragover', (e) => e.preventDefault()) // without it a drop navigates the window to the file
// A drop anywhere: one folder opens as a Project, files are copied into the open one (the Files panel says what happened).
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  const files = [...(e.dataTransfer?.files ?? [])]
  if (!files.length) return
  if (!checked) return void ($('setup-status').textContent = 'Install what is missing first, then drop it again')
  ;($('projects') as HTMLDetailsElement).open = false
  const message = await kapecut.project.drop(files, !exporting && !exportQueued).catch(errorText)
  if (message) ($('files').hidden ? exportStatus : $('files-status')).textContent = message
})

// Listed twice: the Projects menu and Settings.
const recentButtons = (recent: string[]) =>
  recent.map((dir) => {
    const item = Object.assign(document.createElement('button'), { innerHTML: icon('history'), title: dir })
    item.append(folderName(dir))
    item.addEventListener('click', () => switchProject(() => kapecut.project.openRecent(dir)))
    return item
  })
// Nothing opens until the Setup window's checks pass (#89): Open folder, drops and recent Projects wait for it.
let checked = false
const ready = wireSetup().then(() => {
  checked = true
  ;($('open-folder') as HTMLButtonElement).disabled = false
})
const state = ready.then(() => kapecut.project.state())
// Settings works even when the Project state cannot be read: the encoder status matters most then.
void ready.then(() => Promise.all([state.catch(() => ({ recent: [] })), kapecut.settings.get()])).then(([{ recent }, settings]) =>
  wireSettings(recentButtons(recent), settings),
).catch((e) => console.error('[kapecut] Settings could not start:', e)) // it stays disabled; the console says why
state
  .then(async ({ current, recent, session, opened }) => {
    $('recent').replaceChildren(...recentButtons(recent))
    const project = await readProject(current).catch((e) => {
      showError(errorText(e), 'Project error')
      kapecut.onFileSaved(reopenOn)
      // A fix saved while the page read it sent its event before anyone listened: read once more, reopen if it changed.
      void readProject(current).then(() => location.reload(), () => {})
    })
    if (current) {
      void wireClaudeStatus(opened) // shows Connect once it knows which face it has
      projectState = project === SET_UP ? 'set-up' : project ? 'ready' : 'error'
      $('connect').addEventListener('click', () =>
        copyPrompt(connectPrompt({ project: current, session, state: projectState })),
      )
    }
    if (project === SET_UP) return showSetUp(current!)
    if (project) return openProject(current!, project, session).catch((e) => showError(errorText(e)))
    if (project === null) {
      showError('Open a Project folder, or drop one on the window.', 'No Project')
      const open = Object.assign(document.createElement('button'), { className: 'primary', innerHTML: icon('folder-open') + 'Open folder' })
      open.addEventListener('click', chooseProject)
      stage.querySelector('.error')!.append(open)
    }
  })
  .catch((e) => showError(errorText(e), 'Project error'))
