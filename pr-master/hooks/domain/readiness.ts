import { isFailing, isRunning } from './pull-request'
import type { OpenPullRequest, Verdict } from './pull-request'

/** One row of a ladder: when `holds`, the pull request gets `verdict`. */
interface Rung {
  holds: (pr: OpenPullRequest) => boolean
  verdict: Verdict
}

/** The Quill reviewer's login as GitHub's GraphQL API gives it: a GitHub App, without REST's `[bot]` suffix. */
const QUILL_REVIEWER = 'quill-reviewer'

const isBlocked = (pr: OpenPullRequest) => pr.mergeState === 'BLOCKED'
const hasQuillThreads = (pr: OpenPullRequest) => isBlocked(pr) && pr.unresolvedThreadAuthors.includes(QUILL_REVIEWER)
const hasOtherThreads = (pr: OpenPullRequest) => isBlocked(pr) && pr.unresolvedThreadAuthors.length > 0

/** The My pull request ladder (spec "Turn and labels"), first match wins. */
const LADDER: readonly Rung[] = [
  { holds: pr => pr.isDraft, verdict: { turn: 'parked', label: 'Draft' } },
  { holds: pr => pr.mergeable === 'CONFLICTING', verdict: { turn: 'mine', label: 'Merge conflicts' } },
  { holds: isFailing, verdict: { turn: 'mine', label: 'Checks failing' } },
  { holds: pr => pr.reviewDecision === 'CHANGES_REQUESTED', verdict: { turn: 'mine', label: 'Changes requested' } },
  { holds: isRunning, verdict: { turn: 'theirs', label: 'Checks running' } },
  {
    holds: pr => pr.mergeState === 'CLEAN' || pr.mergeState === 'UNSTABLE' || pr.mergeState === 'HAS_HOOKS',
    verdict: { turn: 'done', label: 'Ready to merge' },
  },
  { holds: pr => pr.mergeState === 'BEHIND', verdict: { turn: 'theirs', label: 'Behind base branch' } },
  { holds: pr => pr.mergeState === 'UNKNOWN', verdict: { turn: 'theirs', label: 'Checks running' } },
  { holds: hasQuillThreads, verdict: { turn: 'mine', label: 'Quill comments' } },
  { holds: hasOtherThreads, verdict: { turn: 'mine', label: 'Unresolved comments' } },
]

const OTHERWISE: Verdict = { turn: 'theirs', label: 'Waiting for review' }

/** The Turn and Readiness of a My pull request. */
export function readiness(pr: OpenPullRequest): Verdict {
  return LADDER.find(rung => rung.holds(pr))?.verdict ?? OTHERWISE
}
