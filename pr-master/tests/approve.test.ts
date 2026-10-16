import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, PANE_ID, PLUGIN, SURFACES, drawnItem, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'
import type { GitHubRequest } from './world'

type Ui = Mounted<(typeof SURFACES)[number], 'Pane'>

const NOW = Date.parse('2026-10-16T12:00:00Z')

/** The search for Review requests asked of acme/platform, within the default two-week review window. */
const PLATFORM_SEARCH =
  'is:pr is:open archived:false draft:false team-review-requested:acme/platform -author:@me -reviewed-by:@me created:>2026-10-02 sort:updated-desc'

/**
 * The panel open on the Review tab: #41 by ana, asked of acme/platform and seen at commit `c0ffee41`,
 * and #42 by bob; and one My pull request, #12, Ready to merge.
 */
async function openReviewTab($: Engine, on: On, surface: (typeof SURFACES)[number]) {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.teams = [{ slug: 'acme/platform', role: 'MEMBER' }]
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(12)]
  gh.searches[PLATFORM_SEARCH] = [
    pullRequestNode(41, { author: 'ana', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', headRefOid: 'c0ffee41' }),
    pullRequestNode(42, { author: 'bob', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }),
  ]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount(surface))
  await ui.press({ key: 'tab:review' })
  return { ui, gh, clock }
}

/** The person's Tab onto the element keyed `element`. */
async function focus($: Engine, element: string) {
  await $.ui.focus({ component: 'Pane', requestId: PANE_ID, plugin: PLUGIN, element, origin: { kind: 'person' } })
}

const mutations = (requests: GitHubRequest[]) => requests.filter(request => request.query.startsWith('mutation'))

async function button(ui: Ui, key: string) {
  const found = await ui.find({ key })
  return found && { label: found.text, variant: found.props.variant, hotkey: found.props.hotkey }
}

async function actionRow(ui: Ui, id: string) {
  return (await ui.find({ key: `actions:${id}` }))?.text ?? ''
}

for (const surface of SURFACES) {
  test(`Approve shows on every Review request and on no My pull request (${surface})`, async ($, on) => {
    const { ui } = await openReviewTab($, on, surface)

    expect(await button(ui, 'approve:PR_41')).toMatchObject({ label: 'Approve' })
    expect(await button(ui, 'approve:PR_42')).toMatchObject({ label: 'Approve' })

    await ui.press({ key: 'tab:mine' })
    expect(await ui.find({ key: 'item:PR_12' })).toBeDefined()
    expect(await button(ui, 'approve:PR_12')).toBeUndefined()
    await ui.unmount()
  })

  test(`one press of Approve asks for confirmation and sends nothing (${surface})`, async ($, on) => {
    const { ui, gh } = await openReviewTab($, on, surface)

    await ui.press({ key: 'approve:PR_41' })
    expect(await button(ui, 'approve:PR_41')).toMatchObject({ label: 'Confirm approve?', variant: 'primary' })
    expect(mutations(gh.requests)).toEqual([])
    await ui.unmount()
  })

  test(`two presses within 3 s approve the pull request pinned to the commit shown, and it turns Done on the refresh (${surface})`, async ($, on) => {
    const { ui, gh, clock } = await openReviewTab($, on, surface)
    const whileApproving: string[] = []
    gh.whileMutating = async () => {
      whileApproving.push(await actionRow(ui, 'PR_41'))
    }

    await ui.press({ key: 'approve:PR_41' })
    await clock.advance(2999)
    // What GitHub answers right after the approval: its search index still lists #41 for the team,
    // and the person's latest review of it is the approval.
    gh.searches[PLATFORM_SEARCH] = [
      pullRequestNode(41, { author: 'ana', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', headRefOid: 'c0ffee41', myReview: 'APPROVED' }),
      pullRequestNode(42, { author: 'bob', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }),
    ]
    await ui.press({ key: 'approve:PR_41' })
    await clock.settle()

    const [approve, ...others] = mutations(gh.requests)
    expect(others).toEqual([])
    expect(approve?.query).toContain('addPullRequestReview')
    expect(approve?.query).toContain('APPROVE')
    expect(approve?.variables).toEqual({ id: 'PR_41', headSha: 'c0ffee41' })
    expect(whileApproving).toEqual([expect.stringContaining('Approving…')])
    expect(await drawnItem(ui, 'PR_41')).toMatchObject({ dot: 'success', meta: 'Approved already · by ana · 3d' })
    await ui.unmount()
  })

  test(`a press of Approve, 3 s, then a press sends nothing and asks again (${surface})`, async ($, on) => {
    const { ui, gh, clock } = await openReviewTab($, on, surface)

    await ui.press({ key: 'approve:PR_41' })
    await clock.advance(3000)
    expect(await button(ui, 'approve:PR_41')).toMatchObject({ label: 'Approve' })

    await ui.press({ key: 'approve:PR_41' })
    expect(mutations(gh.requests)).toEqual([])
    expect(await button(ui, 'approve:PR_41')).toMatchObject({ label: 'Confirm approve?' })
    await ui.unmount()
  })

  test(`an approval GitHub refuses shows its error on the item (${surface})`, async ($, on) => {
    const { ui, gh } = await openReviewTab($, on, surface)
    gh.mutationError = 'Can not approve your own pull request'

    await ui.press({ key: 'approve:PR_41' })
    await ui.press({ key: 'approve:PR_41' })
    expect(await actionRow(ui, 'PR_41')).toContain("Couldn't approve (Can not approve your own pull request)")
    await ui.unmount()
  })

  test(`the focused Review request's Approve carries the hotkey p (${surface})`, async ($, on) => {
    const { ui } = await openReviewTab($, on, surface)
    expect((await button(ui, 'approve:PR_41'))?.hotkey).toBeUndefined()

    await focus($, 'pr:PR_41')
    expect((await button(ui, 'approve:PR_41'))?.hotkey).toBe('p')
    expect((await button(ui, 'approve:PR_42'))?.hotkey).toBeUndefined()
    await ui.unmount()
  })
}
