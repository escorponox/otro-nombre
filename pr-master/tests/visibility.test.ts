import { expect, mock, test } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, SURFACES, exceptReviewRequests, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

const NOW = Date.parse('2026-10-16T12:00:00Z')

for (const surface of SURFACES) {
  test(`a pull request in a hidden organisation appears in no tab and no count (${surface})`, { options: { hiddenOrgs: ['legacy-corp'] } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    github(on).searches[MY_PULL_REQUESTS_QUERY] = [
      pullRequestNode(1, { repo: 'acme/api' }),
      pullRequestNode(2, { repo: 'legacy-corp/monolith' }),
    ]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
    expect(await ui.find({ key: 'item:PR_1' })).toBeDefined()
    expect(await ui.find({ key: 'item:PR_2' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a private pull request with the private switch off appears in no tab and no count (${surface})`, { options: { showPrivate: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    github(on).searches[MY_PULL_REQUESTS_QUERY] = [
      pullRequestNode(1, { repo: 'acme/api' }),
      pullRequestNode(2, { repo: 'acme/secret', isPrivate: true }),
    ]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
    expect(await ui.find({ key: 'item:PR_1' })).toBeDefined()
    expect(await ui.find({ key: 'item:PR_2' })).toBeUndefined()
    await ui.unmount()
  })
}

// A settings change reloads the module with the new options. The kit fixes a test's options, so
// this drives the reload alone (a second `session.start`) and shows it refetches, applying the
// options the module now holds; the tests above show those options filter.
for (const surface of SURFACES) {
  test(`a reload with the panel open refreshes it, so a changed setting applies at once (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')

    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1), pullRequestNode(2)]
    await startSession($)
    await clock.settle()
    expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 2')
    await ui.unmount()
  })
}

test('a reload with the panel closed does not reach GitHub', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await startSession($)
  await clock.settle()

  expect(gh.requests).toEqual([])
})

test('private repositories are shown unless the person turns them off', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  github(on).searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(2, { repo: 'acme/secret', isPrivate: true })]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))

  expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
  await ui.unmount()
})

test("the search asks GitHub for each repository's owner and privacy", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.requests[0]?.query).toContain('repository { nameWithOwner isPrivate owner { login } }')
})
