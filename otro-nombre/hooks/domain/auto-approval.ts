import type { ReviewRequest } from './review-state'

/** A Review request at one head commit: `<node id>@<head SHA>`. A new commit makes a new one. */
export const autoApprovalKey = (pr: { id: string; headSha: string }) => `${pr.id}@${pr.headSha}`

/**
 * The Review requests at the commits the mod has dealt with, kept in `$.store` by every session:
 * the ones it approved or tried to, and the ones listed when a team was turned to Auto-approval,
 * which it leaves alone. Valued with when, in `$.clock.now()` milliseconds.
 */
export type HandledAutoApprovals = Record<string, number>

/** How long a handled Review request is remembered: past the longest review window. */
export const HANDLED_KEPT_MS = 60 * 24 * 60 * 60 * 1000

/**
 * Whether `pr` qualifies for an Auto-approval: asked of at least one of `autoTeams`, its checks
 * passed (a commit with no checks has not), no one requested changes, and the person's latest
 * review of it is not a standing approval.
 */
export function isAutoApprovable(pr: ReviewRequest, autoTeams: readonly string[]): boolean {
  return (
    pr.requestedTeams.some(team => autoTeams.includes(team)) &&
    !pr.isDraft &&
    pr.checks === 'SUCCESS' &&
    pr.reviewDecision !== 'CHANGES_REQUESTED' &&
    pr.myReview !== 'APPROVED'
  )
}

/** Of `prs`, the ones at a commit not yet `handled`. */
export function notHandled<PR extends { id: string; headSha: string }>(prs: readonly PR[], handled: HandledAutoApprovals): PR[] {
  return prs.filter(pr => !Object.hasOwn(handled, autoApprovalKey(pr)))
}

/** `handled` plus `prs` handled at `now`, less what was handled more than `HANDLED_KEPT_MS` ago. */
export function withHandled(handled: HandledAutoApprovals, prs: readonly { id: string; headSha: string }[], now: number): HandledAutoApprovals {
  const kept = Object.entries(handled).filter(([, at]) => now - at <= HANDLED_KEPT_MS)
  return { ...Object.fromEntries(kept), ...Object.fromEntries(prs.map(pr => [autoApprovalKey(pr), now])) }
}

/** The handled Review requests in a `$.store` value, leaving out anything else. */
export function handledOf(stored: unknown): HandledAutoApprovals {
  if (typeof stored !== 'object' || stored === null) return {}
  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
}
