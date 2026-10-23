import { describe, expect, test } from 'claude-code/testing'

import type { MergedPullRequestItem, PullRequestItem, Shipment, Snapshot, Turn } from '../types'
import { alertToasts, alertsBetween } from '../hooks/domain/alerts'
import { EMPTY_SNAPSHOT } from '../hooks/snapshot'

function item(n: number, turn: Turn, label: string): PullRequestItem {
  return { id: `PR_${n}`, number: n, repo: 'acme/api', title: `PR ${n}`, url: '', author: 'me', turn, label, ageDays: 0, isStale: false, headSha: '', isBehind: false }
}

const ON_ITS_WAY: Shipment = { ci: 'arrived', release: 'arrived', stg: 'arrived', prod: 'running', tag: 'v1.2.0' }

function merged(n: number, shipment: Partial<Shipment>): MergedPullRequestItem {
  return { id: `PR_${n}`, number: n, repo: 'acme/api', title: `PR ${n}`, url: '', mergedDays: 0, shipment: { ...ON_ITS_WAY, ...shipment } }
}

/** A snapshot a successful refresh filled, with `lists`. */
const snapshot = (lists: Partial<Snapshot>): Snapshot => ({ ...EMPTY_SNAPSHOT, updatedAt: 1, ...lists })

describe('the Alerts between two snapshots', () => {
  test('alert a Review request whose Turn became Mine, with its Review state', () => {
    const before = snapshot({ review: [item(7, 'theirs', 'Checks running')] })
    const after = snapshot({ review: [item(7, 'mine', 'Needs review')] })
    expect(alertsBetween(before, after)).toEqual([{ number: 7, repo: 'acme/api', what: 'Needs review' }])
  })

  test('alert a My pull request whose Turn became Mine, with its Readiness', () => {
    const before = snapshot({ mine: [item(3, 'theirs', 'Waiting for review')] })
    const after = snapshot({ mine: [item(3, 'mine', 'Changes requested')] })
    expect(alertsBetween(before, after)).toEqual([{ number: 3, repo: 'acme/api', what: 'Changes requested' }])
  })

  test('alert a My pull request that became Ready to merge, but not a Review request approved already', () => {
    const before = snapshot({ mine: [item(3, 'theirs', 'Checks running')], review: [item(7, 'mine', 'Needs review')] })
    const after = snapshot({ mine: [item(3, 'done', 'Ready to merge')], review: [item(7, 'done', 'Approved already')] })
    expect(alertsBetween(before, after)).toEqual([{ number: 3, repo: 'acme/api', what: 'Ready to merge' }])
  })

  test('alert nothing when the label changes while the Turn stays Mine', () => {
    const before = snapshot({ mine: [item(3, 'mine', 'Checks failing')] })
    const after = snapshot({ mine: [item(3, 'mine', 'Changes requested')] })
    expect(alertsBetween(before, after)).toEqual([])
  })

  test('alert a Merged pull request that reached production', () => {
    const before = snapshot({ merged: [merged(5, { prod: 'running' })] })
    const after = snapshot({ merged: [merged(5, { prod: 'arrived' })] })
    expect(alertsBetween(before, after)).toEqual([{ number: 5, repo: 'acme/api', what: 'In production' }])
  })

  test('alert a Merged pull request whose CI failed', () => {
    const before = snapshot({ merged: [merged(5, { ci: 'running', release: 'unknown', stg: 'unknown', prod: 'unknown' })] })
    const after = snapshot({ merged: [merged(5, { ci: 'failed', release: 'unknown', stg: 'unknown', prod: 'unknown' })] })
    expect(alertsBetween(before, after)).toEqual([{ number: 5, repo: 'acme/api', what: 'CI failed' }])
  })

  test('alert nothing of a production the Promotions could not be read for before', () => {
    const before = snapshot({ merged: [merged(5, { stg: 'unknown', prod: 'unknown' })], promotionProblem: 'HTTP 502' })
    const after = snapshot({ merged: [merged(5, { prod: 'arrived' })] })
    expect(alertsBetween(before, after)).toEqual([])
  })

  test('alert nothing of staging', () => {
    const before = snapshot({ merged: [merged(5, { stg: 'running' })] })
    const after = snapshot({ merged: [merged(5, { stg: 'arrived' })] })
    expect(alertsBetween(before, after)).toEqual([])
  })

  test('alert nothing from a snapshot no refresh has filled yet', () => {
    const before = snapshot({ updatedAt: null, problem: { kind: 'failed', reason: 'HTTP 502' } })
    const after = snapshot({ mine: [item(3, 'mine', 'Changes requested')], review: [item(7, 'mine', 'Needs review')] })
    expect(alertsBetween(before, after)).toEqual([])
  })
})

describe('the toasts of the Alerts', () => {
  test('say each Alert by its number, its repository name and what it became', () => {
    expect(alertToasts([{ number: 123, repo: 'acme/api', what: 'Changes requested' }])).toEqual(['#123 api · Changes requested'])
  })

  test('sum up more than three Alerts in one toast', () => {
    const alert = (number: number) => ({ number, repo: 'acme/api', what: 'Needs review' })
    expect(alertToasts([1, 2, 3].map(alert))).toHaveLength(3)
    expect(alertToasts([1, 2, 3, 4].map(alert))).toEqual(['4 Alerts · /prs'])
  })
})
