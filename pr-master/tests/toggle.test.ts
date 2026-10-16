import { expect, mock, test } from 'claude-code/testing'

import { PANE_ID, runPrs, startSession, world } from './world'

test('the session registers /prs', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await startSession($)
  expect(w.commands).toEqual(['prs'])
  await clock.settle()
})

test('/prs opens the pane with the focus', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await startSession($)
  await runPrs($)
  expect([...w.open]).toEqual([PANE_ID])
  expect(w.opens).toEqual([{ id: PANE_ID, focus: true }])
  await clock.settle()
})

test('/prs again closes the open pane, and a third /prs opens it again', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await startSession($)
  await runPrs($)
  await runPrs($)
  expect([...w.open]).toEqual([])
  await runPrs($)
  expect([...w.open]).toEqual([PANE_ID])
  await clock.settle()
})

test('after a module reload, /prs closes the pane the engine still holds', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await startSession($)
  await runPrs($)
  await startSession($)
  await runPrs($)
  expect([...w.open]).toEqual([])
  await clock.settle()
})

// The kit raises no `ui.close` from a test: closing with the pane's close mark is the engine
// dropping the pane from its record.
test('after the person closes the pane with its close mark, /prs opens it again', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await startSession($)
  await runPrs($)
  w.open.delete(PANE_ID)
  await runPrs($)
  expect([...w.open]).toEqual([PANE_ID])
  expect(w.opens).toHaveLength(2)
  await clock.settle()
})
