// main (settings.ts) imports this file for the default: keep it free of DOM and Electron imports.

/** The default idle time (GLOSSARY): no activity for this long and the Claude status turns idle. Settings changes it. */
export const IDLE_MS = 15 * 60_000

/** Claude's handshake in the Project (ADR 0005): the Connect prompt asks for it, its existence means connected. */
export const HANDSHAKE = '.kapecut/claude.json'

/**
 * The Claude status (GLOSSARY, ADR 0005): none until the handshake exists, then active until idleMs have passed since
 * the last activity (ms, -Infinity for none yet: a Project reopened with a handshake starts idle).
 */
export const claudeStatus = (connected: boolean, lastActivity: number, now: number, idleMs: number) =>
  !connected ? 'none' : now - lastActivity < idleMs ? 'active' : 'idle'
