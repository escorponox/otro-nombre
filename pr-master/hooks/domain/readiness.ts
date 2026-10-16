import type { OpenPullRequest, Verdict } from './pull-request'

/** One row of a ladder: when `holds`, the pull request gets `verdict`. */
interface Rung {
  holds: (pr: OpenPullRequest) => boolean
  verdict: Verdict
}

const isFailing = (pr: OpenPullRequest) => pr.checks === 'FAILURE' || pr.checks === 'ERROR'
const isRunning = (pr: OpenPullRequest) => pr.checks === 'PENDING' || pr.checks === 'EXPECTED'

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
]

const OTHERWISE: Verdict = { turn: 'theirs', label: 'Waiting for review' }

/** The Turn and Readiness of a My pull request. */
export function readiness(pr: OpenPullRequest): Verdict {
  return LADDER.find(rung => rung.holds(pr))?.verdict ?? OTHERWISE
}
