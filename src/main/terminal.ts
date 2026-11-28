import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { join } from 'node:path'
import { installCommand, type Os } from '../renderer/setup/setup'

/** This computer's OS, as the Setup rows name it. */
export const HOST: Os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'

const sq = (s: string) => `'${s.replaceAll("'", "'\\''")}'` // a bash single-quoted string

/**
 * The program, args and options that open a visible terminal running command, for the user to watch and answer (sudo,
 * licences): PowerShell on Windows, Terminal on a Mac, the default terminal on Linux. The command is one of the fixed
 * table's.
 */
export function terminalArgv(os: Os, command: string, env: Record<string, string | undefined> = process.env): [string, string[], SpawnOptions] {
  if (os === 'win') {
    // Base64 UTF-16LE: no quoting for the Windows command line to get wrong. Write-Host shows what runs. No profile: a
    // broken one would stop the install.
    const script = `Write-Host '> ${command.replaceAll("'", "''")}'; ${command}`
    const root = env.SystemRoot ?? 'C:\\Windows' // by path: PATH may be what is broken
    const powershell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // `start` opens the new console window; a detached spawn gets no console and never runs the script. Verbatim: the
    // line is all fixed text and base64, and cmd must see start's quoted title as written.
    const line = `/d /c start "KapeCut" "${powershell}" -NoProfile -NoExit -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
    return [join(root, 'System32', 'cmd.exe'), [line], { stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true }]
  }
  if (os === 'mac') {
    // Terminal's shell lacks Homebrew's dir until its "Next steps" are done, so a brew row right after Homebrew would fail.
    const typed = `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; ${command}`.replaceAll('\\', '\\\\').replaceAll('"', '\\"') // an AppleScript string
    return ['/usr/bin/osascript', ['-e', `tell application "Terminal" to do script "${typed}"`, '-e', 'tell application "Terminal" to activate'], { stdio: 'ignore' }]
  }
  // shortcut: x-terminal-emulator is Debian and Ubuntu's (where the apt and snap rows run); other distros Copy instead.
  // Detached: the terminal outlives KapeCut.
  return ['x-terminal-emulator', ['-e', 'bash', '-c', `echo ${sq(`> ${command}`)}; ${command}; exec bash`], { detached: true, stdio: 'ignore' }]
}

/**
 * Run on a Setup row: the page sends only the row id, so a terminal only ever runs the fixed table's command. Windows'
 * cmd and a Mac's osascript exit once the window is open (non-zero: refused), so they are waited for; Linux's terminal
 * runs as long as its window, so it counts once started.
 */
export function runInstall(id: unknown, os: Os = HOST, spawn = nodeSpawn) {
  const command = installCommand(id, os)
  if (!command) return Promise.reject(new Error('No install command for that row'))
  const [file, args, options] = terminalArgv(os, command)
  return new Promise<void>((done, fail) => {
    const child = spawn(file, args, options)
    child.on('error', (e) => fail(new Error(`Could not open a terminal: ${e.message}`)))
    if (os === 'linux') child.on('spawn', () => (child.unref(), done()))
    else child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`Could not open a terminal (exit code ${code})`))))
  })
}
