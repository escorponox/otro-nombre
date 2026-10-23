import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { APPROVAL_COMMENTS } from '../hooks/domain/approval-comment'
import { PLATFORM_SEARCH, SURFACES, actionRow, button, drawnItem, focus, mutations, openPanel, pullRequestNode } from './world'
import type { Surface } from './world'

/**
 * The panel open on the Review tab: #41 by ana, asked of acme/platform and seen at commit `c0ffee41`,
 * and #42 by bob; and one My pull request, #12, Ready to merge.
 */
const openReviewTab = ($: Engine, on: On, surface: Surface) =>
  openPanel($, on, surface, {
    tab: 'review',
    mine: [pullRequestNode(12)],
    review: [
      pullRequestNode(41, { author: 'ana', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', headRefOid: 'c0ffee41' }),
      pullRequestNode(42, { author: 'bob', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }),
    ],
  })

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
    expect(approve?.variables).toMatchObject({ id: 'PR_41', headSha: 'c0ffee41' })
    expect(APPROVAL_COMMENTS).toContain(approve?.variables.body)
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
