import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { BREW } from '../renderer/setup/setup'
import { runInstall, terminalArgv } from './terminal'

it('Windows: start opens a PowerShell window that shows the command, runs it and stays open', () => {
  const [file, args, options] = terminalArgv('win', "winget install it's", { SystemRoot: 'C:\\Windows' })
  expect(file).toBe('C:\\Windows\\System32\\cmd.exe') // by path: PATH may be what is broken
  expect(args).toHaveLength(1)
  const [, b64] = /^\/d \/c start "KapeCut" "C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe" -NoProfile -NoExit -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(args[0])!
  expect(Buffer.from(b64, 'base64').toString('utf16le')).toBe("Write-Host '> winget install it''s'; winget install it's")
  expect(options).toEqual({ stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true }) // no detach: it never runs
})

it("macOS: Terminal types the command in, with Homebrew's dirs on PATH, quotes and backslashes kept", () => {
  const [file, args] = terminalArgv('mac', BREW)
  expect(file).toBe('/usr/bin/osascript')
  expect(args).toEqual([
    '-e',
    'tell application "Terminal" to do script "export PATH=\\"/opt/homebrew/bin:/usr/local/bin:$PATH\\"; /bin/bash -c \\"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\\""',
    '-e',
    'tell application "Terminal" to activate',
  ])
  expect(terminalArgv('mac', 'a\\b')[1][1]).toMatch(/; a\\\\b"$/)
})

it('Linux: the default terminal runs bash, which shows the command, runs it and stays open', () => {
  const [file, args, options] = terminalArgv('linux', "sudo apt install it's")
  expect(file).toBe('x-terminal-emulator')
  expect(args).toEqual(['-e', 'bash', '-c', "echo '> sudo apt install it'\\''s'; sudo apt install it's; exec bash"])
  expect(options).toEqual({ detached: true, stdio: 'ignore' })
})

// A spawn that answers like Node's: 'spawn' once started, then 'exit' with a code; or 'error' when the program is missing.
const fakeSpawn = (outcome: { exit: number } | 'error') => {
  const calls: unknown[][] = []
  const spawn = (...args: unknown[]) => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), { unref: () => {} })
    setTimeout(() => {
      if (outcome === 'error') return child.emit('error', new Error('spawn x-terminal-emulator ENOENT'))
      child.emit('spawn')
      child.emit('exit', outcome.exit)
    })
    return child
  }
  return { calls, spawn: spawn as never }
}

it('Run takes a row id only: the command comes from the table', async () => {
  const { calls, spawn } = fakeSpawn({ exit: 0 })
  await runInstall('ffmpeg', 'linux', spawn)
  await runInstall('ffmpeg', 'mac', spawn)
  expect(calls).toEqual([terminalArgv('linux', 'sudo apt install ffmpeg'), terminalArgv('mac', 'brew install ffmpeg')])
})

it('Run refuses anything but a known row id for this OS, before any spawn', async () => {
  const { calls, spawn } = fakeSpawn({ exit: 0 })
  for (const id of ['sudo rm -rf /', '__proto__', 'skill', 'brew', 7, null])
    await expect(runInstall(id, 'win', spawn), String(id)).rejects.toThrow('No install command for that row')
  expect(calls).toEqual([])
})

it('Run says so when no terminal opens: a missing program, or cmd or osascript refused', async () => {
  await expect(runInstall('ffmpeg', 'linux', fakeSpawn('error').spawn)).rejects.toThrow('Could not open a terminal: spawn x-terminal-emulator ENOENT')
  await expect(runInstall('ffmpeg', 'mac', fakeSpawn({ exit: 1 }).spawn)).rejects.toThrow('Could not open a terminal (exit code 1)')
  await expect(runInstall('ffmpeg', 'win', fakeSpawn({ exit: 9009 }).spawn)).rejects.toThrow('Could not open a terminal (exit code 9009)')
  await expect(runInstall('ffmpeg', 'linux', fakeSpawn({ exit: 1 }).spawn)).resolves.toBeUndefined() // its terminal started: the window is the user's
})
