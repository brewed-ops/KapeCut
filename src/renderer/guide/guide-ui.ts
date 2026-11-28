import { kapecut } from '../bridge'
import { $ } from '../dom'

/**
 * The header's Guide button and its panel (#27). Called once Setup has passed: with seen false (the first launch) the
 * panel opens by itself and main keeps it seen, so it never opens by itself again.
 */
export function wireGuide(seen: boolean) {
  const button = $('guide') as HTMLButtonElement
  const panel = $('guide-panel') as HTMLDialogElement
  const open = () => {
    panel.showModal()
    panel.focus() // the panel, not the first control: no focus ring on Close
  }
  button.addEventListener('click', open)
  $('guide-close').addEventListener('click', () => panel.close())
  panel.addEventListener('close', () => button.focus())
  // Keys in the panel are not the transport's or the Notes' (Space, N), as in Settings.
  panel.addEventListener('keydown', (e) => e.stopPropagation())
  // Step 1 says to drop a folder on the window: the drop goes through, and the Guide steps aside to show it.
  window.addEventListener('drop', (e) => e.dataTransfer?.files.length && panel.open && panel.close(), true)
  if (!seen) {
    open()
    // shortcut: a failed write opens it again next launch, which is the safe side.
    kapecut.settings.markGuideSeen().catch((e) => console.error('[kapecut] Guide seen could not be saved:', e))
  }
  button.disabled = false // disabled in index.html until here: a click before this listener was lost
}
