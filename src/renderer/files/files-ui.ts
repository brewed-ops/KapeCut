import { kapecut } from '../bridge'
import { $, errorText, HOLD } from '../dom'
import { icon, type IconName } from '../icons'
import { fileKind, MAX_LISTED, type Kind } from './kind'

/** Drag data of an audio file in the Files panel: its path in the Project. */
export const AUDIO_FILE_TYPE = 'application/x-kapecut-audio'

// Every Kind, so a new one in kind.ts fails typecheck here until it has an icon.
const KIND_ICON: Record<Kind, IconName> = { audio: 'music-note-2', video: 'video', image: 'image', font: 'document', other: 'document' }
/** The icon before a file's name: its kind, or code for a page that is not a Scene. */
const kindIcon = (file: string, kind: Kind) => icon(/\.html?$/i.test(file) ? 'code' : KIND_ICON[kind], 'kind-icon')

/**
 * The Files panel: every file in the Project folder but project.json, the Notes and the Scene pages (`scenes`), plus the
 * Audio files project.json names (`audio`), each with its kind. A row copies its path (what a Scene or project.json
 * names it by); an audio row drags onto the Timeline, or its + button (the keyboard's way) places it at the playhead.
 * Files dropped on the window are copied in by main; the watcher's events call refresh.
 * `dir`, the Project folder, shows under the title.
 */
export function wireFiles(opts: { dir: string; scenes: () => string[]; audio: () => string[]; place: (file: string) => void }) {
  const [panel, list, status, empty, path] = ['files', 'file-list', 'files-status', 'files-empty', 'files-path'].map($)
  panel.hidden = false
  path.textContent = path.title = opts.dir
  const say = (text: string) => (status.textContent = text)
  let refreshes = 0 // a later refresh wins, so two quick saves never list out of order
  let listed: Set<string> | undefined // undefined until the first list, which shows at once
  const refresh = async () => {
    const me = ++refreshes
    const read = await kapecut.files.list().catch((e) => void say(errorText(e)))
    if (me !== refreshes) return
    const inFolder = read ?? []
    if (inFolder.length > MAX_LISTED) say(`The Project folder holds more files than Files lists (${MAX_LISTED})`)
    const scenes = new Set(opts.scenes())
    const all = [...new Set([...inFolder.slice(0, MAX_LISTED), ...opts.audio()])].filter((f) => !scenes.has(f)).sort()
    // Rows already listed stay in place (moving a node would restart its entry motion); a file the last list lacked
    // enters with motion (app.css #file-list li.new).
    const had = listed
    if (read) listed = new Set(all) // a failed read keeps the last list, so the next good one does not mark every file new
    const rows = new Map([...list.querySelectorAll<HTMLElement>(':scope > li')].map((li) => [li.dataset.file, li]))
    for (const [file, li] of rows) if (!all.includes(file!)) li.remove()
    let prev: Element | null = null
    for (const f of all) {
      const li = rows.get(f) ?? (had && !had.has(f) ? Object.assign(row(f), { className: 'new' }) : row(f))
      if (li.previousElementSibling !== prev || !li.isConnected) (prev ? prev.after(li) : list.prepend(li))
      prev = li
    }
    empty.hidden = all.length > 0
  }
  const row = (file: string) => {
    const kind = fileKind(file)
    const item = document.createElement('li')
    item.dataset.file = file
    item.innerHTML = `${kindIcon(file, kind)}<span class="name"></span><span class="kind">${kind}</span><button class="copy">${icon('copy')}</button>`
    item.querySelector('.name')!.textContent = file
    const copy = item.querySelector('button')!
    copy.setAttribute('aria-label', `Copy the path ${file}`)
    copy.title = 'Copy the path, for a Scene to use'
    let copied: ReturnType<typeof setTimeout> | undefined // the check shows for HOLD, then the copy icon is back
    const copiedNow = () => {
      say(`Copied ${file}`)
      copy.innerHTML = icon('copy-checkmark')
      clearTimeout(copied)
      copied = setTimeout(() => (copy.innerHTML = icon('copy')), HOLD)
    }
    copy.addEventListener('click', () => kapecut.clipboard.write(file).then(copiedNow, (e) => say(errorText(e))))
    if (kind === 'audio') {
      const place = item.appendChild(Object.assign(document.createElement('button'), { className: 'place', innerHTML: icon('add'), title: 'Add at the playhead' }))
      place.setAttribute('aria-label', `Add ${file} to the Timeline at the playhead`)
      place.addEventListener('click', () => opts.place(file))
      item.draggable = true
      item.title = `Drag ${file} onto the Timeline`
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(AUDIO_FILE_TYPE, file)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
      })
    }
    return item
  }
  $('files-add').addEventListener('click', () => kapecut.files.choose().then((m) => (m && say(m), refresh()), (e) => say(errorText(e))))

  // Files from disk dropped anywhere land here, so the panel shows the drop state while they are over the window.
  const fromDisk = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
  window.addEventListener('dragover', (e) => fromDisk(e) && panel.classList.add('dropping'))
  window.addEventListener('dragleave', (e) => !e.relatedTarget && panel.classList.remove('dropping')) // left the window
  window.addEventListener('drop', () => panel.classList.remove('dropping'))
  void refresh()
  return { refresh, say }
}
