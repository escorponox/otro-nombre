import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { SURFACES, focus, footer, mergedPullRequestNode, openPanel } from './world'
import type { Surface, Ui } from './world'

/** The panel open on the Merged tab: #12 in acme/api and #13 in acme/web, merged. */
const openMergedTab = ($: Engine, on: On, surface: Surface) =>
  openPanel($, on, surface, { tab: 'merged', merged: [mergedPullRequestNode(12), mergedPullRequestNode(13, { repo: 'acme/web' })] })

/** Whether the title of the Merged pull request `id` is drawn inverse. */
async function isInverse(ui: Ui, id: string) {
  const title = (await ui.find({ key: `pr:${id}` }))?.children[0] as { props: { inverse?: boolean } } | undefined
  return title?.props.inverse === true
}

for (const surface of SURFACES) {
  test(`pressing a Merged pull request's title opens it in the browser (${surface})`, async ($, on) => {
    const { ui, gh } = await openMergedTab($, on, surface)

    await ui.press({ key: 'pr:PR_13' })
    expect(gh.argvs.filter(argv => argv[0] === 'open')).toEqual([['open', 'https://github.com/acme/web/pull/13']])
    await ui.unmount()
  })

  test(`every Merged pull request has Copy link on its action row, copying its URL (${surface})`, async ($, on) => {
    const { ui, engine } = await openMergedTab($, on, surface)

    for (const id of ['PR_12', 'PR_13']) {
      expect((await ui.find({ key: `actions:${id}` }))?.props).toMatchObject({ flexDirection: 'row' })
      expect((await ui.find({ key: `copy:${id}` }))?.text).toBe('Copy link')
    }
    await ui.press({ key: 'copy:PR_12' })
    expect(engine.copies).toEqual([{ text: 'https://github.com/acme/api/pull/12', surface }])
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d$/)
    await ui.unmount()
  })

  test(`the Merged pull request holding the focus is drawn inverse and has the c hotkey (${surface})`, async ($, on) => {
    const { ui } = await openMergedTab($, on, surface)
    expect(await isInverse(ui, 'PR_12')).toBe(false)
    expect((await ui.find({ key: 'copy:PR_12' }))?.props.hotkey).toBeUndefined()

    await focus($, 'pr:PR_12')
    expect(await isInverse(ui, 'PR_12')).toBe(true)
    expect(await isInverse(ui, 'PR_13')).toBe(false)
    expect((await ui.find({ key: 'copy:PR_12' }))?.props.hotkey).toBe('c')
    expect((await ui.find({ key: 'copy:PR_13' }))?.props.hotkey).toBeUndefined()
    // A plain Button draws its hotkey as a visible prefix: the title never carries one.
    expect((await ui.find({ key: 'pr:PR_12' }))?.props.hotkey).toBeUndefined()

    await focus($, 'copy:PR_13')
    expect(await isInverse(ui, 'PR_12')).toBe(false)
    expect(await isInverse(ui, 'PR_13')).toBe(true)
    await ui.unmount()
  })
}
