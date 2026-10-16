import { expect, mock, test } from 'claude-code/testing'

import type { PullRequestItem, SnapshotCache } from '../types'
import { CACHE_KEY, SURFACES, github, paneMount, runPrs, startSession, world } from './world'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const SECOND = 1000

/** A My pull request as another session cached it. */
function cachedItem(n: number): PullRequestItem {
  return { id: `PR_${n}`, number: n, repo: 'acme/api', title: `Cached ${n}`, url: `https://github.com/acme/api/pull/${n}`, author: 'me', turn: 'done', label: 'Ready to merge', ageDays: 1, isStale: false }
}

/** A cache another session wrote at `fetchedAt`. */
function cacheOf(fetchedAt: number, ...numbers: number[]): SnapshotCache {
  return { snapshot: { mine: numbers.map(cachedItem), updatedAt: fetchedAt, problem: null }, fetchedAt, failures: 0 }
}

for (const surface of SURFACES) {
  test(`a fresh cache another session wrote is shown without fetching (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on, { store: { [CACHE_KEY]: cacheOf(NOW - 10 * SECOND, 5) } })
    const gh = github(on)
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect(gh.requests).toEqual([])
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
    expect(await ui.find({ key: 'item:PR_5' })).toBeDefined()
    await ui.unmount()
  })
}
