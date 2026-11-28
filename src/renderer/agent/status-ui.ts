import { kapecut } from '../bridge'
import { $ } from '../dom'
import { agentStatus, HANDSHAKES, IDLE_MS } from './status'

const LABEL = { none: 'Agent not connected', active: 'Agent active', idle: 'Agent idle' }
/** What the pill shows after its fixed "Agent": the state, short. */
const FACE = { none: '· Not connected', active: '· Active', idle: '· Idle' }

// A file there but unreadable right now (mid-write) answers 500: it exists.
const exists = (file: string) => fetch(`/project/${file}`, { method: 'HEAD', cache: 'no-store' }).then((r) => r.status !== 404, () => false)
const hasHandshake = async () => (await Promise.all(HANDSHAKES.map(exists))).includes(true)

let idleMs = IDLE_MS
let redraw = () => {} // the pill's own redraw, once it is wired

/** Sets the idle time (Settings), before or after the pill is wired; a wired pill follows at once. */
export function setIdleMinutes(minutes: number) {
  idleMs = minutes * 60_000
  redraw()
}

/**
 * The header's Agent status pill for the open Project (ADR 0005), and the face of the Connect button. Activity is every
 * file event main forwards that the app did not write itself, and pointer, key or wheel input in the window (Scene
 * frames take none). opened: which open of the Project this is, so the page's own reloads (Set-up state turning into
 * the editor) keep the last activity, and opening the Project again starts idle.
 */
export async function wireAgentStatus(opened: number) {
  const pill = $('agent-status')
  const connect = $('connect')
  // One face per state, stacked, so a change cross-fades in place (app.css); the live text stays the one label read out.
  $('agent-status-faces').replaceChildren(
    ...Object.entries(FACE).map(([face, label]) => {
      const span = document.createElement('span')
      Object.assign(span.dataset, { face, label })
      return span
    }),
  )
  const key = `agent-activity:${opened}`
  let last = Number(sessionStorage.getItem(key)) || -Infinity
  let connected = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const show = () => {
    const now = Date.now()
    const status = agentStatus(connected, last, now, idleMs)
    clearTimeout(timer)
    if (status === 'active') timer = setTimeout(show, last + idleMs - now) // the exact idle moment
    if (pill.dataset.s === status) return // the live region speaks only on a change
    pill.dataset.s = status
    $('agent-status-text').textContent = pill.title = LABEL[status]
    connect.classList.toggle('primary', !connected)
    connect.setAttribute('aria-label', connected ? 'Agent connected, copy again' : 'Connect your agent')
  }
  const activity = () => {
    last = Date.now()
    sessionStorage.setItem(key, String(last))
    show()
  }
  // Only the newest check counts: a write and a delete in quick succession may answer out of order.
  let checks = 0
  const check = async () => {
    const n = ++checks
    const found = await hasHandshake()
    if (n === checks) connected = found
  }
  // Listening before the first check, so a handshake written meanwhile is not missed. Deleting it (or its folder)
  // disconnects; the skill leaves one handshake, deleting an old claude.json once it writes agent.json.
  kapecut.onFileSaved(async (file, own) => {
    if (HANDSHAKES.some((h) => file === h || h.startsWith(file + '/'))) await check()
    if (own) show()
    else activity()
  })
  for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, activity, { capture: true, passive: true })
  await check()
  setInterval(show, 60_000) // also catches a timer the OS held back while asleep
  redraw = show
  show()
  pill.hidden = connect.hidden = $('connect-warning').hidden = false // only now: never a flash of the wrong state before the check
}
