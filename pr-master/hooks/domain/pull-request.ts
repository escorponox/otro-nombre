import type { Turn } from '../../types'

/** The state of a commit's checks, as GitHub's status check rollup reports it; `null` when it has none. */
export type ChecksState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null

/** GitHub's `MergeStateStatus`. */
export type MergeState = 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE'

/**
 * An open pull request as GitHub describes it, flattened to plain data by the GitHub client.
 * The domain rules read it; nothing in it knows of Turn or colour.
 */
export interface OpenPullRequest {
  /** GitHub's node id. */
  id: string
  number: number
  title: string
  url: string
  /** `owner/name`. */
  repository: string
  /** The repository owner's login. */
  owner: string
  /** Whether the repository is private. */
  isPrivate: boolean
  /** The author's login. */
  author: string
  /** ISO 8601. */
  createdAt: string
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeState: MergeState
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  /** The head commit's checks. */
  checks: ChecksState
}

/** Whose Turn it is, and the label that says why: a Readiness or a Review state. */
export interface Verdict {
  turn: Turn
  label: string
}
