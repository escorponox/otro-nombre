import { describe, expect, test } from 'claude-code/testing'

import { isDue, pollInterval } from '../hooks/domain/polling'
import { NOW } from './world'

const SECOND = 1000

describe('the polling interval', () => {
  test('is 60 s while the panel is open and five minutes while it is closed', () => {
    expect(pollInterval({ isPaneOpen: true, failures: 0 })).toBe(60 * SECOND)
    expect(pollInterval({ isPaneOpen: false, failures: 0 })).toBe(300 * SECOND)
  })

  test('backs off to 120 s and then 300 s after failures', () => {
    expect(pollInterval({ isPaneOpen: true, failures: 1 })).toBe(120 * SECOND)
    expect(pollInterval({ isPaneOpen: true, failures: 2 })).toBe(300 * SECOND)
    expect(pollInterval({ isPaneOpen: true, failures: 7 })).toBe(300 * SECOND)
  })

  test('never polls a closed panel more often because of a failure', () => {
    expect(pollInterval({ isPaneOpen: false, failures: 1 })).toBe(300 * SECOND)
  })
})

describe('whether a fetch is due', () => {
  test('is due when nothing was ever fetched', () => {
    expect(isDue(undefined, NOW, true)).toBe(true)
    expect(isDue(undefined, NOW, false)).toBe(true)
  })

  test('is due once the cache is as old as the interval', () => {
    const cache = { fetchedAt: NOW - 60 * SECOND, failures: 0 }
    expect(isDue(cache, NOW, true)).toBe(true)
    expect(isDue(cache, NOW - 1, true)).toBe(false)
    expect(isDue(cache, NOW, false)).toBe(false)
  })

  test('waits out the back-off after a failure', () => {
    const cache = { fetchedAt: NOW - 90 * SECOND, failures: 1 }
    expect(isDue(cache, NOW, true)).toBe(false)
    expect(isDue(cache, NOW + 30 * SECOND, true)).toBe(true)
  })
})
