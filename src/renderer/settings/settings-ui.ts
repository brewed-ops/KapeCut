import type { Settings, Theme } from '../../main/settings'
import { kapecut } from '../bridge'
import { setIdleMinutes } from '../agent/status-ui'
import { $, errorText } from '../dom'
import { icon } from '../icons'
import { probeH264 } from '../viewer/probe'
import { osOf, setupRows } from '../setup/setup'
import { updateView, type Run } from './updates'

/**
 * The Settings row at the foot of the left column and its modal panel (#114): General (idle minutes, recent Projects,
 * buttons the caller built), Appearance (the theme), Setup (the encoder and tool checks) and Updates (the version, the
 * launch check's result and its one button). Values are saved in settings.json by main, which checks them.
 */
export function wireSettings(recent: HTMLElement[], settings: Settings) {
  let { idleMinutes, theme } = settings
  const button = $('settings') as HTMLButtonElement
  const panel = $('settings-panel') as HTMLDialogElement
  const input = $('idle-minutes') as HTMLInputElement
  const say = (text: string) => ($('settings-status').textContent = text)
  button.addEventListener('click', () => {
    say('') // an old refusal is not news
    panel.showModal()
    button.setAttribute('aria-expanded', 'true')
  })
  button.disabled = false // disabled in index.html: a click before this listener was lost (#150)
  // However it closes (Escape, a click outside, Close, a recent Project), focus goes back to the row. A click outside
  // (closedby="any") blurs the idle minutes, which saves what was typed, like any field.
  panel.addEventListener('close', () => {
    button.setAttribute('aria-expanded', 'false')
    button.focus()
  })
  $('settings-close').addEventListener('click', () => panel.close())
  // Escape wherever focus is; capture, so it runs first and is the only thing Escape does (a Note being added stays).
  // It drops what was typed, so the blur saves nothing.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !panel.open) return
      e.stopPropagation()
      e.preventDefault()
      input.value = String(idleMinutes)
      panel.close()
    },
    true,
  )
  // Typing in the panel is not the transport's or the Notes' keys (the panel takes focus from a click on its text).
  panel.addEventListener('keydown', (e) => e.stopPropagation())

  const nav = [...panel.querySelectorAll<HTMLButtonElement>('nav button')]
  for (const b of nav)
    b.addEventListener('click', () => {
      for (const n of nav) {
        if (n === b) n.setAttribute('aria-current', 'true')
        else n.removeAttribute('aria-current')
        panel.querySelector<HTMLElement>(`section[data-section="${n.dataset.section}"]`)!.hidden = n !== b
      }
      $('settings-title').textContent = b.textContent
    })

  const list = $('settings-recent')
  list.replaceChildren(...(recent.length ? recent : [Object.assign(document.createElement('span'), { textContent: 'None yet' })]))
  list.addEventListener('click', (e) => e.target instanceof HTMLButtonElement && panel.close()) // the opening says how it went

  input.value = String(idleMinutes)
  setIdleMinutes(idleMinutes)
  input.addEventListener('change', async () => {
    try {
      idleMinutes = await kapecut.settings.setIdleMinutes(input.valueAsNumber) // main refuses all but 1 to 120
      setIdleMinutes(idleMinutes)
      say('')
    } catch (e) {
      input.value = String(idleMinutes)
      say(errorText(e))
    }
  })

  const radios = panel.querySelectorAll<HTMLInputElement>('input[name="theme"]')
  const showTheme = () => radios.forEach((r) => (r.checked = r.value === theme))
  showTheme()
  for (const r of radios)
    r.addEventListener('change', async () => {
      try {
        theme = await kapecut.settings.setTheme(r.value as Theme) // repaints the page; main refuses an unknown theme
        say('')
      } catch (e) {
        showTheme()
        say(errorText(e))
      }
    })

  // Updates (#138): the version, the launch check's result, and one button for the next step.
  const update = $('update-action') as HTMLButtonElement
  let run: Run | null = null // a bridge method's name: tsc fails if the two drift apart
  update.addEventListener('click', () => run && kapecut.updates[run]().then(() => say(''), (e) => say(errorText(e))))
  kapecut.updates.onStatus((s) => {
    const view = updateView(s)
    $('update-text').textContent = view.text
    update.hidden = !view.button
    update.textContent = view.button
    update.disabled = !view.run
    run = view.run
  })
  void kapecut.updates.version().then((v) => ($('app-version').textContent = `v${v}`))

  const encoder = $('encoder')
  Promise.all([probeH264(), kapecut.tools()]).then(
    ([h264, tools]) => {
      // An optional row (the skill) that fails is a plain no, never the accent of a missing requirement.
      const item = (label: string, ok: boolean, optional = false) =>
        `<span>${label} <b class="${ok || optional ? '' : 'no'}">${icon(ok ? 'checkmark-circle' : 'dismiss-circle')}${ok ? 'yes' : 'no'}</b></span>`
      encoder.innerHTML =
        item('H.264 hardware', h264.hardware) + item('H.264 software', h264.software) + item('ffmpeg 4.4+', tools.ffmpeg) + item('ffprobe', tools.ffprobe) +
        // the rest of the Setup window's rows (its ffmpeg row is the two above)
        setupRows(tools, osOf(navigator.platform)).filter((r) => r.id !== 'ffmpeg').map((r) => item(r.name, r.ok, r.optional)).join('')
      console.log('[kapecut] probe', JSON.stringify({ h264, tools }))
    },
    (e) => (encoder.textContent = `Startup check failed: ${e}`),
  )
}
