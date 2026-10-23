import { expect, mock, test } from 'claude-code/testing'

import { SURFACES, paneMount, runPrs, startSession, world } from './world'
import type { Ui } from './world'

for (const surface of SURFACES) {
  test(`the pane shows the tabs Mine, Review and Merged with their counts, Mine first (${surface})`, async ($, on) => {
    mock.clock(on)
    world(on)
    await startSession($)
    await runPrs($)
    const ui = await $.ui.mount(paneMount(surface))

    const mine = await ui.find({ key: 'tab:mine' })
    const review = await ui.find({ key: 'tab:review' })
    const merged = await ui.find({ key: 'tab:merged' })
    expect([mine?.text, review?.text, merged?.text]).toEqual(['Mine 0', 'Review 0', 'Merged 0'])
    expect([mine?.props.hotkey, review?.props.hotkey, merged?.props.hotkey]).toEqual(['1', '2', '3'])
    expect(mine?.props.variant).toBe('primary')
    expect(review?.props.variant).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'No pull requests here.' })).toBeDefined()
    await ui.unmount()
  })

  test(`pressing a tab switches to it (${surface})`, async ($, on) => {
    mock.clock(on)
    world(on)
    await startSession($)
    await runPrs($)
    const ui = await $.ui.mount(paneMount(surface))

    await ui.press({ key: 'tab:review' })
    expect((await ui.find({ key: 'tab:review' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'tab:mine' }))?.props.variant).toBeUndefined()

    await ui.press({ key: 'tab:merged' })
    expect((await ui.find({ key: 'tab:merged' }))?.props.variant).toBe('primary')
    await ui.unmount()
  })

  test(`l shows and hides the legend of Turn and Shipment colours (${surface})`, async ($, on) => {
    mock.clock(on)
    world(on)
    await startSession($)
    await runPrs($)
    const ui = await $.ui.mount(paneMount(surface))

    expect((await ui.find({ key: 'legend' }))?.props.hotkey).toBe('l')
    expect(await ui.find({ key: 'legend:turn:mine' })).toBeUndefined()

    await ui.press({ key: 'legend' })
    expect(await legendEntry(ui, 'turn:mine')).toEqual({ colour: 'error', text: 'Mine' })
    expect(await legendEntry(ui, 'turn:theirs')).toEqual({ colour: 'warning', text: 'Theirs' })
    expect(await legendEntry(ui, 'turn:done')).toEqual({ colour: 'success', text: 'Done' })
    expect(await legendEntry(ui, 'turn:parked')).toEqual({ colour: 'inactive', text: 'Parked' })
    expect(await legendEntry(ui, 'shipment:arrived')).toEqual({ colour: 'success', text: 'arrived' })
    expect(await legendEntry(ui, 'shipment:running')).toEqual({ colour: 'warning', text: 'running' })
    expect(await legendEntry(ui, 'shipment:failed')).toEqual({ colour: 'error', text: 'failed' })
    expect(await legendEntry(ui, 'shipment:unknown')).toEqual({ colour: 'inactive', text: 'unknown' })

    await ui.press({ key: 'legend' })
    expect(await ui.find({ key: 'legend:turn:mine' })).toBeUndefined()
    await ui.unmount()
  })
}

/** A legend entry as drawn: its dot's colour and the word beside the dot. */
async function legendEntry(ui: Ui, entry: string) {
  const found = await ui.find({ key: `legend:${entry}` })
  const [dot, word] = (found?.children ?? []) as { props: { color?: string }; children: string[] }[]
  return { colour: dot?.props.color, text: word?.children.join('').trim() }
}
