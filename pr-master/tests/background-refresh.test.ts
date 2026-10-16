import { expect, mock, test } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, exceptReviewRequests, github, pullRequestNode, runPrs, startSession, world } from './world'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const SECOND = 1000

test('with the panel open, the session fetches every 60 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)

  await clock.advance(59 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)
  await clock.advance(1 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
  await clock.advance(60 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(3)
})

test('with the panel closed, the session fetches about every five minutes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await clock.settle()
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)

  await clock.advance(299 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)
  await clock.advance(1 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
})

test('closing the panel slows the fetches down to about every five minutes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()
  await runPrs($)
  await clock.settle()
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)

  await clock.advance(299 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)
  await clock.advance(1 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
})

test('failures back off 60 → 120 → 300 s, and a success recovers', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.failWith = 502
  await startSession($)
  await runPrs($)
  await clock.settle()
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)

  // One failure: the next try waits 120 s.
  await clock.advance(119 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(1)
  await clock.advance(1 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)

  // Two failures and more: 300 s.
  await clock.advance(299 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
  await clock.advance(1 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(3)
  await clock.advance(300 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(4)

  gh.failWith = undefined
  await clock.advance(300 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(5)
  await clock.advance(60 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(6)
})

test('after a module reload the open panel still fetches every 60 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
  await startSession($)
  await runPrs($)
  await clock.settle()
  // The reload refreshes the open panel at once, so changed settings apply.
  await startSession($)
  await clock.settle()
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)

  await clock.advance(59 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
  await clock.advance(1 * SECOND)
  expect(exceptReviewRequests(gh.requests)).toHaveLength(3)
})
