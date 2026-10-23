import type { MergedPullRequestItem, PullRequestItem, Snapshot } from '../types'

/**
 * The snapshot before the first refresh. The `snapshot` value itself is declared as an atom in
 * each file that touches it (the engine's scan wants that): `refresh.ts` writes it, `pane.tsx` reads it.
 */
export const EMPTY_SNAPSHOT: Snapshot = {
  mine: [],
  review: [],
  teams: [],
  merged: [],
  promotionProblem: null,
  updatedAt: null,
  problem: null,
}

/** The pull request with node id `id` in any of the snapshot's lists, merged ones included. */
export function findItem(shot: Snapshot, id: string): PullRequestItem | MergedPullRequestItem | undefined {
  return findOpenItem(shot, id) ?? shot.merged.find(item => item.id === id)
}

/** The open pull request with node id `id`: a My pull request or a Review request. */
export function findOpenItem(shot: Snapshot, id: string): PullRequestItem | undefined {
  return [...shot.mine, ...shot.review].find(item => item.id === id)
}
