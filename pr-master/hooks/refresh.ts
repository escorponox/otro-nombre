import { atom, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import type { PullRequestItem, RefreshProblem, Snapshot, SnapshotCache, TeamSwitch } from '../types'
import { toItem } from './domain/item'
import { isDue } from './domain/polling'
import type { OpenPullRequest } from './domain/pull-request'
import { readiness } from './domain/readiness'
import { reviewState } from './domain/review-state'
import { reviewWindowStart } from './domain/review-window'
import { statusRow } from './domain/status-row'
import { visibleOnly } from './domain/visibility'
import { GH_TOKEN_COMMANDS, NoToken, graphqlData, graphqlRequest } from './github/client'
import { MY_PULL_REQUESTS, OPEN_PULL_REQUESTS_SEARCH, openPullRequestsOf } from './github/open-pull-requests'
import type { OpenPullRequestsSearchData } from './github/open-pull-requests'
import { VIEWER_TEAMS, reviewRequestsOf, reviewRequestsQuery, teamsOf } from './github/review-requests'
import type { ReviewRequestsData, ViewerTeamsData } from './github/review-requests'
import { REVIEW_THREADS, needsThreads, withUnresolvedThreads } from './github/threads'
import type { ReviewThreadsData } from './github/threads'
import type { Options } from './options'
import { PANE_ID } from './pane'
import { EMPTY_SNAPSHOT } from './snapshot'

const GH_TIMEOUT_MS = 10_000
/** The `$.store` key of the snapshot cache shared by the person's sessions. */
const CACHE_KEY = 'snapshot-cache'
/** How often the session looks at the shared cache; `isDue` decides whether it fetches. */
const POLL_TICK_MS = 15_000

/** The `$.store` key of the teams the person switched off (`org/team` list). */
const TEAMS_OFF = 'teamsOff'

/** The key prefix of a team switch Button in the pane. */
const TEAM_SWITCH = 'team:'

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)

/**
 * The token, obtained once per module load. A module variable is fine here: it is never drawn,
 * and a reload (a settings change included) obtains it again.
 */
let token: string | undefined

/** This session's poller; a module reload drops it with the old module, a second `session.start` replaces it. */
let poller: Timer | undefined
/** The last poll this session queued; the next one waits for it. */
let polling: Promise<void> = Promise.resolve()
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
  // Only a session a person sits at polls (a `-p` run has no panel and shows no status row).
  // The matcher is also what lets this hook stand beside pane.tsx's own `session.start` hook.
  // A settings change reloads the module, and a reload starts the session again: an open panel
  // is refreshed at once so the new settings (the visibility filters among them) apply.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    poller?.cancel()
    poller = $.clock.every(POLL_TICK_MS, () => poll($, options))
    void ((await isPaneOpen($)) ? refresh($, options) : poll($, options))
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

  // The Review tab's team switches, keyed `team:<org/team>`.
  on('ui.press', { plugin: 'pr-master' }, async ($, e, next) => {
    if (e.element.startsWith(TEAM_SWITCH)) await switchTeam($, options, e.element.slice(TEAM_SWITCH.length))
    return next(e)
  })
}

/**
 * Polls one at a time, so that a poll reads the cache the poll before it wrote: two polls at
 * once (the session's first and the pane opening) would otherwise both find it due.
 */
function poll($: EngineInterface, options: Options): Promise<void> {
  polling = polling.catch(() => undefined).then(() => pollOnce($, options))
  return polling
}

/**
 * Fetches when the shared cache is due for this session (see `isDue`), and otherwise shows
 * the cache, which another session may have written since.
 */
async function pollOnce($: EngineInterface, options: Options): Promise<void> {
  const cache = await readCache($)
  if (isDue(cache, await $.clock.now(), await isPaneOpen($))) return refresh($, options)
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
    const prs = await withThreads($, options, visibleOnly(openPullRequestsOf(data), options))
    const { review, teams } = await reviewRequests($, options)
    const now = await $.clock.now()
    const mine = prs.map(pr => toItem(pr, readiness(pr), now, options.staleThreshold))
    cache = { snapshot: { mine, review, teams, updatedAt: now, problem: null }, fetchedAt: now, failures: 0 }
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

/** Whether this session's panel is open, as the engine's pane list says. */
async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID)
}

/** The shared cache, or undefined when no session has written one. */
async function readCache($: EngineInterface): Promise<SnapshotCache | undefined> {
  return ((await $.store.get(CACHE_KEY)) ?? undefined) as SnapshotCache | undefined
}

/**
 * The Review requests of the person's teams switched on, plus their dismissed approvals, with
 * every team's switch and count. Two queries: the teams, then every team's search at once.
 */
async function reviewRequests($: EngineInterface, options: Options): Promise<{ review: PullRequestItem[]; teams: TeamSwitch[] }> {
  const off = await teamsOff($)
  const teamsData = await graphql<ViewerTeamsData>($, options, VIEWER_TEAMS, {})
  const teams = teamsOf(teamsData, options).map(slug => ({ slug, isOn: !off.includes(slug) }))
  const now = await $.clock.now()
  const search = reviewRequestsQuery(teams, reviewWindowStart(now, options.reviewWindow), options)
  const data = await graphql<ReviewRequestsData>($, options, search.query, search.variables)
  const { requests, counts } = reviewRequestsOf(data, teams)
  return {
    review: visibleOnly(requests, options).map(pr => toItem(pr, reviewState(pr), now, options.staleThreshold)),
    teams: teams.map((team, index) => ({ ...team, count: counts[index] ?? 0 })),
  }
}

/** The teams the person switched off, from the store shared by every session; any other team is on. */
async function teamsOff($: EngineInterface): Promise<string[]> {
  const stored = await $.store.get(TEAMS_OFF)
  return Array.isArray(stored) ? stored.filter(slug => typeof slug === 'string') : []
}

/** Switches a team on or off for every session, shows the switch at once, and refreshes the lists. */
async function switchTeam($: EngineInterface, options: Options, slug: string): Promise<void> {
  const off = await teamsOff($)
  await $.store.set(TEAMS_OFF, off.includes(slug) ? off.filter(other => other !== slug) : [...off, slug])
  await update($, snapshot, shot => ({
    ...shot,
    teams: shot.teams.map(team => (team.slug === slug ? { ...team, isOn: !team.isOn } : team)),
  }))
  void refresh($, options)
}

/** `prs` with their unresolved review threads, read by a second query for the ones that need them. */
async function withThreads($: EngineInterface, options: Options, prs: OpenPullRequest[]): Promise<OpenPullRequest[]> {
  const ids = prs.filter(needsThreads).map(pr => pr.id)
  if (ids.length === 0) return prs
  const data = await graphql<ReviewThreadsData>($, options, REVIEW_THREADS, { ids })
  return withUnresolvedThreads(prs, data)
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
