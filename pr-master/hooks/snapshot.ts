import type { PullRequestItem, Snapshot } from '../types'

/**
 * The snapshot before the first refresh. The `snapshot` value itself is declared as an atom in
 * each file that touches it (the engine's scan wants that): `refresh.ts` writes it, `pane.tsx` reads it.
 */
export const EMPTY_SNAPSHOT: Snapshot = { mine: [], updatedAt: null, problem: null }

/** The pull request with node id `id` in any of the snapshot's lists. */
export function findItem(shot: Snapshot, id: string): PullRequestItem | undefined {
  return shot.mine.find(item => item.id === id)
}
