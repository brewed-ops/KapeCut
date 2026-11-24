import type { Checks } from '../../main/setup-checks'
import { kapecut } from '../bridge'
import { $, errorText, HOLD, toast } from '../dom'
import { icon } from '../icons'
import { osOf, setupPrompt, setupRows, type Row } from './setup'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(document.createElement(tag), props)

/**
 * The Setup window (#89): in the editor's place (app.css hides it) until every check passes. Resolves as they pass; after
 * a fix the window stays a moment longer to show them all passing.
 */
export function wireSetup(): Promise<void> {
  const box = $('setup')
  const list = $('setup-list')
  const status = $('setup-status')
  const recheck = $('setup-recheck') as HTMLButtonElement
  const copyPrompt = $('setup-prompt') as HTMLButtonElement
  let prompt: string | null = null
  const say = (text: string) => (status.textContent = text)
  const os = osOf(navigator.platform)

  return new Promise((done) => {
    const open = () => {
      if (!box.hidden) return
      box.hidden = false
      recheck.focus()
    }
    // Each step disables the buttons until main answers, so two copies or checks never race.
    const busy = (on: boolean) => [...list.querySelectorAll('button'), copyPrompt].forEach((b) => (b.disabled = on))
    const ask = (work: Promise<Checks>) => {
      recheck.disabled = true
      busy(true)
      say('Checking')
      work.then(show, (e) => (say(errorText(e)), open())).finally(() => ((recheck.disabled = false), busy(false)))
    }
    const show = (c: Checks) => {
      const rows = setupRows(c, os)
      if (rows.every((r) => r.ok) && box.hidden) return done()
      list.replaceChildren(...rows.map(row))
      prompt = setupPrompt(rows, os)
      copyPrompt.hidden = !prompt
      open()
      if (!rows.every((r) => r.ok)) return say('')
      say('All set')
      recheck.hidden = true
      done() // in at once (a drop now opens); the window stays a moment to show it
      setTimeout(() => (box.hidden = true), HOLD)
    }
    const row = (r: Row) => {
      const li = el('li', { className: r.ok ? 'ok' : 'no' })
      li.dataset.check = r.id
      li.append(el('span', { className: 'eyebrow state', innerHTML: icon(r.ok ? 'checkmark-circle' : 'dismiss-circle') + (r.ok ? 'OK' : 'Missing') }), el('b', { textContent: r.name }), el('p', { textContent: r.detail }))
      if (r.command) {
        const copy = el('button', { innerHTML: icon('copy') + 'Copy', title: 'Copy the command, then run it in a terminal' })
        copy.setAttribute('aria-label', `Copy the ${r.name} command`)
        copy.addEventListener('click', () => kapecut.clipboard.write(r.command!).then(() => toast('Command copied'), (e) => say(errorText(e))))
        li.append(el('code', { textContent: r.command }), copy)
      }
      if (r.skill) {
        // Update asks before it replaces the user's copy; main does the asking.
        const install = el('button', { className: 'skill', innerHTML: icon('arrow-sync') + (r.skill === 'missing' ? 'Install skill' : 'Update skill') })
        install.addEventListener('click', () => ask(kapecut.installSkill()))
        li.append(install)
      }
      return li
    }
    recheck.addEventListener('click', () => ask(kapecut.recheckTools()))
    copyPrompt.addEventListener('click', () => prompt && kapecut.clipboard.write(prompt).then(() => toast('Prompt copied'), (e) => say(errorText(e))))
    // Once in, in for this run: a reload (Project switch, project.json saved) never shuts the open Project again.
    kapecut
      .setupPassed()
      .then((passed) => (passed ? done() : kapecut.tools().then(show)))
      .catch((e) => (say(`Could not check: ${errorText(e)}`), open()))
  })
}
