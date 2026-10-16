import { expect, mock, test } from 'claude-code/testing'

import { GRAPHQL_URL, MY_PULL_REQUESTS_QUERY, NOW, SURFACES, drawnItem, exceptReviewRequests, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

test('opening the panel searches GitHub for My pull requests with the gh token', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.argvs[0]).toEqual(['gh', 'auth', 'token'])
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)
  expect(gh.requests[0]).toMatchObject({ url: GRAPHQL_URL, method: 'POST', variables: { q: MY_PULL_REQUESTS_QUERY } })
  expect(gh.requests[0]?.headers.Authorization).toBe('bearer gho_fake')
})

for (const surface of SURFACES) {
  test(`the Mine tab lists My pull requests with their Turn dot, Readiness, age and stale mark (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [
      pullRequestNode(12, { repo: 'acme/api', title: 'Add the thing', createdAt: '2026-10-13T00:00:00Z' }),
      pullRequestNode(7, { repo: 'acme/web', isDraft: true, createdAt: '2026-08-01T00:00:00Z' }),
      pullRequestNode(30, { repo: 'acme/api', checks: 'FAILURE', createdAt: '2026-10-16T08:00:00Z' }),
      pullRequestNode(31, { repo: 'acme/cli', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }),
    ]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 4')
    expect(await drawnItem(ui, 'PR_12')).toEqual({ dot: 'success', ref: '#12 api', meta: 'Ready to merge · 3d', isStale: false, title: 'Add the thing' })
    expect(await drawnItem(ui, 'PR_7')).toEqual({ dot: 'inactive', ref: '#7 web', meta: 'Draft · 76d', isStale: true, title: 'Pull request 7' })
    expect(await drawnItem(ui, 'PR_30')).toMatchObject({ dot: 'error', meta: 'Checks failing · 0d', isStale: false })
    expect(await drawnItem(ui, 'PR_31')).toMatchObject({ dot: 'warning', ref: '#31 cli', meta: 'Waiting for review · 3d' })
    expect(await ui.find({ type: 'Text', text: 'No pull requests here.' })).toBeUndefined()
    await ui.unmount()
  })

  test(`each item is a list item: a two-column Turn bullet and a column that never shrinks, a blank line apart (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    github(on).searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(12), pullRequestNode(13)]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    const item = await ui.find({ key: 'item:PR_12' })
    expect(item?.props).toMatchObject({ flexDirection: 'row', flexShrink: 0 })
    const [bullet, column] = (item?.children ?? []) as { type: string; props: Record<string, unknown> }[]
    expect(bullet?.props).toMatchObject({ width: 2, flexShrink: 0 })
    expect(column?.props).toMatchObject({ flexDirection: 'column', flexShrink: 1 })
    // The ref Button carries no hotkey: a plain Button would draw it as a visible prefix.
    expect((await ui.find({ key: 'pr:PR_12' }))?.props).toMatchObject({ plain: true })
    expect((await ui.find({ key: 'pr:PR_12' }))?.props.hotkey).toBeUndefined()
    expect((await ui.find({ key: 'list' }))?.props).toMatchObject({ flexDirection: 'column', gap: 1 })
    await ui.unmount()
  })
}

for (const [threshold, staleOnes] of [['off', []], ['2w', ['PR_7', 'PR_8']], ['3m', ['PR_7']]] as const) {
  test(`the stale threshold ${threshold} marks ${staleOnes.join(', ') || 'none'}`, { options: { staleThreshold: threshold } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    github(on).searches[MY_PULL_REQUESTS_QUERY] = [
      pullRequestNode(7, { createdAt: '2026-06-01T00:00:00Z' }),
      pullRequestNode(8, { createdAt: '2026-09-15T00:00:00Z' }),
      pullRequestNode(9, { createdAt: '2026-10-10T00:00:00Z' }),
    ]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount('terminal'))

    const stale = []
    for (const id of ['PR_7', 'PR_8', 'PR_9']) if ((await drawnItem(ui, id)).isStale) stale.push(id)
    expect(stale).toEqual([...staleOnes])
    await ui.unmount()
  })
}
