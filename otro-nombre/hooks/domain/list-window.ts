/**
 * The list scrolls by whole pull requests: its window is an item offset, the index of the first
 * pull request drawn. Above it, when it is past zero, the list draws a "↑ N more above" line.
 */

/** The rows the "↑ N more above" line takes, with the blank line under it. */
const MORE_ABOVE_ROWS = 2
/** The blank line between two pull requests. */
const GAP_ROWS = 1

/**
 * The offset after a scroll of `by` rows over a list of `count` pull requests: one pull request
 * per scroll whatever the rows asked, never above the first nor past the last.
 */
export function scrolledOffset(offset: number, by: number, count: number): number {
  return clampOffset(offset + Math.sign(by), count)
}

/** `offset` kept inside a list of `count` pull requests, so the last one always shows. */
export function clampOffset(offset: number, count: number): number {
  return Math.max(0, Math.min(offset, count - 1))
}

/** The list as the window math sees it. */
export interface ListWindow {
  /** The current item offset. */
  offset: number
  /** Each pull request's height in rows, in list order. */
  heights: readonly number[]
  /** The rows the list box has. */
  rows: number
}

/**
 * The offset that shows the pull request at `index` whole, moving the least (as the DOM's
 * `scrollIntoView({ block: 'nearest' })`): it stays when the pull request already shows; a pull
 * request above the list becomes the first; one below becomes the last that fits, or the first
 * when it is taller than the list.
 */
export function offsetShowing(index: number, { offset, heights, rows }: ListWindow): number {
  if (index < offset) return index
  let first = offset
  while (first < index && rowsFrom(first, index, heights) > rows) first++
  return first
}

/** The rows the list takes drawing the pull requests `first` to `last`, the "more above" line included. */
function rowsFrom(first: number, last: number, heights: readonly number[]): number {
  let rows = first > 0 ? MORE_ABOVE_ROWS : 0
  for (let i = first; i <= last; i++) rows += (heights[i] ?? 0) + (i > first ? GAP_ROWS : 0)
  return rows
}
