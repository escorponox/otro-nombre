import { expect, mock, test } from 'claude-code/testing'

import type { SnapshotCache } from '../types'
import { CACHE_KEY, MY_PULL_REQUESTS_QUERY, NOW, github, mergedPullRequestNode, pullRequestNode, runPrs, startSession, world } from './world'

const MINUTE = 60_000

/** A cache the person's sessions wrote an hour ago, before every one of them closed: PR 2 waits on its checks. */
const CACHE_AN_HOUR_OLD: SnapshotCache = {
  snapshot: {
    mine: [{ id: 'PR_2', number: 2, repo: 'acme/api', title: 'PR 2', url: '', author: 'me', turn: 'theirs', label: 'Checks running', ageDays: 1, isStale: false, headSha: 'sha2', isBehind: false }],
    review: [],
    teams: [],
    merged: [],
    promotionProblem: null,
    updatedAt: NOW - 60 * MINUTE,
    problem: null,
  },
  fetchedAt: NOW - 60 * MINUTE,
  failures: 0,
}

test('a session raises no Alert for what its first snapshot shows, and a toast for each change after it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1, { checks: 'FAILURE' }), pullRequestNode(2, { checks: 'PENDING' })]
  await startSession($)
  await runPrs($)
  await clock.settle()
  expect(w.toasts).toEqual([])

  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1, { checks: 'FAILURE' }), pullRequestNode(2, { checks: 'FAILURE' })]
  await clock.advance(MINUTE)
  expect(w.toasts).toEqual([{ text: '#2 api · Checks failing', timeoutMs: 10_000 }])
})

test('a session alerts what changed since the cache its sessions wrote before they all closed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, { store: { [CACHE_KEY]: CACHE_AN_HOUR_OLD } })
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(2, { checks: 'FAILURE' })]
  // The open pull requests are the first list in: nothing from this fetch was shown before them.
  gh.mergedWait = () => clock.sleep(5_000)
  await startSession($)
  await clock.advance(5_000)
  expect(w.toasts).toEqual([{ text: '#2 api · Checks failing', timeoutMs: 10_000 }])
})

test('with Alerts off, a session raises no toast', { options: { alerts: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, { store: { [CACHE_KEY]: CACHE_AN_HOUR_OLD } })
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(2, { checks: 'FAILURE' })]
  await startSession($)
  await clock.settle()
  expect(w.toasts).toEqual([])
})

test('a session raises no Alert after a first fetch that failed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const gh = github(on)
  gh.failWith = 502
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1, { checks: 'FAILURE' })]
  await startSession($)
  await runPrs($)
  await clock.settle()

  gh.failWith = undefined
  await clock.advance(2 * MINUTE)
  expect(w.toasts).toEqual([])
})

test('a first fetch writes no cache until both lists are in, so no session takes half a snapshot for its first', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const gh = github(on)
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
  gh.mergedWait = () => clock.sleep(5_000)
  await startSession($)
  await clock.advance(1_000)
  expect(w.store.get(CACHE_KEY)).toBeUndefined()

  await clock.advance(4_000)
  expect(w.store.get(CACHE_KEY)).toBeDefined()
})

test('the Alerts of one fetch are told together, however its lists arrive', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const gh = github(on)
  const running = { checks: 'PENDING', conclusions: [null] }
  const failed = { checks: 'FAILURE', conclusions: ['FAILURE'] }
  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1, { checks: 'PENDING' }), pullRequestNode(2, { checks: 'PENDING' })]
  gh.merged = [mergedPullRequestNode(8, running), mergedPullRequestNode(9, running)]
  await startSession($)
  await runPrs($)
  await clock.settle()

  gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1, { checks: 'FAILURE' }), pullRequestNode(2, { checks: 'FAILURE' })]
  gh.merged = [mergedPullRequestNode(8, failed), mergedPullRequestNode(9, failed)]
  gh.mergedWait = () => clock.sleep(5_000)
  await clock.advance(MINUTE + 5_000)
  expect(w.toasts).toEqual([{ text: '4 Alerts · /prs', timeoutMs: 10_000 }])
})
