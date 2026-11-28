import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { BREW } from '../renderer/setup/setup'
import { runInstall, terminalArgv } from './terminal'

const decode = (args: string[]) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')

it('Windows: a PowerShell window that shows the command, runs it and stays open', () => {
  const [file, args] = terminalArgv('win', "winget install it's", { SystemRoot: 'C:\\Windows' })
  expect(file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') // by path: PATH may be what is broken
  expect(args.slice(0, 2)).toEqual(['-NoExit', '-EncodedCommand']) // no quoting for Windows to get wrong
  expect(decode(args)).toBe("Write-Host '> winget install it''s'; winget install it's")
})

it('macOS: Terminal types the command in, quotes and backslashes kept', () => {
  const [file, args] = terminalArgv('mac', BREW)
  expect(file).toBe('/usr/bin/osascript')
  expect(args).toEqual([
    '-e',
    'tell application "Terminal" to do script "/bin/bash -c \\"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\\""',
    '-e',
    'tell application "Terminal" to activate',
  ])
  expect(terminalArgv('mac', 'a\\b')[1][1]).toBe('tell application "Terminal" to do script "a\\\\b"')
})

it('Linux: the default terminal runs bash, which shows the command, runs it and stays open', () => {
  const [file, args] = terminalArgv('linux', "sudo apt install it's")
  expect(file).toBe('x-terminal-emulator')
  expect(args).toEqual(['-e', 'bash', '-c', "echo '> sudo apt install it'\\''s'; sudo apt install it's; exec bash"])
})

// A spawn that answers like Node's: 'spawn' once started, 'error' when the program is missing.
const fakeSpawn = (event: 'spawn' | 'error') => {
  const calls: unknown[][] = []
  const spawn = (...args: unknown[]) => {
    calls.push(args)
    const child = Object.assign(new EventEmitter(), { unref: () => {} })
    setTimeout(() => child.emit(event, new Error('spawn x-terminal-emulator ENOENT')))
    return child
  }
  return { calls, spawn: spawn as never }
}

it('Run takes a row id only: the command comes from the table, a detached terminal runs it', async () => {
  const { calls, spawn } = fakeSpawn('spawn')
  await runInstall('ffmpeg', 'linux', spawn)
  expect(calls).toEqual([['x-terminal-emulator', terminalArgv('linux', 'sudo apt install ffmpeg')[1], { detached: true, stdio: 'ignore' }]])
})

it('Run refuses anything but a known row id for this OS, before any spawn', async () => {
  const { calls, spawn } = fakeSpawn('spawn')
  for (const id of ['sudo rm -rf /', '__proto__', 'skill', 'brew', 7, null])
    await expect(runInstall(id, 'win', spawn), String(id)).rejects.toThrow('No install command for that row')
  expect(calls).toEqual([])
})

it('Run says so when no terminal starts', async () => {
  const { spawn } = fakeSpawn('error')
  await expect(runInstall('ffmpeg', 'linux', spawn)).rejects.toThrow('Could not open a terminal: spawn x-terminal-emulator ENOENT')
})
