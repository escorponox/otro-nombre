import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

import type { Analysis } from '../types'
import { MY_PULL_REQUESTS_QUERY, PANE_ID, PLUGIN, SURFACES, github, headShaOf, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

type Ui = Mounted<(typeof SURFACES)[number], 'Pane'>

const NOW = Date.parse('2026-10-16T12:00:00Z')
const OLD_SHA = '0123456789abcdef0123456789abcdef01234567'

/** An Unblock analysis another session stored for My pull request #12 in acme/api at `headSha`. */
const storedAnalysis = (headSha: string): Analysis => ({
  kind: 'unblock',
  headSha,
  text: 'Why it is not ready:\n- The lint check fails on src/token.ts.',
  analysedAt: NOW - 60_000,
})

/**
 * The panel open on the My pull requests tab, mounted on `surface`: #12 in acme/api with failing
 * checks. `store` stands for what other sessions kept.
 */
async function openMineTab($: Engine, on: On, surface: (typeof SURFACES)[number], store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  const engine = world(on, { store })
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(12, { title: 'Cache the session token', checks: 'FAILURE' })]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount(surface))
  return { ui, engine, gh }
}

/** The text drawn under a pull request for its analysis; undefined when there is none. */
async function analysisOf(ui: Ui, id: string) {
  return (await ui.find({ key: `analysis:${id}` }))?.text
}

for (const surface of SURFACES) {
  test(`every My pull request has an Unblock analysis action, pressed with n while it holds the focus (${surface})`, async ($, on) => {
    const { ui } = await openMineTab($, on, surface)

    expect((await ui.find({ key: 'unblock-analysis:PR_12' }))?.text).toBe('Unblock analysis')
    expect((await ui.find({ key: 'unblock-analysis:PR_12' }))?.props.hotkey).toBeUndefined()
    await $.ui.focus({ component: 'Pane', requestId: PANE_ID, plugin: PLUGIN, element: 'pr:PR_12', origin: { kind: 'person' } })
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
    expect((await ui.find({ key: 'footer' }))?.text).toMatch(
      /^Couldn't start the Unblock analysis of #12 acme\/api \(background agents are off\) · Updated \d\d:\d\d$/,
    )
    await ui.unmount()
  })

  test(`a kept Unblock analysis shows under its pull request, out of date once the head moved (${surface})`, async ($, on) => {
    const { ui } = await openMineTab($, on, surface, { [`acme/api#12@${OLD_SHA}`]: storedAnalysis(OLD_SHA) })

    const drawn = await analysisOf(ui, 'PR_12')
    expect(drawn).toContain('Unblock analysis')
    expect(drawn).toContain('The lint check fails on src/token.ts.')
    expect(drawn).toContain('out of date')
    await ui.unmount()
  })

  test(`Continue in conversation sends the Unblock analysis into the conversation (${surface})`, async ($, on) => {
    const { ui, engine } = await openMineTab($, on, surface, { [`acme/api#12@${headShaOf(12)}`]: storedAnalysis(headShaOf(12)) })

    expect(await analysisOf(ui, 'PR_12')).not.toContain('out of date')
    await ui.press({ key: 'continue:PR_12' })
    expect(engine.prompts).toHaveLength(1)
    expect(engine.prompts[0]).toContain('Unblock analysis of https://github.com/acme/api/pull/12')
    expect(engine.prompts[0]).toContain('The lint check fails on src/token.ts.')
    await ui.unmount()
  })
}
