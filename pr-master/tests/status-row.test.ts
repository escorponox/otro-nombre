import { describe, expect, test } from 'claude-code/testing'

import type { PullRequestItem, Turn } from '../types'
import { statusRow } from '../hooks/domain/status-row'
import { EMPTY_SNAPSHOT } from '../hooks/snapshot'

function item(n: number, turn: Turn): PullRequestItem {
  return { id: `PR_${n}`, number: n, repo: 'acme/api', title: `PR ${n}`, url: '', author: 'me', turn, label: '', ageDays: 0, isStale: false }
}

const withMine = (...turns: Turn[]) => ({ ...EMPTY_SNAPSHOT, mine: turns.map((turn, n) => item(n, turn)) })

describe('the status row', () => {
  test('counts My pull requests that are Done as ready and those that are Mine as need you', () => {
    expect(statusRow(withMine('done', 'mine', 'mine', 'theirs', 'parked'))).toBe('● 1 ready · 2 need you')
  })

  test('leaves out a count that is zero', () => {
    expect(statusRow(withMine('done', 'done', 'theirs'))).toBe('● 2 ready')
    expect(statusRow(withMine('mine', 'parked'))).toBe('● 1 need you')
  })

  test('is undefined when nothing waits on the person', () => {
    expect(statusRow(withMine('theirs', 'parked'))).toBeUndefined()
    expect(statusRow(EMPTY_SNAPSHOT)).toBeUndefined()
  })
})
