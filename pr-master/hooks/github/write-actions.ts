import type { PullRequestItem } from '../../types'

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

/** Approve, pinned to the head commit the person saw: the approval is of exactly that commit. */
const APPROVE = `mutation Approve($id: ID!, $headSha: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $id, event: APPROVE, commitOID: $headSha }) { pullRequestReview { id } }
}`

/**
 * The GitHub mutation of the write action `kind` on `item`, or undefined when `kind` is not a
 * write action. To add a write action, add its mutation here and its Button to `items.tsx`.
 */
export function writeRequestOf(kind: string, item: PullRequestItem): WriteRequest | undefined {
  switch (kind) {
    case 'merge':
      return { query: MERGE, variables: { id: item.id, headSha: item.headSha } }
    case 'update':
      return { query: UPDATE_BRANCH, variables: { id: item.id } }
    case 'close':
      return { query: CLOSE, variables: { id: item.id } }
    case 'approve':
      return { query: APPROVE, variables: { id: item.id, headSha: item.headSha } }
    default:
      return undefined
  }
}
