import { expect, test } from 'vitest'
import { updateView } from './updates'

test('each update status maps to its line of text and its one button', () => {
  expect(updateView({ state: 'idle' })).toEqual({ text: 'Not checked yet.', button: 'Check for updates', run: 'check' })
  expect(updateView({ state: 'off' })).toEqual({ text: 'Updates are checked in the installed app.', button: null, run: null })
  expect(updateView({ state: 'checking' })).toEqual({ text: 'Checking for updates.', button: 'Check for updates', run: null })
  expect(updateView({ state: 'latest' })).toEqual({ text: 'KapeCut is up to date.', button: 'Check for updates', run: 'check' })
  // Windows and Linux: one click downloads, then one click installs.
  expect(updateView({ state: 'available', version: '9.9.9' })).toEqual({ text: 'v9.9.9 is out.', button: 'Update to v9.9.9', run: 'download' })
  expect(updateView({ state: 'downloading', version: '9.9.9', percent: 42 })).toEqual({ text: 'Downloading v9.9.9: 42%', button: 'Update to v9.9.9', run: null })
  expect(updateView({ state: 'ready', version: '9.9.9' })).toEqual({ text: 'v9.9.9 is downloaded.', button: 'Restart to update', run: 'install' })
  // Mac: notify and link, the app cannot swap itself in unsigned.
  expect(updateView({ state: 'out', version: '9.9.9' })).toEqual({ text: 'v9.9.9 is out. Download it from its Release page.', button: 'Open Release page', run: 'open' })
  expect(updateView({ state: 'error', message: 'net::ERR_CONNECTION_REFUSED' })).toEqual({
    text: 'Update failed: net::ERR_CONNECTION_REFUSED',
    button: 'Check for updates',
    run: 'check',
  })
})
