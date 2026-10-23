import { expect, mock, test } from 'claude-code/testing'

import { NOW, SURFACES, drawnItem, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'
import type { GitHubRequest } from './world'

/** The searches of the spec, within the default two-week review window. */
const teamSearch = (team: string, since = '2026-10-02') =>
  `is:pr is:open archived:false draft:false team-review-requested:${team} -author:@me -reviewed-by:@me created:>${since} sort:updated-desc`
const dismissedSearch = (since = '2026-10-02') =>
  `is:pr is:open archived:false draft:false -author:@me reviewed-by:@me review:none created:>${since}`

/** The aliased Review request searches of the last request that held them: each search with its `first`. */
function reviewSearches(requests: GitHubRequest[]) {
  const request = requests.findLast(r => r.query.includes('team-review-requested') || r.query.includes('query ReviewRequests'))
  if (!request) return []
  return [...request.query.matchAll(/(\w+): search\(query: \$(\w+), type: ISSUE, first: (\d+)\)/g)].map(([, , variable, first]) => ({
    q: request.variables[variable ?? ''],
    first: Number(first),
  }))
}

test('the teams come from the viewer\'s organisations, as member and as admin, one search each plus the dismissed approvals', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'ADMIN' }, { slug: 'beta/web', role: 'MEMBER' }]
  await startSession($)
  await runPrs($)
  await clock.settle()

  const teamsRequest = gh.requests.find(r => r.query.includes('query ViewerTeams'))
  expect(teamsRequest?.query).toContain('role: MEMBER')
  expect(teamsRequest?.query).toContain('role: ADMIN')
  expect(reviewSearches(gh.requests)).toEqual([
    { q: teamSearch('acme/infra'), first: 50 },
    { q: teamSearch('acme/platform'), first: 50 },
    { q: teamSearch('beta/web'), first: 50 },
    { q: dismissedSearch(), first: 50 },
  ])
})

for (const [window, since] of [['1w', '2026-10-09'], ['2w', '2026-10-02'], ['1m', '2026-09-16']] as const) {
  test(`the review window ${window} searches pull requests created after ${since}`, { options: { reviewWindow: window } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }]
    await startSession($)
    await runPrs($)
    await clock.settle()

    expect(reviewSearches(gh.requests).map(search => search.q)).toEqual([teamSearch('acme/platform', since), dismissedSearch(since)])
  })
}

test('the review window off searches with no creation limit', { options: { reviewWindow: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }]
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(reviewSearches(gh.requests).map(search => search.q)).toEqual([
    'is:pr is:open archived:false draft:false team-review-requested:acme/platform -author:@me -reviewed-by:@me sort:updated-desc',
    'is:pr is:open archived:false draft:false -author:@me reviewed-by:@me review:none',
  ])
})

for (const surface of SURFACES) {
  test(`the Review tab lists Review requests with their author and Review state dot (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'MEMBER' }]
    gh.searches[teamSearch('acme/platform')] = [
      pullRequestNode(41, { repo: 'acme/api', author: 'ana', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }),
      pullRequestNode(42, { repo: 'acme/web', author: 'bob', checks: 'PENDING' }),
    ]
    // Asked of both teams: listed once.
    gh.searches[teamSearch('acme/infra')] = [pullRequestNode(41, { repo: 'acme/api', author: 'ana', reviewDecision: 'REVIEW_REQUIRED' })]
    gh.searches[dismissedSearch()] = [
      pullRequestNode(43, { repo: 'acme/api', author: 'cleo', reviewDecision: 'REVIEW_REQUIRED', myReview: 'DISMISSED' }),
      // Reviewed with a comment only: neither owed by a team nor a dismissed approval.
      pullRequestNode(44, { repo: 'acme/api', author: 'dan', reviewDecision: 'REVIEW_REQUIRED', myReview: 'COMMENTED' }),
    ]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'tab:review' }))?.text).toBe('Review 3')
    await ui.press({ key: 'tab:review' })
    expect(await drawnItem(ui, 'PR_41')).toMatchObject({ dot: 'error', ref: '#41 api', meta: 'Needs review · by ana · 3d' })
    expect(await drawnItem(ui, 'PR_42')).toMatchObject({ dot: 'warning', ref: '#42 web', meta: 'Checks running · by bob · 3d' })
    expect(await drawnItem(ui, 'PR_43')).toMatchObject({ dot: 'error', meta: 'Approval dismissed · by cleo · 3d' })
    expect(await ui.find({ key: 'item:PR_44' })).toBeUndefined()
    expect(await ui.findAll({ key: 'item:PR_41' })).toHaveLength(1)
    await ui.unmount()
  })

  test(`each team shows its switch with its count, and switching one off (a press left unconfirmed) drops its requests and keeps counting it (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const gh = github(on)
    gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'MEMBER' }]
    gh.searches[teamSearch('acme/platform')] = [pullRequestNode(41, { author: 'ana' }), pullRequestNode(42, { author: 'bob' })]
    gh.searches[teamSearch('acme/infra')] = [pullRequestNode(51, { author: 'eve' })]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    await ui.press({ key: 'tab:review' })

    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[x] acme/platform 2')
    expect((await ui.find({ key: 'team:acme/infra' }))?.text).toBe('[x] acme/infra 1')
    expect((await ui.find({ key: 'tab:review' }))?.text).toBe('Review 3')

    // On, a press asks "auto?"; left unanswered for 3 s, the team switches off.
    await ui.press({ key: 'team:acme/platform' })
    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[x] acme/platform 2 · auto?')
    await clock.advance(3000)
    await clock.settle()
    expect(w.store.get('teamsOff')).toEqual(['acme/platform'])
    expect(reviewSearches(gh.requests)).toContainEqual({ q: teamSearch('acme/platform'), first: 0 })
    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[ ] acme/platform 2')
    expect((await ui.find({ key: 'tab:review' }))?.text).toBe('Review 1')
    expect(await ui.find({ key: 'item:PR_41' })).toBeUndefined()
    expect(await ui.find({ key: 'item:PR_51' })).toBeDefined()

    await ui.press({ key: 'team:acme/platform' })
    await clock.settle()
    expect(w.store.get('teamsOff')).toEqual([])
    expect((await ui.find({ key: 'tab:review' }))?.text).toBe('Review 3')
    await ui.unmount()
  })
}

test('the switches are shared across sessions, and a team joined later arrives switched on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const gh = github(on)
  // Another session switched acme/platform off before acme/infra was joined.
  w.store.set('teamsOff', ['acme/platform'])
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'MEMBER' }]
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(reviewSearches(gh.requests)).toEqual([
    { q: teamSearch('acme/infra'), first: 50 },
    { q: teamSearch('acme/platform'), first: 0 },
    { q: dismissedSearch(), first: 50 },
  ])
})

test('a dismissed approval asked only of a team switched off is not listed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const gh = github(on)
  w.store.set('teamsOff', ['acme/platform'])
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'MEMBER' }]
  gh.searches[dismissedSearch()] = [
    pullRequestNode(61, { myReview: 'DISMISSED', requestedTeams: ['acme/platform'] }),
    pullRequestNode(62, { myReview: 'DISMISSED', requestedTeams: ['acme/platform', 'acme/infra'] }),
    // Asked of me in person, or of a team I am not in.
    pullRequestNode(63, { myReview: 'DISMISSED', requestedTeams: ['other/team'] }),
  ]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))

  expect((await ui.find({ key: 'tab:review' }))?.text).toBe('Review 2')
  await ui.press({ key: 'tab:review' })
  expect(await ui.find({ key: 'item:PR_61' })).toBeUndefined()
  expect(await ui.find({ key: 'item:PR_62' })).toBeDefined()
  expect(await ui.find({ key: 'item:PR_63' })).toBeDefined()
  await ui.unmount()
})

test('with private repositories hidden, the review searches ask GitHub for public ones so the counts match', { options: { showPrivate: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }]
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(reviewSearches(gh.requests).map(search => search.q)).toEqual([`${teamSearch('acme/platform')} is:public`, `${dismissedSearch()} is:public`])
})

test('the teams of a hidden organisation are neither searched nor shown', { options: { hiddenOrgs: ['beta'] } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'beta/web', role: 'MEMBER' }]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:review' })

  expect(reviewSearches(gh.requests).map(search => search.q)).toEqual([teamSearch('acme/platform'), dismissedSearch()])
  expect(await ui.find({ key: 'team:beta/web' })).toBeUndefined()
  await ui.unmount()
})
