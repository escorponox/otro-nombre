import type { MergedPullRequestItem, PullRequestItem, Shipment, ShipmentStep, Snapshot, Turn } from '../../types'
import { shortRefOf } from './format'
import type { Named } from './format'

/** An Alert: one pull request that changed in a way worth knowing, and what it became. */
export interface Alert extends Named {
  /** What it became: a Readiness, a Review state or a Shipment step. */
  what: string
}

/**
 * The Alerts of what changed from `before` to `after`, the snapshots a session showed one after
 * the other: a My pull request or a Review request whose Turn became Mine, a My pull request that
 * became Ready to merge, and a Merged pull request whose CI failed or that reached production.
 */
export function alertsBetween(before: Snapshot, after: Snapshot): Alert[] {
  // A snapshot no refresh has filled yet (the first one failed) holds no lists to tell apart from.
  if (before.updatedAt === null) return []
  return [
    ...turnBecame('mine', before.mine, after.mine),
    ...becameReadyToMerge(before.mine, after.mine),
    ...turnBecame('mine', before.review, after.review),
    ...stepBecame('ci', 'failed', 'CI failed', before.merged, after.merged),
    // A production that only reads again once the Promotions can be read arrived some time ago.
    ...(before.promotionProblem === null ? stepBecame('prod', 'arrived', 'In production', before.merged, after.merged) : []),
  ]
}

/** The most Alerts told in a toast each; past it, one toast sums them up. */
const MOST_SEPARATE_TOASTS = 3

/** The toasts that tell `alerts`: one each, or one summing them up when there are more than `MOST_SEPARATE_TOASTS`. */
export function alertToasts(alerts: Alert[]): string[] {
  if (alerts.length > MOST_SEPARATE_TOASTS) return [`${alerts.length} Alerts · /prs`]
  return alerts.map(alert => `${shortRefOf(alert)} · ${alert.what}`)
}

/** The My pull requests of `after` that became Ready to merge since `before`: the only Readiness whose Turn is Done. */
function becameReadyToMerge(before: PullRequestItem[], after: PullRequestItem[]): Alert[] {
  return turnBecame('done', before, after)
}

/** The pull requests of `after` whose Turn became `turn` since `before`, a pull request new to `after` included. */
function turnBecame(turn: Turn, before: PullRequestItem[], after: PullRequestItem[]): Alert[] {
  const turnBefore = new Map(before.map(pr => [pr.id, pr.turn]))
  return after.filter(pr => pr.turn === turn && turnBefore.get(pr.id) !== turn).map(pr => ({ number: pr.number, repo: pr.repo, what: pr.label }))
}

/** The Merged pull requests of `after` whose Shipment `step` became `value` since `before`, a pull request new to `after` included. */
function stepBecame(step: keyof Omit<Shipment, 'tag'>, value: ShipmentStep, what: string, before: MergedPullRequestItem[], after: MergedPullRequestItem[]): Alert[] {
  const stepBefore = new Map(before.map(pr => [pr.id, pr.shipment[step]]))
  return after.filter(pr => pr.shipment[step] === value && stepBefore.get(pr.id) !== value).map(pr => ({ number: pr.number, repo: pr.repo, what }))
}
