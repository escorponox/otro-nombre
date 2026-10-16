import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { SURFACES, analysisOf, focus, footer, headShaOf, openPanel, pullRequestNode, storedAnalysis } from './world'
import type { Surface } from './world'

const OLD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** An Unblock analysis another session stored for My pull request #12 in acme/api at `headSha`. */
const storedUnblock = (headSha: string) => storedAnalysis('unblock', headSha, 'Why it is not ready:\n- The lint check fails on src/token.ts.')

/**
 * The panel open on the My pull requests tab, mounted on `surface`: #12 in acme/api with failing
 * checks. `store` stands for what other sessions kept.
 */
const openMineTab = ($: Engine, on: On, surface: Surface, store: Record<string, unknown> = {}) =>
  openPanel($, on, surface, { store, mine: [pullRequestNode(12, { title: 'Cache the session token', checks: 'FAILURE' })] })

for (const surface of SURFACES) {
  test(`every My pull request has an Unblock analysis action, pressed with n while it holds the focus (${surface})`, async ($, on) => {
    const { ui } = await openMineTab($, on, surface)

    expect((await ui.find({ key: 'unblock-analysis:PR_12' }))?.text).toBe('Unblock analysis')
    expect((await ui.find({ key: 'unblock-analysis:PR_12' }))?.props.hotkey).toBeUndefined()
    await focus($, 'pr:PR_12')
    expect((await ui.find({ key: 'unblock-analysis:PR_12' }))?.props.hotkey).toBe('n')
    await ui.unmount()
  })

  test(`Unblock analysis starts a background subagent naming the Readiness and shows analysing… (${surface})`, async ($, on) => {
    const { ui, engine } = await openMineTab($, on, surface)
    expect(await analysisOf(ui, 'PR_12')).toBeUndefined()

    await ui.press({ key: 'unblock-analysis:PR_12' })
    expect(engine.spawns).toHaveLength(1)
    expect(engine.spawns[0]?.description).toBe('Unblock analysis of #12 acme/api')
    expect(engine.spawns[0]?.prompt).toContain('https://github.com/acme/api/pull/12')
    expect(engine.spawns[0]?.prompt).toContain(headShaOf(12))
    expect(engine.spawns[0]?.prompt).toContain('Readiness: Checks failing')
    expect(await analysisOf(ui, 'PR_12')).toContain('analysing…')
    expect(engine.prompts).toEqual([])
    await ui.unmount()
  })

  test(`a second Unblock analysis press while it runs starts nothing (${surface})`, async ($, on) => {
    const { ui, engine } = await openMineTab($, on, surface)

    await ui.press({ key: 'unblock-analysis:PR_12' })
    await ui.press({ key: 'unblock-analysis:PR_12' })
    expect(engine.spawns).toHaveLength(1)
    await ui.unmount()
  })

  test(`a refused Unblock analysis shows why on the refresh line and nothing runs (${surface})`, async ($, on) => {
    const { ui, engine } = await openMineTab($, on, surface)
    engine.agents.deny = 'background agents are off'

    await ui.press({ key: 'unblock-analysis:PR_12' })
    expect(await analysisOf(ui, 'PR_12')).toBeUndefined()
    expect(await footer(ui)).toMatch(
      /^Couldn't start the Unblock analysis of #12 acme\/api \(background agents are off\) · Updated \d\d:\d\d$/,
    )
    await ui.unmount()
  })

  test(`a kept Unblock analysis shows under its pull request, out of date once the head moved (${surface})`, async ($, on) => {
    const { ui } = await openMineTab($, on, surface, { [`acme/api#12@${OLD_SHA}`]: storedUnblock(OLD_SHA) })

    const drawn = await analysisOf(ui, 'PR_12')
    expect(drawn).toContain('Unblock analysis')
    expect(drawn).toContain('The lint check fails on src/token.ts.')
    expect(drawn).toContain('out of date')
    await ui.unmount()
  })

  test(`Continue in conversation sends the Unblock analysis into the conversation (${surface})`, async ($, on) => {
    const { ui, engine } = await openMineTab($, on, surface, { [`acme/api#12@${headShaOf(12)}`]: storedUnblock(headShaOf(12)) })

    expect(await analysisOf(ui, 'PR_12')).not.toContain('out of date')
    await ui.press({ key: 'continue:PR_12' })
    expect(engine.prompts).toHaveLength(1)
    expect(engine.prompts[0]).toContain('Unblock analysis of https://github.com/acme/api/pull/12')
    expect(engine.prompts[0]).toContain('The lint check fails on src/token.ts.')
    await ui.unmount()
  })
}
