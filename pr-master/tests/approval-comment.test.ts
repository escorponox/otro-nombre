import { describe, expect, test } from 'claude-code/testing'

import { APPROVAL_COMMENTS, approvalComment } from '../hooks/domain/approval-comment'

describe('the comment an approval carries', () => {
  test('the lowest random number picks the first comment', () => {
    expect(approvalComment(() => 0)).toBe(APPROVAL_COMMENTS[0])
  })
  test('the highest random number picks the last comment', () => {
    expect(approvalComment(() => 0.9999)).toBe(APPROVAL_COMMENTS[APPROVAL_COMMENTS.length - 1])
  })
  test('every comment is non-empty and different from the others', () => {
    expect(APPROVAL_COMMENTS.every(comment => comment.trim() !== '')).toBe(true)
    expect(new Set(APPROVAL_COMMENTS).size).toBe(APPROVAL_COMMENTS.length)
  })
})
