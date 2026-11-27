// main (settings.ts) imports this file for the default: keep it free of DOM and Electron imports.

/** The default idle time (GLOSSARY): no activity for this long and the Agent status turns idle. Settings changes it. */
export const IDLE_MS = 15 * 60_000

/** The Agent's handshake in the Project (ADR 0005, 0008): the Connect prompt asks for it, its existence means connected. */
export const HANDSHAKE = '.kapecut/agent.json'

/** The handshake Projects connected before agent.json hold: still means connected (ADR 0008). */
export const OLD_HANDSHAKE = '.kapecut/claude.json'

/** Every file that means connected. */
export const HANDSHAKES = [HANDSHAKE, OLD_HANDSHAKE]

/**
 * The Agent status (GLOSSARY, ADR 0005): none until a handshake exists, then active until idleMs have passed since
 * the last activity (ms, -Infinity for none yet: a Project reopened with a handshake starts idle).
 */
export const agentStatus = (connected: boolean, lastActivity: number, now: number, idleMs: number) =>
  !connected ? 'none' : now - lastActivity < idleMs ? 'active' : 'idle'
