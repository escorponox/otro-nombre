import { isFailing, isRunning } from './pull-request'
import type { OpenPullRequest, Verdict } from './pull-request'

/** GitHub's `PullRequestReviewState`. */
export type ReviewStateOnGitHub = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

/** An open pull request by someone else that the person is asked to review. */
export interface ReviewRequest extends OpenPullRequest {
  /** The person's latest review of it; null when they have not reviewed it. */
  myReview: ReviewStateOnGitHub | null
  /** The teams asked to review it (`org/team`): the team searches it was found in, and for a dismissed approval its timeline. */
  requestedTeams: string[]
}

/** One row of the ladder: when `holds`, the Review request gets `verdict`. */
interface Rung {
  holds: (pr: ReviewRequest) => boolean
  verdict: Verdict
}

/** The Review request ladder (spec "Turn and labels"), first match wins. */
const LADDER: readonly Rung[] = [
  { holds: pr => pr.reviewDecision === 'CHANGES_REQUESTED', verdict: { turn: 'theirs', label: 'Changes requested' } },
  { holds: isFailing, verdict: { turn: 'theirs', label: 'Checks failing' } },
  { holds: isRunning, verdict: { turn: 'theirs', label: 'Checks running' } },
  { holds: pr => pr.myReview === 'DISMISSED', verdict: { turn: 'mine', label: 'Approval dismissed' } },
  { holds: pr => pr.myReview === 'APPROVED', verdict: { turn: 'done', label: 'Approved already' } },
]

const OTHERWISE: Verdict = { turn: 'mine', label: 'Needs review' }

/** The Turn and Review state of a Review request. */
export function reviewState(pr: ReviewRequest): Verdict {
  return LADDER.find(rung => rung.holds(pr))?.verdict ?? OTHERWISE
}
