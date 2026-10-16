import { atom, read, update } from 'claude-code'
import type { EngineInterface, HttpResponse, On, Timer } from 'claude-code'

import type {
  ActionProgress,
  MergedPullRequestItem,
  PullRequestItem,
  RefreshProblem,
  Snapshot,
  SnapshotCache,
  TeamSwitch,
} from '../types'
import { ARM_MS, pressOf } from './domain/confirmation'
import { toItem } from './domain/item'
import { isDue } from './domain/polling'
import type { OpenPullRequest } from './domain/pull-request'
import { readiness } from './domain/readiness'
import { reviewState } from './domain/review-state'
import { reviewWindowStart } from './domain/review-window'
import { awaitsRelease, isContained, releaseCandidates, toMergedItem } from './domain/shipment'
import type { MergedPullRequest, Release } from './domain/shipment'
import { statusRow } from './domain/status-row'
import { visibleOnly } from './domain/visibility'
import { GH_TOKEN_COMMANDS, NoToken, graphqlData, graphqlRequest, restRequest } from './github/client'
import { MERGED_PULL_REQUESTS_SEARCH, comparePath, comparisonStatusOf, mergedPullRequestsOf, mergedPullRequestsSearch } from './github/merged'
import type { MergedPullRequestsSearchData } from './github/merged'
import { MY_PULL_REQUESTS, OPEN_PULL_REQUESTS_SEARCH, openPullRequestsOf } from './github/open-pull-requests'
import type { OpenPullRequestsSearchData } from './github/open-pull-requests'
import { VIEWER_TEAMS, reviewRequestsOf, reviewRequestsQuery, teamsOf } from './github/review-requests'
import type { ReviewRequestsData, ViewerTeamsData } from './github/review-requests'
import { REVIEW_THREADS, needsThreads, withUnresolvedThreads } from './github/threads'
import type { ReviewThreadsData } from './github/threads'
import { writeRequestOf } from './github/write-actions'
import type { WriteRequest } from './github/write-actions'
import type { Options } from './options'
import { PANE_ID } from './pane'
import { EMPTY_SNAPSHOT, findItem } from './snapshot'

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
/** Drawn by `pane.tsx`. */
const armed = atom({ plugin: 'pr-master', key: 'armed' } as const, null as { element: string; at: number } | null)
const progress = atom({ plugin: 'pr-master', key: 'progress' } as const, {} as Record<string, ActionProgress>)

/**
 * The token, obtained once per module load. A module variable is fine here: it is never drawn,
 * and a reload (a settings change included) obtains it again.
 */
let token: Promise<string | undefined> | undefined

/** This session's poller; a module reload drops it with the old module, a second `session.start` replaces it. */
let poller: Timer | undefined
/** The last poll this session queued; the next one waits for it. */
let polling: Promise<void> = Promise.resolve()
/** The fetch this session has in flight, joined by any refresh asked for meanwhile. */
let fetching: Promise<void> | undefined
/** The `fetchedAt` of the cache this session last showed, so an unchanged cache is not shown again. */
let shownFetchedAt: number | undefined

/** Disarms the armed write action once its three seconds are up; a reload drops it with the module. */
let disarmTimer: Timer | undefined

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

  // The Review tab's team switches, keyed `team:<org/team>`, and the write actions on a pull
  // request, keyed `<kind>:<item id>` (see `pressWriteAction`).
  on('ui.press', { plugin: 'pr-master' }, async ($, e, next) => {
    if (e.element.startsWith(TEAM_SWITCH)) {
      await switchTeam($, options, e.element.slice(TEAM_SWITCH.length))
    } else {
      const [kind, id] = splitKey(e.element)
      const item = findItem(await read($, snapshot), id)
      const request = item && writeRequestOf(kind, item)
      if (item && request) await pressWriteAction($, options, e.element, kind, item, request)
    }
    return next(e)
  })

  // A focus move disarms the armed write action. pane.tsx hooks `ui.focus` on `{ requestId }`;
  // this matcher keeps the two hooks apart.
  on('ui.focus', { component: 'Pane', requestId: 'pr-master' }, async ($, e, next) => {
    const held = await read($, armed)
    if (held && held.element !== e.element) await disarm($)
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
 * Fetches from GitHub, derives each pull request's Turn, label and Shipment with the domain
 * rules, and writes the snapshot to the shared cache (last writer wins) and shows it.
 *
 * The open pull requests and the merged ones are fetched side by side, and each list is written
 * as soon as it arrives: the slower merged fetch never holds back the Mine and Review tabs. A
 * failed fetch keeps its cached list; once both are done, the snapshot records the problem, if
 * any, and the cache counts the failure for the back-off.
 */
async function fetchIntoCache($: EngineInterface, options: Options): Promise<void> {
  const last = await readCache($)
  let shot: Snapshot = { ...EMPTY_SNAPSHOT, ...last?.snapshot }
  const failuresBefore = last?.failures ?? 0
  /** Applies `change` to this fetch's snapshot, writes it to the shared cache and shows it. */
  const amend = async (change: (current: Snapshot) => Snapshot, failures = failuresBefore) => {
    shot = change(shot)
    const cache: SnapshotCache = { snapshot: shot, fetchedAt: await $.clock.now(), failures }
    await $.store.set(CACHE_KEY, cache)
    await show($, cache)
  }
  const results = await Promise.allSettled([
    fetchOpen($, options).then(lists => amend(current => ({ ...current, ...lists }))),
    fetchMerged($, options).then(merged => amend(current => ({ ...current, merged }))),
  ])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  await amend(current => ({ ...current, problem: failure ? problemOf(failure.reason) : null }), failure ? failuresBefore + 1 : 0)
}

/** The open pull requests' lists: My pull requests and Review requests with their Turn and label, and the teams. */
async function fetchOpen($: EngineInterface, options: Options): Promise<Pick<Snapshot, 'mine' | 'review' | 'teams' | 'updatedAt'>> {
  const data = await graphql<OpenPullRequestsSearchData>($, options, OPEN_PULL_REQUESTS_SEARCH, { q: MY_PULL_REQUESTS })
  const prs = await withThreads($, options, visibleOnly(openPullRequestsOf(data), options))
  const { review, teams } = await reviewRequests($, options)
  const now = await $.clock.now()
  const mine = prs.map(pr => toItem(pr, readiness(pr), now, options.staleThreshold))
  return { mine, review, teams, updatedAt: now }
}

/** The pull requests merged within the merged window, each with its Shipment; none when the window is off. */
async function fetchMerged($: EngineInterface, options: Options): Promise<MergedPullRequestItem[]> {
  const q = mergedPullRequestsSearch(options.mergedWindow, await $.clock.now())
  if (q === null) return []
  const data = await graphql<MergedPullRequestsSearchData>($, options, MERGED_PULL_REQUESTS_SEARCH, { q })
  const prs = visibleOnly(mergedPullRequestsOf(data), options)
  // Promotions to staging and production (ticket 09) are read here too, beside the release.
  return Promise.all(prs.map(async pr => toMergedItem(pr, await containingRelease($, options, pr))))
}

/**
 * The earliest release whose tag contains the merge commit, checked by commit ancestry one
 * candidate at a time, earliest first; null when none does or the ship status does not hang on one.
 */
async function containingRelease($: EngineInterface, options: Options, pr: MergedPullRequest): Promise<Release | null> {
  if (!awaitsRelease(pr)) return null
  for (const release of releaseCandidates(pr)) {
    const response = await rest($, options, comparePath(pr.repository, release.tag, pr.mergeCommit.oid))
    const status = comparisonStatusOf(response)
    if (status && isContained(status)) return release
  }
  return null
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

/**
 * A press on a write action (squash merge, update branch, close): a Button keyed `<kind>:<item id>`
 * whose kind has a mutation in `github/write-actions.ts`. Write actions live here, beside the token
 * and the refresh they need. The first press arms the Button (`items.tsx` draws it as
 * "Confirm …?"); a second press within `ARM_MS` runs the action; the clock, a focus move or
 * another write action's press disarms it.
 */
async function pressWriteAction(
  $: EngineInterface,
  options: Options,
  element: string,
  kind: string,
  item: PullRequestItem,
  request: WriteRequest,
): Promise<void> {
  const now = await $.clock.now()
  if (pressOf(await read($, armed), element, now) === 'arm') {
    disarmTimer?.cancel()
    await update($, armed, () => ({ element, at: now }))
    disarmTimer = $.clock.after(ARM_MS, () => void disarm($))
    return
  }
  await disarm($)
  // One write action at a time on a pull request.
  if ((await read($, progress))[item.id]?.phase === 'running') return
  void runWriteAction($, options, kind, item, request)
}

/** Runs a confirmed write action, shows its progress on the item, then refreshes the lists. */
async function runWriteAction($: EngineInterface, options: Options, kind: string, item: PullRequestItem, request: WriteRequest) {
  const show = (shown: ActionProgress) => update($, progress, all => ({ ...all, [item.id]: shown }))
  await show({ kind, phase: 'running' })
  try {
    await graphql($, options, request.query, request.variables)
    await show({ kind, phase: 'done' })
  } catch (error) {
    await show({ kind, phase: 'failed', problem: error instanceof Error ? error.message : String(error) })
  }
  await refresh($, options)
}

async function disarm($: EngineInterface): Promise<void> {
  disarmTimer?.cancel()
  disarmTimer = undefined
  await update($, armed, () => null)
}

/** `merge:PR_12` -> `['merge', 'PR_12']`; a key without a colon has no item id. */
function splitKey(element: string): [string, string] {
  const colon = element.indexOf(':')
  return colon < 0 ? [element, ''] : [element.slice(0, colon), element.slice(colon + 1)]
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
  const request = graphqlRequest(await authorisation($, options), query, variables)
  const response = await $.http.fetch(request.url, request.init)
  // A revoked token: obtain it again next time.
  if (response.status === 401) token = undefined
  return graphqlData<Data>(response)
}

/** Runs a REST GET over the host's HTTP fetch and answers GitHub's response; rejects with `NoToken`. */
async function rest($: EngineInterface, options: Options, path: string): Promise<HttpResponse> {
  const request = restRequest(await authorisation($, options), path)
  const response = await $.http.fetch(request.url, request.init)
  if (response.status === 401) token = undefined
  return response
}

/**
 * The token, from `gh auth token` or else the GitHub token setting; rejects with `NoToken`.
 * Requests sent side by side share one `gh auth token` run; without a token, the next refresh asks again.
 */
async function authorisation($: EngineInterface, options: Options): Promise<string> {
  token ??= ghToken($).then(fromGh => fromGh ?? (options.githubToken || undefined))
  const obtained = await token
  if (obtained) return obtained
  token = undefined
  throw new NoToken()
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
