import { describe, expect, it } from 'vitest'
import { claudeStatus, IDLE_MS } from './status'

const MIN = 60_000

describe('claudeStatus', () => {
  it('is none without a handshake, whatever the activity', () => {
    expect(claudeStatus(false, 1000, 1000, IDLE_MS)).toBe('none')
    expect(claudeStatus(false, -Infinity, 1000, IDLE_MS)).toBe('none')
  })

  it('is active right after activity, until the idle time has passed', () => {
    expect(claudeStatus(true, 0, 0, IDLE_MS)).toBe('active')
    expect(claudeStatus(true, 0, 15 * MIN - 1, IDLE_MS)).toBe('active')
  })

  it('turns idle exactly at the idle time (15 minutes by default)', () => {
    expect(IDLE_MS).toBe(15 * MIN)
    expect(claudeStatus(true, 0, 15 * MIN, IDLE_MS)).toBe('idle')
    expect(claudeStatus(true, 0, 3 * MIN, 2 * MIN)).toBe('idle')
  })

  it('turns active again on the next activity', () => {
    expect(claudeStatus(true, 0, 20 * MIN, IDLE_MS)).toBe('idle')
    expect(claudeStatus(true, 20 * MIN, 20 * MIN, IDLE_MS)).toBe('active')
  })

  it('starts idle for a Project reopened with a handshake (no activity yet)', () => {
    expect(claudeStatus(true, -Infinity, 1_000_000, IDLE_MS)).toBe('idle')
  })
})
