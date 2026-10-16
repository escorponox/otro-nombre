import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { SURFACES, analysisOf, focus, footer, headShaOf, openPanel, pullRequestNode, storedAnalysis } from './world'
import type { Surface } from './world'

const OLD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** A Review analysis another session stored for Review request #41 in acme/web at `headSha`. */
const storedReview = (headSha: string) => storedAnalysis('review', headSha, 'What it does:\n- Caches the session token.')

/**
 * The panel open on the Review tab, mounted on `surface`: Review request #41 in acme/web by ana,
 * and My pull request #12 in acme/api. `store` stands for what other sessions kept.
 */
const openReviewTab = ($: Engine, on: On, surface: Surface, store: Record<string, unknown> = {}) =>
  openPanel($, on, surface, {
    tab: 'review',
    store,
    mine: [pullRequestNode(12)],
    review: [pullRequestNode(41, { repo: 'acme/web', author: 'ana', title: 'Cache the session token', reviewDecision: 'REVIEW_REQUIRED' })],
  })

for (const surface of SURFACES) {
  test(`every Review request has a Review analysis action, pressed with n while it holds the focus (${surface})`, async ($, on) => {
    const { ui } = await openReviewTab($, on, surface)

    expect((await ui.find({ key: 'review-analysis:PR_41' }))?.text).toBe('Review analysis')
    expect((await ui.find({ key: 'review-analysis:PR_41' }))?.props.hotkey).toBeUndefined()
    await focus($, 'pr:PR_41')
    expect((await ui.find({ key: 'review-analysis:PR_41' }))?.props.hotkey).toBe('n')

    await ui.press({ key: 'tab:mine' })
    expect(await ui.find({ key: 'review-analysis:PR_12' })).toBeUndefined()
    await ui.unmount()
  })

  test(`Review analysis starts a background subagent on the pull request's head commit and shows analysing… (${surface})`, async ($, on) => {
    const { ui, engine } = await openReviewTab($, on, surface)
    expect(await analysisOf(ui, 'PR_41')).toBeUndefined()

    await ui.press({ key: 'review-analysis:PR_41' })
    expect(engine.spawns).toHaveLength(1)
    expect(engine.spawns[0]?.description).toBe('Review analysis of #41 acme/web')
    expect(engine.spawns[0]?.prompt).toContain('https://github.com/acme/web/pull/41')
    expect(engine.spawns[0]?.prompt).toContain(headShaOf(41))
    expect(await analysisOf(ui, 'PR_41')).toContain('analysing…')
    // It runs in the background: nothing reaches the conversation.
    expect(engine.prompts).toEqual([])
    await ui.unmount()
  })

  test(`a second press while the analysis runs starts nothing (${surface})`, async ($, on) => {
    const { ui, engine } = await openReviewTab($, on, surface)

    await ui.press({ key: 'review-analysis:PR_41' })
    await ui.press({ key: 'review-analysis:PR_41' })
    expect(engine.spawns).toHaveLength(1)
    expect(await analysisOf(ui, 'PR_41')).toContain('analysing…')
    await ui.unmount()
  })

  test(`a refused subagent shows why on the refresh line and nothing runs (${surface})`, async ($, on) => {
    const { ui, engine } = await openReviewTab($, on, surface)
    engine.agents.deny = 'background agents are off'

    await ui.press({ key: 'review-analysis:PR_41' })
    expect(await analysisOf(ui, 'PR_41')).toBeUndefined()
    expect(await footer(ui)).toMatch(
      /^Couldn't start the Review analysis of #41 acme\/web \(background agents are off\) · Updated \d\d:\d\d$/,
    )

    // Nothing is left running: a press once the agent is allowed starts it.
    engine.agents.deny = undefined
    await ui.press({ key: 'review-analysis:PR_41' })
    expect(engine.spawns).toHaveLength(2)
    expect(await analysisOf(ui, 'PR_41')).toContain('analysing…')
    await ui.unmount()
  })

  test(`a kept analysis of the head commit shows under its pull request as the panel opens (${surface})`, async ($, on) => {
    const { ui } = await openReviewTab($, on, surface, { [`acme/web#41@${headShaOf(41)}`]: storedReview(headShaOf(41)) })

    const drawn = await analysisOf(ui, 'PR_41')
    expect(drawn).toContain('Review analysis')
    expect(drawn).toContain('Caches the session token.')
    expect(drawn).not.toContain('out of date')
    expect((await ui.find({ key: 'continue:PR_41' }))?.text).toBe('Continue in conversation')
    await ui.unmount()
  })

  test(`an analysis of an older commit is marked out of date and runs again on the new head (${surface})`, async ($, on) => {
    const { ui, engine } = await openReviewTab($, on, surface, { [`acme/web#41@${OLD_SHA}`]: storedReview(OLD_SHA) })

    const drawn = await analysisOf(ui, 'PR_41')
    expect(drawn).toContain('Caches the session token.')
    expect(drawn).toContain('out of date')

    await ui.press({ key: 'review-analysis:PR_41' })
    expect(engine.spawns).toHaveLength(1)
    expect(engine.spawns[0]?.prompt).toContain(headShaOf(41))
    expect(await analysisOf(ui, 'PR_41')).toContain('analysing…')
    await ui.unmount()
  })

  test(`Continue in conversation sends the analysis into the conversation (${surface})`, async ($, on) => {
    const { ui, engine } = await openReviewTab($, on, surface, { [`acme/web#41@${headShaOf(41)}`]: storedReview(headShaOf(41)) })

    await ui.press({ key: 'continue:PR_41' })
    expect(engine.prompts).toHaveLength(1)
    expect(engine.prompts[0]).toContain('Review analysis of https://github.com/acme/web/pull/41')
    expect(engine.prompts[0]).toContain('What it does:\n- Caches the session token.')
    await ui.unmount()
  })
}
