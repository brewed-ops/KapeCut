import { spawn as nodeSpawn } from 'node:child_process'
import { join } from 'node:path'
import { installCommand, type Os } from '../renderer/setup/setup'

const HOST: Os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'

const sq = (s: string) => `'${s.replaceAll("'", "'\\''")}'` // a bash single-quoted string

/**
 * The program and args that open a visible terminal running command, for the user to watch and answer (sudo, licences):
 * PowerShell on Windows, Terminal on a Mac, the default terminal on Linux. The command is one of the fixed table's.
 */
export function terminalArgv(os: Os, command: string, env: Record<string, string | undefined> = process.env): [string, string[]] {
  if (os === 'win') {
    // Base64 UTF-16LE: no quoting for the Windows command line to get wrong. Write-Host shows what runs.
    const script = `Write-Host '> ${command.replaceAll("'", "''")}'; ${command}`
    const powershell = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') // by path: PATH may be what is broken
    return [powershell, ['-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]]
  }
  if (os === 'mac') {
    const typed = command.replaceAll('\\', '\\\\').replaceAll('"', '\\"') // an AppleScript string
    return ['/usr/bin/osascript', ['-e', `tell application "Terminal" to do script "${typed}"`, '-e', 'tell application "Terminal" to activate']]
  }
  // shortcut: x-terminal-emulator is Debian and Ubuntu's (where the apt and snap rows run); other distros Copy instead.
  return ['x-terminal-emulator', ['-e', 'bash', '-c', `echo ${sq(`> ${command}`)}; ${command}; exec bash`]]
}

/** Run on a Setup row: the page sends only the row id, so a terminal only ever runs the fixed table's command. */
export function runInstall(id: unknown, os: Os = HOST, spawn = nodeSpawn) {
  const command = installCommand(id, os)
  if (!command) return Promise.reject(new Error('No install command for that row'))
  const [file, args] = terminalArgv(os, command)
  return new Promise<void>((done, fail) => {
    // Detached: its own console window on Windows, and it outlives KapeCut.
    const child = spawn(file, args, { detached: true, stdio: 'ignore' })
    child.on('spawn', () => (child.unref(), done()))
    child.on('error', (e) => fail(new Error(`Could not open a terminal: ${e.message}`)))
  })
}
