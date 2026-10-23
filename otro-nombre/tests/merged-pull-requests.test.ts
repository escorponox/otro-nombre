import { expect, mock, test } from 'claude-code/testing'

import {
  GRAPHQL_URL,
  MY_PULL_REQUESTS_QUERY,
  NOW,
  SURFACES,
  drawnMergedItem,
  footer,
  github,
  mergedPullRequestNode,
  openPanel,
  paneMount,
  pullRequestNode,
  runPrs,
  startSession,
  world,
} from './world'

const mergedSearch = (since: string) => `is:pr is:merged author:@me archived:false merged:>${since} sort:updated-desc`

test('opening the panel searches for pull requests merged within the last three days by default', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.mergedRequests).toHaveLength(1)
  expect(gh.mergedRequests[0]).toMatchObject({ url: GRAPHQL_URL, method: 'POST', variables: { q: mergedSearch('2026-10-13T12:00:00+00:00') } })
  expect(gh.mergedRequests[0]?.query).toContain('statusCheckRollup { state contexts')
})

for (const [window, since] of [['1d', '2026-10-15T12:00:00+00:00'], ['1w', '2026-10-09T12:00:00+00:00']] as const) {
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
      ref: '#12 api · merged 1d ago · v1.2.0',
      indent: 2,
    })
    expect(await drawnMergedItem(ui, 'PR_13')).toMatchObject({
      shipment: { ci: 'error', release: 'inactive', stg: 'inactive', prod: 'inactive' },
      ref: '#13 web · merged 1d ago',
    })
    expect(await drawnMergedItem(ui, 'PR_14')).toMatchObject({
      shipment: { ci: 'warning', release: 'inactive', stg: 'inactive', prod: 'inactive' },
    })
    expect((await ui.find({ key: 'item:PR_12' }))?.props).toMatchObject({ flexDirection: 'row', flexShrink: 0 })
    await ui.unmount()
  })
}

test('a Merged pull request shows how long ago it was merged, in whole days', async ($, on) => {
  const { ui } = await openPanel($, on, 'terminal', {
    tab: 'merged',
    merged: [
      mergedPullRequestNode(12, { mergedAt: '2026-10-13T11:00:00Z' }),
      mergedPullRequestNode(13, { mergedAt: '2026-10-16T09:00:00Z' }),
    ],
  })

  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ ref: '#12 api · merged 3d ago' })
  expect(await drawnMergedItem(ui, 'PR_13')).toMatchObject({ ref: '#13 api · merged today' })
  await ui.unmount()
})

test('the release is the earliest one whose tag contains the merge commit, checked by ancestry from the earliest candidate', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.merged = [
    mergedPullRequestNode(12, {
      mergedAt: '2026-10-15T10:00:00Z',
      releases: [
        { tag: 'v1.4.0', createdAt: '2026-10-16T09:00:00Z' },
        { tag: 'v1.3.1', createdAt: '2026-10-15T14:00:00Z', isDraft: true },
        { tag: 'v1.3.0', createdAt: '2026-10-15T11:00:00Z' },
        { tag: 'v1.2.0', createdAt: '2026-10-15T09:00:00Z' },
      ],
    }),
  ]
  // v1.3.0 was cut from an older commit after the merge; v1.4.0 carries it.
  gh.compares['acme/api v1.3.0...merge-12'] = 'ahead'
  gh.compares['acme/api v1.4.0...merge-12'] = 'behind'
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:merged' })

  // v1.2.0 predates the merge and v1.3.1 is a draft: neither costs a request.
  expect(gh.mergedRequests.slice(1).map(request => request.url)).toEqual([
    'https://api.github.com/repos/acme/api/compare/v1.3.0...merge-12?per_page=1',
    'https://api.github.com/repos/acme/api/compare/v1.4.0...merge-12?per_page=1',
  ])
  expect(gh.mergedRequests[1]).toMatchObject({ method: 'GET' })
  expect(gh.mergedRequests[1]?.headers.Authorization).toBe('bearer gho_fake')
  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { ci: 'success', release: 'success' }, ref: '#12 api · merged 1d ago · v1.4.0' })
  await ui.unmount()
})

test('a compare answer is kept across refreshes: the next refresh asks GitHub only for what it could not tell', async ($, on) => {
  const { ui, gh } = await openPanel($, on, 'terminal', {
    tab: 'merged',
    merged: [
      mergedPullRequestNode(12, { releases: [{ tag: 'v1.3.0', createdAt: '2026-10-15T11:00:00Z' }] }),
      mergedPullRequestNode(13, { repo: 'acme/web', releases: [{ tag: 'v2.0.0', createdAt: '2026-10-15T11:00:00Z' }] }),
    ],
  })
  // GitHub now knows v1.3.0 (it carries #12) but not yet v2.0.0.
  gh.compares['acme/api v1.3.0...merge-12'] = 'behind'
  gh.mergedRequests.length = 0
  await ui.press({ key: 'refresh' })
  const compares = () => gh.mergedRequests.filter(request => request.url.includes('/compare/')).map(request => request.url)
  expect(compares()).toEqual([
    'https://api.github.com/repos/acme/api/compare/v1.3.0...merge-12?per_page=1',
    'https://api.github.com/repos/acme/web/compare/v2.0.0...merge-13?per_page=1',
  ])

  gh.mergedRequests.length = 0
  await ui.press({ key: 'refresh' })
  expect(compares()).toEqual(['https://api.github.com/repos/acme/web/compare/v2.0.0...merge-13?per_page=1'])
  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { release: 'success' }, ref: '#12 api · merged 1d ago · v1.3.0' })
  await ui.unmount()
})

test('a merged pull request no release contains yet shows its release on its way', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.merged = [mergedPullRequestNode(12, { releases: [{ tag: 'v1.3.0', createdAt: '2026-10-15T11:00:00Z' }] })]
  gh.compares['acme/api v1.3.0...merge-12'] = 'diverged'
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:merged' })

  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { ci: 'success', release: 'warning' }, ref: '#12 api · merged 1d ago' })
  await ui.unmount()
})

test('releases are not looked up while CI fails or builds on the merge commit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  const releases = [{ tag: 'v1.3.0', createdAt: '2026-10-15T11:00:00Z' }]
  gh.merged = [
    mergedPullRequestNode(12, { checks: 'FAILURE', conclusions: ['FAILURE'], releases }),
    mergedPullRequestNode(13, { checks: 'PENDING', conclusions: [null], releases }),
    mergedPullRequestNode(14, { mergeCommit: null, releases }),
  ]
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.mergedRequests).toHaveLength(1)
})

for (const surface of SURFACES) {
  test(`a slow merged fetch never delays the Mine tab (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
    gh.merged = [mergedPullRequestNode(12)]
    gh.mergedWait = () => clock.sleep(5_000)
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
    expect(await ui.find({ key: 'item:PR_1' })).toBeDefined()
    expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 0')

    await clock.advance(5_000)
    expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 1')
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d$/)
    await ui.unmount()
  })

  test(`a failed merged fetch keeps the last Merged list and says it couldn't refresh (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.merged = [mergedPullRequestNode(12)]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 1')

    gh.mergedFailWith = 502
    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
    await ui.press({ key: 'refresh' })
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
    expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 1')
    expect(await footer(ui)).toMatch(/^Couldn't refresh \(HTTP 502\) · last updated \d\d:\d\d$/)
    await ui.unmount()
  })
}

test('merged pull requests of hidden organisations are not listed', { options: { hiddenOrgs: ['acme'] } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.merged = [mergedPullRequestNode(12, { repo: 'acme/api' }), mergedPullRequestNode(13, { repo: 'other/web' })]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))

  expect((await ui.find({ key: 'tab:merged' }))?.text).toBe('Merged 1')
  await ui.press({ key: 'tab:merged' })
  expect(await ui.find({ key: 'item:PR_12' })).toBeUndefined()
  expect(await ui.find({ key: 'item:PR_13' })).toBeDefined()
  await ui.unmount()
})

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
