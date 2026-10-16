import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, PANE_ID, PLUGIN, SURFACES, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

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
}

async function footer(ui: Ui) {
  return (await ui.find({ key: 'footer' }))?.text ?? ''
}
