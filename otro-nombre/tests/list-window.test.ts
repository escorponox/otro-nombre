import { describe, expect, test } from 'claude-code/testing'

import { offsetShowing, scrolledOffset } from '../hooks/domain/list-window'

describe('scrolling the list by whole pull requests', () => {
  test('moves one pull request per scroll, whatever the rows asked', () => {
    expect(scrolledOffset(0, 1, 5)).toBe(1)
    expect(scrolledOffset(2, 40, 5)).toBe(3)
    expect(scrolledOffset(3, -1, 5)).toBe(2)
    expect(scrolledOffset(3, -40, 5)).toBe(2)
  })
  test('stops at the first pull request and keeps the last one showing', () => {
    expect(scrolledOffset(0, -1, 5)).toBe(0)
    expect(scrolledOffset(4, 1, 5)).toBe(4)
    expect(scrolledOffset(0, 1, 0)).toBe(0)
  })
  test('a shrunken list pulls an offset past its end back to its last pull request', () => {
    expect(scrolledOffset(7, 1, 3)).toBe(2)
  })
})

describe('bringing the focused pull request into view', () => {
  // Five pull requests two rows tall, a blank line apart; the list box has eight rows.
  const window = { heights: [2, 2, 2, 2, 2], rows: 8 }

  test('does not move when the pull request already shows whole', () => {
    expect(offsetShowing(2, { ...window, offset: 0 })).toBe(0)
  })
  test('scrolls up to a pull request above the list', () => {
    expect(offsetShowing(1, { ...window, offset: 3 })).toBe(1)
  })
  test('scrolls down the least that shows a pull request below the list, counting the "more above" line', () => {
    // From 1: the line above and its blank (2) + three items (2 + 1 + 2 + 1 + 2) = 10 rows: too many.
    expect(offsetShowing(3, { ...window, offset: 0 })).toBe(2)
    expect(offsetShowing(4, { ...window, offset: 0 })).toBe(3)
  })
  test('puts a pull request taller than the list at the top', () => {
    expect(offsetShowing(1, { heights: [2, 20], rows: 8, offset: 0 })).toBe(1)
  })
})
