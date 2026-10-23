import { describe, expect, test } from 'claude-code/testing'

import type { ReviewRequest } from '../hooks/domain/review-state'
import { reviewState } from '../hooks/domain/review-state'

/** A Review request that matches no row of the ladder before the last: it needs my review. */
function pr(facts: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: 'PR_1', number: 1, title: 'Title', url: 'https://github.com/acme/api/pull/1',
    repository: 'acme/api', owner: 'acme', isPrivate: false, author: 'ana', createdAt: '2026-10-01T00:00:00Z',
    isDraft: false, mergeable: 'MERGEABLE', mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', checks: 'SUCCESS',
    headSha: 'sha1', unresolvedThreadAuthors: [],
    myReview: null, requestedTeams: [],
    ...facts,
  }
}

describe('the Review state of a Review request, one row at a time', () => {
  test('changes requested are theirs', () => {
    expect(reviewState(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toEqual({ turn: 'theirs', label: 'Changes requested' })
  })
  test('failing checks are theirs', () => {
    expect(reviewState(pr({ checks: 'FAILURE' }))).toEqual({ turn: 'theirs', label: 'Checks failing' })
    expect(reviewState(pr({ checks: 'ERROR' }))).toEqual({ turn: 'theirs', label: 'Checks failing' })
  })
  test('running checks are theirs', () => {
    expect(reviewState(pr({ checks: 'PENDING' }))).toEqual({ turn: 'theirs', label: 'Checks running' })
    expect(reviewState(pr({ checks: 'EXPECTED' }))).toEqual({ turn: 'theirs', label: 'Checks running' })
  })
  test('my dismissed approval is mine', () => {
    expect(reviewState(pr({ myReview: 'DISMISSED' }))).toEqual({ turn: 'mine', label: 'Approval dismissed' })
  })
  test('my approval is done', () => {
    expect(reviewState(pr({ myReview: 'APPROVED' }))).toEqual({ turn: 'done', label: 'Approved already' })
  })
  test('otherwise it needs my review', () => {
    expect(reviewState(pr())).toEqual({ turn: 'mine', label: 'Needs review' })
    expect(reviewState(pr({ checks: null, reviewDecision: null, myReview: 'COMMENTED' }))).toEqual({ turn: 'mine', label: 'Needs review' })
  })
})

describe('the first matching row wins', () => {
  test('changes requested before failing checks', () => {
    expect(reviewState(pr({ reviewDecision: 'CHANGES_REQUESTED', checks: 'FAILURE' })).label).toBe('Changes requested')
  })
  test('failing checks before my dismissed approval', () => {
    expect(reviewState(pr({ checks: 'ERROR', myReview: 'DISMISSED' })).label).toBe('Checks failing')
  })
  test('running checks before my dismissed approval', () => {
    expect(reviewState(pr({ checks: 'PENDING', myReview: 'DISMISSED' })).label).toBe('Checks running')
  })
  test('changes requested before my approval', () => {
    expect(reviewState(pr({ reviewDecision: 'CHANGES_REQUESTED', myReview: 'APPROVED' })).label).toBe('Changes requested')
  })
  test('running checks before my approval', () => {
    expect(reviewState(pr({ checks: 'EXPECTED', myReview: 'APPROVED' })).label).toBe('Checks running')
  })
})
