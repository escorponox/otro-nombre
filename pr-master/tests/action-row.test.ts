import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, PANE_ID, PLUGIN, SURFACES, github, paneMount, pullRequestNode, runPrs, startSession, textOf, world } from './world'
import type { Drawn } from './world'

type Ui = Mounted<(typeof SURFACES)[number], 'Pane'>

const NOW = Date.parse('2026-10-16T12:00:00Z')

/** The panel open on My pull requests #12 and #13 in acme/api, mounted on `surface`. */
async function openPanel($: Engine, on: On, surface: (typeof SURFACES)[number]) {
  const clock = mock.clock(on, { now: NOW })
  const engine = world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(12), pullRequestNode(13)]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount(surface))
  return { ui, engine, gh }
}

/** The person's Tab onto the element keyed `element`. */
async function focus($: Engine, element: string) {
  await $.ui.focus({ component: 'Pane', requestId: PANE_ID, plugin: PLUGIN, element, origin: { kind: 'person' } })
}

for (const surface of SURFACES) {
  test(`pressing #number repo opens the pull request in the browser (${surface})`, async ($, on) => {
    const { ui, gh } = await openPanel($, on, surface)

    await ui.press({ key: 'pr:PR_12' })
    expect(gh.argvs.filter(argv => argv[0] === 'open')).toEqual([['open', 'https://github.com/acme/api/pull/12']])
    await ui.unmount()
  })

  test(`a failure to open the pull request shows on the refresh line until the next press (${surface})`, async ($, on) => {
    const { ui, gh } = await openPanel($, on, surface)
    gh.openFailure = 'LSOpenURLsWithRole() failed\n'

    await ui.press({ key: 'pr:PR_12' })
    expect(await footer(ui)).toMatch(/^Couldn't open #12 acme\/api \(LSOpenURLsWithRole\(\) failed\) · Updated \d\d:\d\d$/)

    gh.openFailure = undefined
    await ui.press({ key: 'pr:PR_13' })
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d$/)
    await ui.unmount()
  })

  test(`every pull request shows its actions on a line of their own under its title (${surface})`, async ($, on) => {
    const { ui } = await openPanel($, on, surface)

    for (const id of ['PR_12', 'PR_13']) {
      const [, column] = (await ui.find({ key: `item:${id}` }))?.children as Drawn[]
      const [, title, actions] = column?.children as Drawn[]
      expect(textOf(title)).toBe(`Pull request ${id.slice(3)}`)
      expect(actions?.props).toMatchObject({ key: `actions:${id}`, flexDirection: 'row' })
      // An empty gap left stale cells after a scroll: Buttons are separated by a drawn space.
      expect(actions?.props.gap).toBeUndefined()
      expect(actions?.props.columnGap).toBeUndefined()
      expect((await ui.find({ key: `copy:${id}` }))?.text).toBe('Copy link')
    }
    await ui.unmount()
  })

  test(`Copy link copies the pull request's URL on the surface it was pressed on (${surface})`, async ($, on) => {
    const { ui, engine } = await openPanel($, on, surface)

    await ui.press({ key: 'copy:PR_13' })
    expect(engine.copies).toEqual([{ text: 'https://github.com/acme/api/pull/13', surface }])
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d$/)
    await ui.unmount()
  })

  test(`a copy that reaches no clipboard shows on the refresh line (${surface})`, async ($, on) => {
    const { ui, engine } = await openPanel($, on, surface)
    engine.clipboard.copyFails = true

    await ui.press({ key: 'copy:PR_12' })
    expect(await footer(ui)).toMatch(/^Couldn't copy the link of #12 acme\/api \(no-clipboard\) · Updated \d\d:\d\d$/)
    await ui.unmount()
  })

  test(`only the pull request holding the focus has hotkeys on its actions (${surface})`, async ($, on) => {
    const { ui, engine } = await openPanel($, on, surface)
    expect((await ui.find({ key: 'copy:PR_12' }))?.props.hotkey).toBeUndefined()
    expect((await ui.find({ key: 'copy:PR_13' }))?.props.hotkey).toBeUndefined()

    await focus($, 'pr:PR_13')
    expect((await ui.find({ key: 'copy:PR_12' }))?.props.hotkey).toBeUndefined()
    expect((await ui.find({ key: 'copy:PR_13' }))?.props.hotkey).toBe('c')
    // A plain Button draws its hotkey as a visible prefix: #number repo never carries one.
    expect((await ui.find({ key: 'pr:PR_13' }))?.props).toMatchObject({ plain: true })
    expect((await ui.find({ key: 'pr:PR_13' }))?.props.hotkey).toBeUndefined()

    // c presses the focused pull request's Copy link.
    await ui.press({ key: 'copy:PR_13' })
    expect(engine.copies.map(copy => copy.text)).toEqual(['https://github.com/acme/api/pull/13'])

    await focus($, 'copy:PR_12')
    expect((await ui.find({ key: 'copy:PR_12' }))?.props.hotkey).toBe('c')
    expect((await ui.find({ key: 'copy:PR_13' }))?.props.hotkey).toBeUndefined()
    await ui.unmount()
  })
}

async function footer(ui: Ui) {
  return (await ui.find({ key: 'footer' }))?.text ?? ''
}
