import { expect, mock, test } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, NOW, SURFACES, drawnItem, exceptReviewRequests, github, paneMount, pullRequestNode, reviewThread, runPrs, startSession, world } from './world'

const BLOCKED = { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' } as const

for (const surface of SURFACES) {
  test(`a blocked My pull request with unresolved threads is mine: Quill comments or Unresolved comments (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [
      pullRequestNode(40, BLOCKED),
      pullRequestNode(41, BLOCKED),
      pullRequestNode(42, BLOCKED),
    ]
    gh.threads = {
      PR_40: [reviewThread('alice', true), reviewThread('quill-reviewer'), reviewThread('bob')],
      PR_41: [reviewThread('quill-reviewer', true), reviewThread('alice')],
      PR_42: [reviewThread('quill-reviewer', true), reviewThread('alice', true)],
    }
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect(await drawnItem(ui, 'PR_40')).toMatchObject({ dot: 'error', meta: 'Quill comments · 3d' })
    expect(await drawnItem(ui, 'PR_41')).toMatchObject({ dot: 'error', meta: 'Unresolved comments · 3d' })
    expect(await drawnItem(ui, 'PR_42')).toMatchObject({ dot: 'warning', meta: 'Waiting for review · 3d' })
    await ui.unmount()
  })
}

test('review threads are read by node id, only for the blocked My pull requests', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [
    pullRequestNode(40, BLOCKED),
    pullRequestNode(43, { mergeStateStatus: 'CLEAN' }),
    pullRequestNode(44, BLOCKED),
  ]
  gh.threads = { PR_43: [reviewThread('quill-reviewer')] }
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))

  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
  expect(gh.requests[1]?.variables).toEqual({ ids: ['PR_40', 'PR_44'] })
  expect(gh.requests[1]?.query).toContain('reviewThreads')
  expect(await drawnItem(ui, 'PR_43')).toMatchObject({ dot: 'success', meta: 'Ready to merge · 3d' })
  await ui.unmount()
})

test('with no blocked My pull request, no review threads are read', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(43), pullRequestNode(45, { isDraft: true })]
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)
})
