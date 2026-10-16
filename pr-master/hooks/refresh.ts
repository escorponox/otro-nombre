import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { PullRequestItem, RefreshProblem, TeamSwitch } from '../types'
import { toItem } from './domain/item'
import type { OpenPullRequest } from './domain/pull-request'
import { readiness } from './domain/readiness'
import { reviewState } from './domain/review-state'
import { reviewWindowStart } from './domain/review-window'
import { visibleOnly } from './domain/visibility'
import { GH_TOKEN_COMMANDS, NoToken, graphqlData, graphqlRequest } from './github/client'
import { MY_PULL_REQUESTS, OPEN_PULL_REQUESTS_SEARCH, openPullRequestsOf } from './github/open-pull-requests'
import type { OpenPullRequestsSearchData } from './github/open-pull-requests'
import { VIEWER_TEAMS, reviewRequestsOf, reviewRequestsQuery, teamsOf } from './github/review-requests'
import type { ReviewRequestsData, ViewerTeamsData } from './github/review-requests'
import { REVIEW_THREADS, needsThreads, withUnresolvedThreads } from './github/threads'
import type { ReviewThreadsData } from './github/threads'
import type { Options } from './options'
import { EMPTY_SNAPSHOT } from './snapshot'

const GH_TIMEOUT_MS = 10_000

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

/**
 * Keeps the snapshot the pane draws: refreshes it when the pane opens and when the person
 * presses the pane's `refresh` Button. Everything that reaches GitHub through `$` lives in
 * this file, since the engine follows `$` only into functions declared in the same file.
 */
export function registerRefresh(on: On, options: Options) {
  on('ui.open', { id: 'pr-master' }, async ($, e, next) => {
    const opened = await next(e)
    void refresh($, options)
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

  // A settings change reloads the module, and a reload starts the session again: refresh the
  // open panel so the new settings (the visibility filters among them) apply at once. Only an
  // interactive session has a panel; the matcher also keeps this hook apart from pane.tsx's.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === 'pr-master')) void refresh($, options)
    return started
  })
}

/**
 * Fetches from GitHub now, derives each pull request's Turn and label with the domain rules,
 * and replaces the snapshot. A failed refresh keeps the last lists and records the problem.
 */
async function refresh($: EngineInterface, options: Options): Promise<void> {
  try {
    const data = await graphql<OpenPullRequestsSearchData>($, options, OPEN_PULL_REQUESTS_SEARCH, { q: MY_PULL_REQUESTS })
    const prs = await withThreads($, options, visibleOnly(openPullRequestsOf(data), options))
    const { review, teams } = await reviewRequests($, options)
    const now = await $.clock.now()
    const mine = prs.map(pr => toItem(pr, readiness(pr), now, options.staleThreshold))
    await update($, snapshot, () => ({ mine, review, teams, updatedAt: now, problem: null }))
  } catch (error) {
    await update($, snapshot, last => ({ ...last, problem: problemOf(error) }))
  }
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
