import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { APPROVAL_COMMENTS } from '../hooks/domain/approval-comment'
import { NOW, PLATFORM_SEARCH, SURFACES, actionRow, mutations, openPanel, pullRequestNode } from './world'
import type { Surface } from './world'

/** A Review request by ana, its checks passed and no one's review yet, unless `facts` say otherwise. */
const request = (number: number, facts: Parameters<typeof pullRequestNode>[1] = {}) =>
  pullRequestNode(number, { author: 'ana', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', ...facts })

/** The search for acme/infra's Review requests, within the default two-week review window. */
const INFRA_SEARCH =
  'is:pr is:open archived:false draft:false team-review-requested:acme/infra -author:@me -reviewed-by:@me created:>2026-10-02 sort:updated-desc'
const DISMISSED_SEARCH = 'is:pr is:open archived:false draft:false -author:@me reviewed-by:@me review:none created:>2026-10-02'

/**
 * The panel open on the Review tab, its one team acme/platform turned to Auto-approval by another
 * session, with `review` asked of it; `handled` are the `id@sha` another session dealt with.
 */
const openWithAutoTeam = ($: Engine, on: On, review: object[], { handled = [] as string[], surface = 'terminal' as Surface } = {}) =>
  openPanel($, on, surface, {
    tab: 'review',
    review,
    store: { autoApprovalTeams: ['acme/platform'], autoApprovals: Object.fromEntries(handled.map(key => [key, NOW - 60_000])) },
  })

/** The approvals the mod sent to GitHub, as `id@headSha`. */
const approvals = (requests: Parameters<typeof mutations>[0]) =>
  mutations(requests)
    .filter(mutation => mutation.query.includes('addPullRequestReview'))
    .map(mutation => `${String(mutation.variables.id)}@${String(mutation.variables.headSha)}`)

for (const surface of SURFACES) {
  test(`on, a press asks "auto?" and a second within 3 s turns the team to Auto-approval, leaving alone what is listed then (${surface})`, async ($, on) => {
    const { ui, gh, engine, clock } = await openPanel($, on, surface, { tab: 'review', review: [request(41)] })

    await ui.press({ key: 'team:acme/platform' })
    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[x] acme/platform 1 · auto?')
    await clock.advance(2999)
    await ui.press({ key: 'team:acme/platform' })
    await clock.settle()

    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[A] acme/platform 1')
    expect(engine.store.get('autoApprovalTeams')).toEqual(['acme/platform'])
    expect(engine.store.get('teamsOff')).toEqual([])
    // Listed when the team was turned to Auto-approval: the person's to review.
    expect(approvals(gh.requests)).toEqual([])
    await clock.advance(3000)
    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[A] acme/platform 1')

    // A press on Auto-approval switches the team off at once.
    await ui.press({ key: 'team:acme/platform' })
    await clock.settle()
    expect((await ui.find({ key: 'team:acme/platform' }))?.text).toBe('[ ] acme/platform 1')
    expect(engine.store.get('autoApprovalTeams')).toEqual([])
    expect(engine.store.get('teamsOff')).toEqual(['acme/platform'])
    await ui.unmount()
  })
}

test('a Review request arriving for a team with Auto-approval is approved at its commit, with an Alert', async ($, on) => {
  const { gh, engine, clock, ui } = await openWithAutoTeam($, on, [request(41)], { handled: ['PR_41@sha41'] })
  expect(approvals(gh.requests)).toEqual([])

  gh.searches[PLATFORM_SEARCH] = [request(41), request(42, { headRefOid: 'c0ffee42' })]
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(approvals(gh.requests)).toEqual(['PR_42@c0ffee42'])
  const [approval] = mutations(gh.requests)
  expect(APPROVAL_COMMENTS).toContain(approval?.variables.body)
  expect(engine.toasts).toContainEqual({ text: '#42 api · Auto-approved', timeoutMs: 10_000 })
  expect(engine.store.get('autoApprovals')).toHaveProperty(['PR_42@c0ffee42'])
  await ui.unmount()
})

test('no Auto-approval while checks run, without checks, or with changes requested', async ($, on) => {
  const { gh, ui } = await openWithAutoTeam($, on, [
    request(41, { checks: 'PENDING' }),
    request(42, { checks: null }),
    request(43, { checks: 'FAILURE' }),
    request(44, { reviewDecision: 'CHANGES_REQUESTED' }),
  ])

  expect(approvals(gh.requests)).toEqual([])
  await ui.unmount()
})

test('a new commit on a Review request left alone gets an Auto-approval, and so does a dismissed approval asked of the team', async ($, on) => {
  const { gh, clock, ui } = await openWithAutoTeam($, on, [request(41)], { handled: ['PR_41@sha41'] })

  gh.searches[PLATFORM_SEARCH] = [request(41, { headRefOid: 'new41' })]
  gh.searches[DISMISSED_SEARCH] = [request(43, { myReview: 'DISMISSED', requestedTeams: ['acme/platform'], headRefOid: 'new43' })]
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(approvals(gh.requests)).toEqual(['PR_41@new41', 'PR_43@new43'])
  await ui.unmount()
})

test('a Review request asked of a team on and of one with Auto-approval gets an Auto-approval', async ($, on) => {
  const { gh, clock, ui } = await openWithAutoTeam($, on, [], {})
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'MEMBER' }]
  gh.searches[INFRA_SEARCH] = [request(51)]
  gh.searches[PLATFORM_SEARCH] = [request(51)]
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(approvals(gh.requests)).toEqual(['PR_51@sha51'])
  await ui.unmount()
})

test('a Review request asked only of a team without Auto-approval is left to the person', async ($, on) => {
  const { gh, clock, ui } = await openWithAutoTeam($, on, [], {})
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }, { slug: 'acme/infra', role: 'MEMBER' }]
  gh.searches[INFRA_SEARCH] = [request(51)]
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(approvals(gh.requests)).toEqual([])
  await ui.unmount()
})

test('a commit another session dealt with is not approved again', async ($, on) => {
  const { gh, ui } = await openWithAutoTeam($, on, [request(41)], { handled: ['PR_41@sha41'] })

  expect(approvals(gh.requests)).toEqual([])
  await ui.unmount()
})

test('an Auto-approval GitHub refuses shows on the item and is not tried again at that commit', async ($, on) => {
  const { gh, clock, ui } = await openWithAutoTeam($, on, [])
  gh.mutationError = 'Head sha did not match'
  gh.searches[PLATFORM_SEARCH] = [request(41)]
  await ui.press({ key: 'refresh' })
  await clock.settle()

  expect(approvals(gh.requests)).toEqual(['PR_41@sha41'])
  expect(await actionRow(ui, 'PR_41')).toContain("Couldn't approve (Head sha did not match)")

  await ui.press({ key: 'refresh' })
  await clock.settle()
  expect(approvals(gh.requests)).toEqual(['PR_41@sha41'])
  await ui.unmount()
})

test('with the Alerts setting off, an Auto-approval raises no toast', { options: { alerts: false } }, async ($, on) => {
  const { gh, engine, ui } = await openWithAutoTeam($, on, [request(41)])

  expect(approvals(gh.requests)).toEqual(['PR_41@sha41'])
  expect(engine.toasts).toEqual([])
  await ui.unmount()
})
