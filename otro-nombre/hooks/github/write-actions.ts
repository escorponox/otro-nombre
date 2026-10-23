import type { PullRequestItem, WriteActionKind } from '../../types'
import { approvalComment } from '../domain/approval-comment'

/** A GraphQL mutation and its variables. */
export interface WriteRequest {
  query: string
  variables: Record<string, unknown>
}

/** Squash merge, pinned to the head commit the person saw: GitHub refuses it if the head moved. */
const MERGE = `mutation SquashMerge($id: ID!, $headSha: GitObjectID!) {
  mergePullRequest(input: { pullRequestId: $id, mergeMethod: SQUASH, expectedHeadOid: $headSha }) { pullRequest { id } }
}`

/** Update branch with a merge commit from the base branch. */
const UPDATE_BRANCH = `mutation UpdateBranch($id: ID!) {
  updatePullRequestBranch(input: { pullRequestId: $id, updateMethod: MERGE }) { pullRequest { id } }
}`

const CLOSE = `mutation Close($id: ID!) {
  closePullRequest(input: { pullRequestId: $id }) { pullRequest { id } }
}`

/** Approve with a comment, pinned to the head commit the person saw: the approval is of exactly that commit. */
const APPROVE = `mutation Approve($id: ID!, $headSha: GitObjectID!, $body: String!) {
  addPullRequestReview(input: { pullRequestId: $id, event: APPROVE, commitOID: $headSha, body: $body }) { pullRequestReview { id } }
}`

/** Every write action, as a record so the compiler asks for a new one here. */
const WRITE_ACTIONS: Record<WriteActionKind, true> = { merge: true, update: true, close: true, approve: true }

/** Whether the action `kind` (as in its Button's key) is a write action. */
export function isWriteAction(kind: string): kind is WriteActionKind {
  return Object.hasOwn(WRITE_ACTIONS, kind)
}

/**
 * The GitHub mutation of the write action `kind` on `item`. To add a write action, add its kind
 * to `WriteActionKind`, its mutation here and its Button to `items.tsx`.
 */
export function writeRequestOf(kind: WriteActionKind, item: PullRequestItem): WriteRequest {
  switch (kind) {
    case 'merge':
      return { query: MERGE, variables: { id: item.id, headSha: item.headSha } }
    case 'update':
      return { query: UPDATE_BRANCH, variables: { id: item.id } }
    case 'close':
      return { query: CLOSE, variables: { id: item.id } }
    case 'approve':
      return { query: APPROVE, variables: { id: item.id, headSha: item.headSha, body: approvalComment() } }
  }
}
