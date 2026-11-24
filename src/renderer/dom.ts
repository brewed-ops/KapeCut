/** An element index.html must have; a missing one is a bug in the page, so it throws. */
export const $ = (id: string) => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing from index.html`)
  return el
}

/** How long a passing message (the toast, Copied, a Note's news) stays. */
export const HOLD = 2000

let toastTimer: ReturnType<typeof setTimeout> | undefined
/** Shows the app's one toast (a check and text) for a moment; a second call restarts it. */
export function toast(text: string) {
  $('toast-text').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), HOLD)
}

// A throw in main reaches the page as "Error invoking remote method 'x': Error: <message>"; the user needs the message.
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
