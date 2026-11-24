import type { UpdateStatus } from '../../main/update-status'

export type Run = 'check' | 'download' | 'install' | 'open'

/** A status as Settings > Updates shows it: one line, and one button (null: none; run null: shown, disabled). */
export function updateView(s: UpdateStatus): { text: string; button: string | null; run: Run | null } {
  const check = (text: string, run: Run | null = 'check') => ({ text, button: 'Check for updates', run })
  switch (s.state) {
    case 'idle': return check('Not checked yet.')
    case 'off': return { text: 'Updates are checked in the installed app.', button: null, run: null }
    case 'checking': return check('Checking for updates.', null)
    case 'latest': return check('KapeCut is up to date.')
    case 'available': return { text: `v${s.version} is out.`, button: `Update to v${s.version}`, run: 'download' }
    case 'downloading': return { text: `Downloading v${s.version}: ${s.percent}%`, button: `Update to v${s.version}`, run: null }
    case 'ready': return { text: `v${s.version} is downloaded.`, button: 'Restart to update', run: 'install' }
    case 'out': return { text: `v${s.version} is out. Download it from its Release page.`, button: 'Open Release page', run: 'open' }
    case 'error': return check(`Update failed: ${s.message}`)
  }
}
