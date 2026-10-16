import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, PANE_ID, PLUGIN, SURFACES, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

type Ui = Mounted<(typeof SURFACES)[number], 'Pane'>

const NOW = Date.parse('2026-10-16T12:00:00Z')
const NUMBERS = [1, 2, 3, 4, 5]

/**
 * A body 14 rows tall at 60 columns: header, tabs and the refresh line take 7 rows with their blank
 * lines, leaving 8 rows to the list. Each pull request is two rows, so three show at the top.
 */
const SHORT_BODY = 14

/** The person's wheel tick or arrow key over the pane: `by` rows, negative toward the top. */
async function scroll($: Engine, by: number) {
  return $.ui.scroll({ component: 'Pane', requestId: PANE_ID, offset: Math.max(0, by), by, bodyRows: 40, contentRows: 40, origin: { kind: 'person' } })
}

/** The person's Tab onto the element keyed `element`. */
async function focus($: Engine, element: string) {
  await $.ui.focus({ component: 'Pane', requestId: PANE_ID, plugin: PLUGIN, element, origin: { kind: 'person' } })
}

/** The pull requests the list draws, by number. */
async function drawnNumbers(ui: Ui) {
  const drawn = []
  for (const n of NUMBERS) if (await ui.find({ key: `item:PR_${n}` })) drawn.push(n)
  return drawn
}

/** The pull requests drawn inverse, by number. */
async function inverseNumbers(ui: Ui) {
  const inverse = []
  for (const n of NUMBERS) {
    const ref = (await ui.find({ key: `pr:PR_${n}` }))?.children[0] as { props: { inverse?: boolean } } | undefined
    if (ref?.props.inverse) inverse.push(n)
  }
  return inverse
}

async function moreAbove(ui: Ui) {
  return (await ui.find({ type: 'Text', text: /more above/ }))?.text
}

/** The panel open on five My pull requests, mounted on `surface`. */
async function openWithFive($: Engine, on: On, surface: (typeof SURFACES)[number], bodyRows?: number) {
  const clock = mock.clock(on, { now: NOW })
  const engine = world(on)
  github(on).searches[MY_PULL_REQUESTS_QUERY] = NUMBERS.map(n => pullRequestNode(n))
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount(surface, bodyRows))
  return { ui, engine }
}

for (const surface of SURFACES) {
  test(`the list scrolls by whole pull requests while the tabs stay drawn (${surface})`, async ($, on) => {
    const { ui, engine } = await openWithFive($, on, surface)
    expect(await drawnNumbers(ui)).toEqual([1, 2, 3, 4, 5])
    expect(await moreAbove(ui)).toBeUndefined()

    expect(await scroll($, 1)).toEqual({})
    expect(await drawnNumbers(ui)).toEqual([2, 3, 4, 5])
    expect(await moreAbove(ui)).toBe('↑ 1 more above')
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 5')

    // A page key asks for a whole body of rows: still one pull request.
    await scroll($, 40)
    expect(await drawnNumbers(ui)).toEqual([3, 4, 5])
    expect(await moreAbove(ui)).toBe('↑ 2 more above')

    await scroll($, -1)
    await scroll($, -1)
    expect(await drawnNumbers(ui)).toEqual([1, 2, 3, 4, 5])
    expect(await moreAbove(ui)).toBeUndefined()

    // The mod keeps the engine's window still, so the header never scrolls away.
    expect(engine.engineScrolls).toEqual([])
    await ui.unmount()
  })

  test(`the list stops at its first and last pull requests (${surface})`, async ($, on) => {
    const { ui } = await openWithFive($, on, surface)
    await scroll($, -1)
    expect(await drawnNumbers(ui)).toEqual([1, 2, 3, 4, 5])

    for (let i = 0; i < 8; i++) await scroll($, 1)
    expect(await drawnNumbers(ui)).toEqual([5])
    expect(await moreAbove(ui)).toBe('↑ 4 more above')
    await ui.unmount()
  })

  test(`the list box grows and clips under the fixed header (${surface})`, async ($, on) => {
    const { ui } = await openWithFive($, on, surface)
    expect((await ui.find({ key: 'list' }))?.props).toMatchObject({ flexGrow: 1, flexShrink: 1, overflow: 'hidden' })
    await ui.unmount()
  })

  test(`changing tab brings the list back to its top (${surface})`, async ($, on) => {
    const { ui } = await openWithFive($, on, surface)
    await scroll($, 1)
    await scroll($, 1)

    await ui.press({ key: 'tab:review' })
    await ui.press({ key: 'tab:mine' })
    expect(await drawnNumbers(ui)).toEqual([1, 2, 3, 4, 5])
    expect(await moreAbove(ui)).toBeUndefined()
    await ui.unmount()
  })

  test(`the pull request holding the focus is drawn inverse (${surface})`, async ($, on) => {
    const { ui } = await openWithFive($, on, surface)
    expect(await inverseNumbers(ui)).toEqual([])

    await focus($, 'pr:PR_2')
    expect(await inverseNumbers(ui)).toEqual([2])

    await focus($, 'pr:PR_3')
    expect(await inverseNumbers(ui)).toEqual([3])

    // The focus leaving the list leaves no pull request focused.
    await focus($, 'tab:mine')
    expect(await inverseNumbers(ui)).toEqual([])
    await ui.unmount()
  })

  test(`Tab onto a pull request out of view scrolls the list to it (${surface})`, async ($, on) => {
    const { ui } = await openWithFive($, on, surface, SHORT_BODY)

    await focus($, 'pr:PR_2')
    expect(await moreAbove(ui)).toBeUndefined()

    await focus($, 'pr:PR_4')
    expect(await drawnNumbers(ui)).toEqual([3, 4, 5])
    expect(await moreAbove(ui)).toBe('↑ 2 more above')

    await focus($, 'pr:PR_1')
    expect(await drawnNumbers(ui)).toEqual([1, 2, 3, 4, 5])
    expect(await inverseNumbers(ui)).toEqual([1])
    await ui.unmount()
  })
}
