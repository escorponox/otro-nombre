import { expect, mock, test } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, NOW, SURFACES, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

for (const surface of SURFACES) {
  test(`the status row counts what is ready and what needs the person, and clears when nothing does (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [
      pullRequestNode(1),
      pullRequestNode(2, { checks: 'FAILURE' }),
      pullRequestNode(3, { reviewDecision: 'CHANGES_REQUESTED' }),
      pullRequestNode(4, { checks: 'PENDING' }),
      pullRequestNode(5, { isDraft: true }),
    ]
    await startSession($)
    await runPrs($)
    await clock.settle()
    expect(w.statuses.at(-1)).toBe('● 1 ready · 2 need you')

    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(4, { checks: 'PENDING' })]
    const ui = await $.ui.mount(paneMount(surface))
    await ui.press({ key: 'refresh' })
    expect(w.statuses.length).toBeGreaterThan(1)
    expect(w.statuses.at(-1)).toBeUndefined()
    await ui.unmount()
  })
}
