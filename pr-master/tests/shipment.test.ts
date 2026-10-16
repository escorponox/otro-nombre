import { describe, expect, test } from 'claude-code/testing'

import type { MergedPullRequest, MergeCommit, Release } from '../hooks/domain/shipment'
import { isContained, releaseCandidates, shipStatus, shipment } from '../hooks/domain/shipment'

const MERGED_AT = '2026-10-15T10:00:00Z'

/** A merged pull request whose merge commit's checks all passed. */
function pr(mergeCommit: Partial<MergeCommit> | null = {}): MergedPullRequest {
  return {
    id: 'PR_1', number: 1, title: 'Title', url: 'https://github.com/acme/api/pull/1', repository: 'acme/api', owner: 'acme', isPrivate: false,
    mergedAt: MERGED_AT,
    mergeCommit: mergeCommit && { oid: 'abc123', checks: 'SUCCESS', contexts: ['SUCCESS', 'SUCCESS'], ...mergeCommit },
    releases: [],
  }
}

const V1: Release = { tag: 'v1.0.0', createdAt: '2026-10-15T11:00:00Z', isDraft: false }

describe('the ship status of a merged pull request, one row at a time', () => {
  test('with no merge commit it is pending', () => {
    expect(shipStatus(pr(null), null)).toBe('pending')
  })
  test('any failing context makes it failed', () => {
    for (const failing of ['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE']) {
      expect(shipStatus(pr({ checks: 'PENDING', contexts: ['SUCCESS', failing, 'IN_PROGRESS'] }), null)).toBe('failed')
    }
  })
  test('a failing rollup makes it failed', () => {
    expect(shipStatus(pr({ checks: 'FAILURE', contexts: [] }), null)).toBe('failed')
  })
  test('a pending rollup makes it building', () => {
    expect(shipStatus(pr({ checks: 'PENDING', contexts: ['SUCCESS', 'IN_PROGRESS'] }), null)).toBe('building')
    expect(shipStatus(pr({ checks: 'EXPECTED', contexts: [] }), null)).toBe('building')
  })
  test('with the earliest containing release it is released', () => {
    expect(shipStatus(pr(), V1)).toBe('released')
  })
  test('with no containing release it is pending', () => {
    expect(shipStatus(pr(), null)).toBe('pending')
    expect(shipStatus(pr({ checks: null, contexts: [] }), null)).toBe('pending')
  })
})

describe('the first matching row wins', () => {
  test('no merge commit before anything else', () => {
    expect(shipStatus(pr(null), V1)).toBe('pending')
  })
  test('failed before building', () => {
    expect(shipStatus(pr({ checks: 'PENDING', contexts: ['FAILURE', 'PENDING'] }), null)).toBe('failed')
  })
  test('failed and building before released', () => {
    expect(shipStatus(pr({ checks: 'FAILURE', contexts: ['FAILURE'] }), V1)).toBe('failed')
    expect(shipStatus(pr({ checks: 'PENDING', contexts: ['PENDING'] }), V1)).toBe('building')
  })
})

describe('the releases that may contain a merge commit', () => {
  const release = (tag: string, createdAt: string, isDraft = false): Release => ({ tag, createdAt, isDraft })

  test('are the releases created after the merge, earliest first', () => {
    const releases = [
      release('v1.3.0', '2026-10-16T09:00:00Z'),
      release('v1.2.0', '2026-10-15T12:00:00Z'),
      release('v1.1.0', '2026-10-14T09:00:00Z'),
    ]
    expect(releaseCandidates({ ...pr(), releases }).map(r => r.tag)).toEqual(['v1.2.0', 'v1.3.0'])
  })
  test('skip releases created before the merge', () => {
    expect(releaseCandidates({ ...pr(), releases: [release('v1.1.0', '2026-10-15T09:59:59Z')] })).toEqual([])
  })
  test('ignore draft releases', () => {
    expect(releaseCandidates({ ...pr(), releases: [release('v1.2.0', '2026-10-15T12:00:00Z', true)] })).toEqual([])
  })
})

describe('a release contains the merge commit', () => {
  test('when the merge commit is behind its tag or is its tag', () => {
    expect(isContained('BEHIND')).toBe(true)
    expect(isContained('IDENTICAL')).toBe(true)
  })
  test('not when the merge commit is ahead of its tag or has diverged from it', () => {
    expect(isContained('AHEAD')).toBe(false)
    expect(isContained('DIVERGED')).toBe(false)
  })
})

describe('the Shipment steps of a merged pull request', () => {
  const PUBLISHES: Release[] = [{ tag: 'v0.9.0', createdAt: '2026-10-01T00:00:00Z', isDraft: false }]

  test('released: CI and release arrived, with the release tag', () => {
    expect(shipment(pr(), V1)).toEqual({ ci: 'arrived', release: 'arrived', stg: 'unknown', prod: 'unknown', tag: 'v1.0.0' })
  })
  test('CI passed and the repo publishes releases: the release is on its way', () => {
    expect(shipment({ ...pr(), releases: PUBLISHES }, null)).toMatchObject({ ci: 'arrived', release: 'running', tag: null })
  })
  test('CI passed but the repo publishes no releases: the release does not apply', () => {
    expect(shipment(pr(), null)).toMatchObject({ ci: 'arrived', release: 'unknown' })
    expect(shipment({ ...pr(), releases: [{ ...V1, isDraft: true }] }, null)).toMatchObject({ release: 'unknown' })
  })
  test('failed CI: CI failed, no release to wait for', () => {
    expect(shipment({ ...pr({ checks: 'FAILURE', contexts: ['FAILURE'] }), releases: PUBLISHES }, null))
      .toMatchObject({ ci: 'failed', release: 'unknown' })
  })
  test('building: CI on its way, the release not yet', () => {
    expect(shipment({ ...pr({ checks: 'PENDING', contexts: ['IN_PROGRESS'] }), releases: PUBLISHES }, null))
      .toMatchObject({ ci: 'running', release: 'unknown' })
  })
  test('no checks on the merge commit: CI unknown, the release still on its way', () => {
    expect(shipment({ ...pr({ checks: null, contexts: [] }), releases: PUBLISHES }, null)).toMatchObject({ ci: 'unknown', release: 'running' })
  })
  test('no merge commit: every step unknown', () => {
    expect(shipment({ ...pr(null), releases: PUBLISHES }, null))
      .toEqual({ ci: 'unknown', release: 'unknown', stg: 'unknown', prod: 'unknown', tag: null })
  })
})
