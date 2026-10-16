import { describe, expect, test } from 'claude-code/testing'

import type { OpenPullRequest } from '../hooks/domain/pull-request'
import { readiness } from '../hooks/domain/readiness'

/** A My pull request that matches no row of the ladder before the last: waiting for review. */
function pr(facts: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    id: 'PR_1', number: 1, title: 'Title', url: 'https://github.com/acme/api/pull/1',
    repository: 'acme/api', owner: 'acme', isPrivate: false, author: 'me', createdAt: '2026-10-01T00:00:00Z',
    isDraft: false, mergeable: 'MERGEABLE', mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', checks: 'SUCCESS',
    ...facts,
  }
}

describe('the Readiness of a My pull request, one row at a time', () => {
  test('a draft is parked', () => {
    expect(readiness(pr({ isDraft: true }))).toEqual({ turn: 'parked', label: 'Draft' })
  })
  test('merge conflicts are mine', () => {
    expect(readiness(pr({ mergeable: 'CONFLICTING' }))).toEqual({ turn: 'mine', label: 'Merge conflicts' })
  })
  test('failing checks are mine', () => {
    expect(readiness(pr({ checks: 'FAILURE' }))).toEqual({ turn: 'mine', label: 'Checks failing' })
    expect(readiness(pr({ checks: 'ERROR' }))).toEqual({ turn: 'mine', label: 'Checks failing' })
  })
  test('changes requested are mine', () => {
    expect(readiness(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toEqual({ turn: 'mine', label: 'Changes requested' })
  })
  test('running checks are theirs', () => {
    expect(readiness(pr({ checks: 'PENDING' }))).toEqual({ turn: 'theirs', label: 'Checks running' })
    expect(readiness(pr({ checks: 'EXPECTED' }))).toEqual({ turn: 'theirs', label: 'Checks running' })
  })
  test('a clean, unstable or hooked merge state is done', () => {
    for (const mergeState of ['CLEAN', 'UNSTABLE', 'HAS_HOOKS'] as const) {
      expect(readiness(pr({ mergeState }))).toEqual({ turn: 'done', label: 'Ready to merge' })
    }
  })
  test('behind its base branch is theirs', () => {
    expect(readiness(pr({ mergeState: 'BEHIND' }))).toEqual({ turn: 'theirs', label: 'Behind base branch' })
  })
  test('an unknown merge state reads as checks running', () => {
    expect(readiness(pr({ mergeState: 'UNKNOWN' }))).toEqual({ turn: 'theirs', label: 'Checks running' })
  })
  test('otherwise it waits for review', () => {
    expect(readiness(pr())).toEqual({ turn: 'theirs', label: 'Waiting for review' })
    expect(readiness(pr({ checks: null, reviewDecision: null }))).toEqual({ turn: 'theirs', label: 'Waiting for review' })
  })
})

describe('the first matching row wins', () => {
  test('draft before merge conflicts', () => {
    expect(readiness(pr({ isDraft: true, mergeable: 'CONFLICTING', checks: 'FAILURE' })).label).toBe('Draft')
  })
  test('merge conflicts before failing checks', () => {
    expect(readiness(pr({ mergeable: 'CONFLICTING', checks: 'FAILURE' })).label).toBe('Merge conflicts')
  })
  test('failing checks before changes requested', () => {
    expect(readiness(pr({ checks: 'ERROR', reviewDecision: 'CHANGES_REQUESTED' })).label).toBe('Checks failing')
  })
  test('changes requested before running checks', () => {
    expect(readiness(pr({ reviewDecision: 'CHANGES_REQUESTED', checks: 'PENDING' })).label).toBe('Changes requested')
  })
  test('changes requested before a clean merge state', () => {
    expect(readiness(pr({ reviewDecision: 'CHANGES_REQUESTED', mergeState: 'CLEAN' })).label).toBe('Changes requested')
  })
  test('running checks before a clean merge state', () => {
    expect(readiness(pr({ checks: 'PENDING', mergeState: 'CLEAN' })).label).toBe('Checks running')
  })
  test('running checks before behind its base branch', () => {
    expect(readiness(pr({ checks: 'EXPECTED', mergeState: 'BEHIND' })).label).toBe('Checks running')
  })
})
