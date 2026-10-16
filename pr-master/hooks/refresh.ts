import { atom, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { RefreshProblem, Snapshot, SnapshotCache } from '../types'
import { toItem } from './domain/item'
import { isDue } from './domain/polling'
import { readiness } from './domain/readiness'
import { statusRow } from './domain/status-row'
import { GH_TOKEN_COMMANDS, NoToken, graphqlData, graphqlRequest } from './github/client'
import { MY_PULL_REQUESTS, OPEN_PULL_REQUESTS_SEARCH, openPullRequestsOf } from './github/open-pull-requests'
import type { OpenPullRequestsSearchData } from './github/open-pull-requests'
import type { Options } from './options'
import { PANE_ID } from './pane'
import { EMPTY_SNAPSHOT } from './snapshot'

const GH_TIMEOUT_MS = 10_000
/** The `$.store` key of the snapshot cache shared by the person's sessions. */
const CACHE_KEY = 'snapshot-cache'
/** How often the session looks at the shared cache; `isDue` decides whether it fetches. */
const POLL_TICK_MS = 15_000

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)

/**
 * The token, obtained once per module load. A module variable is fine here: it is never drawn,
 * and a reload (a settings change included) obtains it again.
 */
let token: string | undefined

/** This session's poller; a module reload drops it with the old module, a second `session.start` replaces it. */
let poller: Timer | undefined
/** The fetch this session has in flight, joined by any refresh asked for meanwhile. */
let fetching: Promise<void> | undefined
/** The `fetchedAt` of the cache this session last showed, so an unchanged cache is not shown again. */
let shownFetchedAt: number | undefined

/**
 * Keeps the snapshot the pane draws and the status row: a poller started with the session
 * shows the shared cache and fetches when it is due (60 s with the pane open, five minutes
 * closed, backed off after failures); opening the pane polls at once, and the pane's
 * `refresh` Button fetches now. Everything that reaches GitHub through `$` lives in this file,
 * since the engine follows `$` only into functions declared in the same file.
 */
export function registerRefresh(on: On, options: Options) {
  // Only a session a person sits at polls (a `-p` run shows no status row). The matcher is also
  // what lets this hook stand beside pane.tsx's own `session.start` hook.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    poller?.cancel()
    poller = $.clock.every(POLL_TICK_MS, () => poll($, options))
    void poll($, options)
    return started
  })

  on('ui.open', { id: 'pr-master' }, async ($, e, next) => {
    const opened = await next(e)
    void poll($, options)
    return opened
  })

  on('ui.press', { plugin: 'pr-master', element: 'refresh' }, async ($, e, next) => {
    void refresh($, options)
    return next(e)
  })
}

/**
 * Fetches when the shared cache is due for this session (see `isDue`), and otherwise shows
 * the cache, which another session may have written since.
 */
async function poll($: EngineInterface, options: Options): Promise<void> {
  const cache = await readCache($)
  const isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
  if (isDue(cache, await $.clock.now(), isPaneOpen)) return refresh($, options)
  if (cache && cache.fetchedAt !== shownFetchedAt) await show($, cache)
}

/** Fetches now, or joins the fetch this session already has in flight. */
function refresh($: EngineInterface, options: Options): Promise<void> {
  fetching ??= fetchIntoCache($, options).finally(() => {
    fetching = undefined
  })
  return fetching
}

/**
 * Fetches from GitHub, derives each pull request's Turn and label with the domain rules, and
 * writes the snapshot to the shared cache (last writer wins) and shows it. A failed fetch
 * keeps the cached lists, records the problem and counts the failure for the back-off.
 */
async function fetchIntoCache($: EngineInterface, options: Options): Promise<void> {
  let cache: SnapshotCache
  try {
    const data = await graphql<OpenPullRequestsSearchData>($, options, OPEN_PULL_REQUESTS_SEARCH, { q: MY_PULL_REQUESTS })
    const now = await $.clock.now()
    const mine = openPullRequestsOf(data).map(pr => toItem(pr, readiness(pr), now, options.staleThreshold))
    cache = { snapshot: { mine, updatedAt: now, problem: null }, fetchedAt: now, failures: 0 }
  } catch (error) {
    const last = await readCache($)
    cache = {
      snapshot: { ...(last?.snapshot ?? EMPTY_SNAPSHOT), problem: problemOf(error) },
      fetchedAt: await $.clock.now(),
      failures: (last?.failures ?? 0) + 1,
    }
  }
  await $.store.set(CACHE_KEY, cache)
  await show($, cache)
}

/** Draws `cache`'s snapshot in the pane and its counts in the status row. */
async function show($: EngineInterface, cache: SnapshotCache): Promise<void> {
  shownFetchedAt = cache.fetchedAt
  const shot: Snapshot = { ...EMPTY_SNAPSHOT, ...cache.snapshot }
  await update($, snapshot, () => shot)
  $.ui.status(statusRow(shot))
}

/** The shared cache, or undefined when no session has written one. */
async function readCache($: EngineInterface): Promise<SnapshotCache | undefined> {
  return ((await $.store.get(CACHE_KEY)) ?? undefined) as SnapshotCache | undefined
}

/** Runs a GraphQL query over the host's HTTP fetch; rejects with `NoToken` or `GitHubError`. */
async function graphql<Data>($: EngineInterface, options: Options, query: string, variables: Record<string, unknown>): Promise<Data> {
  token ??= (await ghToken($)) ?? (options.githubToken || undefined)
  if (!token) throw new NoToken()
  const request = graphqlRequest(token, query, variables)
  const response = await $.http.fetch(request.url, request.init)
  // A revoked token: obtain it again next time.
  if (response.status === 401) token = undefined
  return graphqlData<Data>(response)
}

/** The token `gh auth token` prints, or undefined when gh is logged out or cannot be started. */
async function ghToken($: EngineInterface): Promise<string | undefined> {
  for (const argv of GH_TOKEN_COMMANDS) {
    try {
      const run = await $.process.run(argv, { timeoutMs: GH_TIMEOUT_MS })
      // This gh ran: it has a token or it has none, and another path would say the same.
      return run.exitCode === 0 ? run.stdout.trim() || undefined : undefined
    } catch {
      // This gh could not be started: try the next path.
    }
  }
  return undefined
}

function problemOf(error: unknown): RefreshProblem {
  if (error instanceof NoToken) return { kind: 'no-token' }
  return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
}
