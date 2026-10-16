import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, PANE_ID, PLUGIN, SURFACES, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'
import type { GitHubRequest } from './world'

type Ui = Mounted<(typeof SURFACES)[number], 'Pane'>

const NOW = Date.parse('2026-10-16T12:00:00Z')

/**
 * The panel open on three My pull requests in acme/api: #12 Ready to merge at commit `sha12`,
 * #13 behind its base branch, #14 with failing checks.
 */
async function openPanel($: Engine, on: On, surface: (typeof SURFACES)[number]) {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [
    pullRequestNode(12),
    pullRequestNode(13, { mergeStateStatus: 'BEHIND' }),
    pullRequestNode(14, { checks: 'FAILURE', mergeStateStatus: 'BLOCKED' }),
  ]
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount(surface))
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

/** The action row of `id` as drawn while GitHub receives each mutation. */
function watchRow(gh: ReturnType<typeof github>, ui: Ui, id: string): string[] {
  const seen: string[] = []
  gh.whileMutating = async () => {
    seen.push(await actionRow(ui, id))
  }
  return seen
}

for (const surface of SURFACES) {
  test(`Squash merge shows on a Ready to merge pull request, Update branch on one behind, Close on every one (${surface})`, async ($, on) => {
    const { ui } = await openPanel($, on, surface)

    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Squash merge' })
    expect(await button(ui, 'update:PR_12')).toBeUndefined()
    expect(await button(ui, 'merge:PR_13')).toBeUndefined()
    expect(await button(ui, 'update:PR_13')).toMatchObject({ label: 'Update branch' })
    expect(await button(ui, 'merge:PR_14')).toBeUndefined()
    expect(await button(ui, 'update:PR_14')).toBeUndefined()
    for (const id of ['PR_12', 'PR_13', 'PR_14']) expect(await button(ui, `close:${id}`)).toMatchObject({ label: 'Close' })
    await ui.unmount()
  })

  test(`one press of Squash merge asks for confirmation and sends nothing (${surface})`, async ($, on) => {
    const { ui, gh } = await openPanel($, on, surface)

    await ui.press({ key: 'merge:PR_12' })
    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Confirm merge?', variant: 'primary' })
    expect(mutations(gh.requests)).toEqual([])
    await ui.unmount()
  })

  test(`two presses within 3 s squash-merge the pull request pinned to the commit shown, then refresh (${surface})`, async ($, on) => {
    const { ui, gh, clock } = await openPanel($, on, surface)

    const whileMerging = watchRow(gh, ui, 'PR_12')

    await ui.press({ key: 'merge:PR_12' })
    await clock.advance(2999)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(13, { mergeStateStatus: 'BEHIND' })]
    const before = gh.requests.length
    await ui.press({ key: 'merge:PR_12' })
    await clock.settle()

    const [merge, ...others] = gh.requests.slice(before)
    expect(merge?.query).toContain('mergePullRequest')
    expect(merge?.query).toContain('SQUASH')
    expect(merge?.variables).toEqual({ id: 'PR_12', headSha: 'sha12' })
    expect(whileMerging).toEqual([expect.stringContaining('Merging…')])
    // Then the lists refresh: the merged pull request is gone.
    expect(others.map(request => request.variables.q)).toContain(MY_PULL_REQUESTS_QUERY)
    expect(await ui.find({ key: 'item:PR_12' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a press, 3 s, then a press sends nothing and asks again (${surface})`, async ($, on) => {
    const { ui, gh, clock } = await openPanel($, on, surface)

    await ui.press({ key: 'merge:PR_12' })
    await clock.advance(3000)
    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Squash merge' })
    expect((await button(ui, 'merge:PR_12'))?.variant).toBeUndefined()

    await ui.press({ key: 'merge:PR_12' })
    expect(mutations(gh.requests)).toEqual([])
    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Confirm merge?' })
    await ui.unmount()
  })

  test(`a focus move disarms the armed action (${surface})`, async ($, on) => {
    const { ui, gh } = await openPanel($, on, surface)

    await focus($, 'merge:PR_12')
    await ui.press({ key: 'merge:PR_12' })
    await focus($, 'close:PR_12')
    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Squash merge' })

    await ui.press({ key: 'merge:PR_12' })
    expect(mutations(gh.requests)).toEqual([])
    await ui.unmount()
  })

  test(`pressing another action arms that one instead (${surface})`, async ($, on) => {
    const { ui, gh } = await openPanel($, on, surface)

    await ui.press({ key: 'merge:PR_12' })
    await ui.press({ key: 'close:PR_12' })
    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Squash merge' })
    expect(await button(ui, 'close:PR_12')).toMatchObject({ label: 'Confirm close?', variant: 'primary' })
    expect(mutations(gh.requests)).toEqual([])
    await ui.unmount()
  })

  test(`Update branch, confirmed, updates the branch with a merge commit (${surface})`, async ($, on) => {
    const { ui, gh, clock } = await openPanel($, on, surface)

    const whileUpdating = watchRow(gh, ui, 'PR_13')

    await ui.press({ key: 'update:PR_13' })
    expect(await button(ui, 'update:PR_13')).toMatchObject({ label: 'Confirm update?', variant: 'primary' })
    await ui.press({ key: 'update:PR_13' })
    await clock.settle()

    const [update] = mutations(gh.requests)
    expect(update?.query).toContain('updatePullRequestBranch')
    expect(update?.query).toContain('MERGE')
    expect(update?.variables).toEqual({ id: 'PR_13' })
    expect(whileUpdating).toEqual([expect.stringContaining('Updating branch…')])
    expect(await actionRow(ui, 'PR_13')).toContain('Branch updated')
    await ui.unmount()
  })

  test(`Close, confirmed, closes the pull request (${surface})`, async ($, on) => {
    const { ui, gh, clock } = await openPanel($, on, surface)

    const whileClosing = watchRow(gh, ui, 'PR_14')

    await ui.press({ key: 'close:PR_14' })
    expect(await button(ui, 'close:PR_14')).toMatchObject({ label: 'Confirm close?', variant: 'primary' })
    await ui.press({ key: 'close:PR_14' })
    await clock.settle()

    const [close] = mutations(gh.requests)
    expect(close?.query).toContain('closePullRequest')
    expect(close?.variables).toEqual({ id: 'PR_14' })
    expect(whileClosing).toEqual([expect.stringContaining('Closing…')])
    expect(await actionRow(ui, 'PR_14')).toContain('Closed')
    await ui.unmount()
  })

  test(`a write action GitHub refuses shows its error on the item (${surface})`, async ($, on) => {
    const { ui, gh } = await openPanel($, on, surface)
    gh.mutationError = 'Head branch was modified. Review and try the merge again.'

    await ui.press({ key: 'merge:PR_12' })
    await ui.press({ key: 'merge:PR_12' })
    expect(await actionRow(ui, 'PR_12')).toContain("Couldn't merge (Head branch was modified. Review and try the merge again.)")
    expect(await button(ui, 'merge:PR_12')).toMatchObject({ label: 'Squash merge' })
    await ui.unmount()
  })

  test(`the focused pull request's write actions carry their hotkeys: m merge, u update branch, x close (${surface})`, async ($, on) => {
    const { ui } = await openPanel($, on, surface)
    expect((await button(ui, 'merge:PR_12'))?.hotkey).toBeUndefined()

    await focus($, 'pr:PR_12')
    expect((await button(ui, 'merge:PR_12'))?.hotkey).toBe('m')
    expect((await button(ui, 'close:PR_12'))?.hotkey).toBe('x')
    expect((await button(ui, 'close:PR_13'))?.hotkey).toBeUndefined()

    await focus($, 'pr:PR_13')
    expect((await button(ui, 'update:PR_13'))?.hotkey).toBe('u')
    expect((await button(ui, 'close:PR_13'))?.hotkey).toBe('x')
    await ui.unmount()
  })
}
