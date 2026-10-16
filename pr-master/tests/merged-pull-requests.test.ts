import { expect, mock, test } from 'claude-code/testing'

import { GRAPHQL_URL, SURFACES, drawnMergedItem, github, mergedPullRequestNode, paneMount, runPrs, startSession, world } from './world'

const NOW = Date.parse('2026-10-16T12:00:00Z')

const mergedSearch = (since: string) => `is:pr is:merged author:@me archived:false merged:>${since} sort:updated-desc`

test('opening the panel searches for pull requests merged within the last week by default', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.mergedRequests).toHaveLength(1)
  expect(gh.mergedRequests[0]).toMatchObject({ url: GRAPHQL_URL, method: 'POST', variables: { q: mergedSearch('2026-10-09T12:00:00+00:00') } })
  expect(gh.mergedRequests[0]?.query).toContain('statusCheckRollup { state contexts')
})

for (const [window, since] of [['1d', '2026-10-15T12:00:00+00:00'], ['3d', '2026-10-13T12:00:00+00:00']] as const) {
  test(`the merged window ${window} searches from ${since}`, { options: { mergedWindow: window } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    await startSession($)
    await runPrs($)
    await clock.settle()

    expect(gh.mergedRequests.map(request => request.variables.q)).toEqual([mergedSearch(since)])
  })
}

for (const surface of SURFACES) {
  test(`the Merged tab lists Merged pull requests with their title, Shipment dots and ref (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.merged = [
      mergedPullRequestNode(12, {
        repo: 'acme/api',
        title: 'Add the thing',
        releases: [{ tag: 'v1.2.0', createdAt: '2026-10-15T11:00:00Z' }],
      }),
      mergedPullRequestNode(13, { repo: 'acme/web', checks: 'FAILURE', conclusions: ['SUCCESS', 'FAILURE'] }),
      mergedPullRequestNode(14, { repo: 'acme/cli', checks: 'PENDING', conclusions: ['SUCCESS', null] }),
    ]
    gh.compares['acme/api v1.2.0...merge-12'] = 'behind'
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 3')
    await ui.press({ key: 'tab:merged' })
    expect(await drawnMergedItem(ui, 'PR_12')).toEqual({
      bullet: '▸',
      title: 'Add the thing',
      shipment: { ci: 'success', release: 'success', stg: 'inactive', prod: 'inactive' },
      ref: '#12 api · v1.2.0',
      indent: 2,
    })
    expect(await drawnMergedItem(ui, 'PR_13')).toMatchObject({
      shipment: { ci: 'error', release: 'inactive', stg: 'inactive', prod: 'inactive' },
      ref: '#13 web',
    })
    expect(await drawnMergedItem(ui, 'PR_14')).toMatchObject({
      shipment: { ci: 'warning', release: 'inactive', stg: 'inactive', prod: 'inactive' },
    })
    expect((await ui.find({ key: 'item:PR_12' }))?.props).toMatchObject({ flexDirection: 'row', flexShrink: 0 })
    await ui.unmount()
  })
}

test('with the merged window off, merged pull requests are not searched and the Merged tab is empty', { options: { mergedWindow: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.merged = [mergedPullRequestNode(1)]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))

  expect(gh.mergedRequests).toEqual([])
  expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 0')
  await ui.unmount()
})
