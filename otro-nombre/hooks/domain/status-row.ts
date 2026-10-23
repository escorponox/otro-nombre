import type { Snapshot } from '../../types'

/** One count the status row can show: its word and how many items of the snapshot it counts. */
interface StatusCount {
  word: string
  count: (shot: Snapshot) => number
}

/** The counts of what waits on the person, in the order the row shows them. Add a row here to show another count. */
const STATUS_COUNTS: readonly StatusCount[] = [
  { word: 'ready', count: shot => shot.mine.filter(item => item.turn === 'done').length },
  { word: 'need you', count: shot => shot.mine.filter(item => item.turn === 'mine').length },
  { word: 'to review', count: shot => shot.review.filter(item => item.turn === 'mine').length },
]

/**
 * The one-row summary under the prompt, such as `● 1 ready · 2 need you`; a count that is zero
 * is left out, and the row is undefined (cleared) when every count is zero.
 */
export function statusRow(shot: Snapshot): string | undefined {
  const parts = STATUS_COUNTS.map(({ word, count }) => ({ word, n: count(shot) }))
    .filter(({ n }) => n > 0)
    .map(({ word, n }) => `${n} ${word}`)
  return parts.length === 0 ? undefined : `● ${parts.join(' · ')}`
}
