import { describe, expect, test } from 'claude-code/testing'

import { pressOf } from '../hooks/domain/confirmation'

const T = Date.parse('2026-10-16T12:00:00Z')

describe('the two-press confirmation of a write action', () => {
  test('a press with nothing armed arms the button', () => {
    expect(pressOf(null, 'merge:PR_12', T)).toBe('arm')
  })
  test('a second press of the armed button within three seconds runs the action', () => {
    expect(pressOf({ element: 'merge:PR_12', at: T }, 'merge:PR_12', T)).toBe('run')
    expect(pressOf({ element: 'merge:PR_12', at: T }, 'merge:PR_12', T + 2999)).toBe('run')
  })
  test('a press three seconds or more after arming arms it again', () => {
    expect(pressOf({ element: 'merge:PR_12', at: T }, 'merge:PR_12', T + 3000)).toBe('arm')
  })
  test('a press of another button arms that one, whatever was armed', () => {
    expect(pressOf({ element: 'merge:PR_12', at: T }, 'close:PR_12', T + 1)).toBe('arm')
    expect(pressOf({ element: 'merge:PR_12', at: T }, 'merge:PR_13', T + 1)).toBe('arm')
  })
})
