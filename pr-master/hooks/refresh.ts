import { atom, update } from 'claude-code'
import type { EngineInterface, HttpResponse, On } from 'claude-code'

import type { RefreshProblem } from '../types'
import { toItem } from './domain/item'
import type { OpenPullRequest } from './domain/pull-request'
import { readiness } from './domain/readiness'
import { awaitsRelease, isContained, releaseCandidates, toMergedItem } from './domain/shipment'
import type { MergedPullRequest, Release } from './domain/shipment'
import { visibleOnly } from './domain/visibility'
import { GH_TOKEN_COMMANDS, NoToken, graphqlData, graphqlRequest, restRequest } from './github/client'
import { MERGED_PULL_REQUESTS_SEARCH, comparePath, comparisonStatusOf, mergedPullRequestsOf, mergedPullRequestsSearch } from './github/merged'
import type { MergedPullRequestsSearchData } from './github/merged'
import { MY_PULL_REQUESTS, OPEN_PULL_REQUESTS_SEARCH, openPullRequestsOf } from './github/open-pull-requests'
import type { OpenPullRequestsSearchData } from './github/open-pull-requests'
import { REVIEW_THREADS, needsThreads, withUnresolvedThreads } from './github/threads'
import type { ReviewThreadsData } from './github/threads'
import type { Options } from './options'
import { EMPTY_SNAPSHOT } from './snapshot'

const GH_TIMEOUT_MS = 10_000

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)

/**
 * The token, obtained once per module load. A module variable is fine here: it is never drawn,
 * and a reload (a settings change included) obtains it again.
 */
let token: Promise<string | undefined> | undefined

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
 * Fetches from GitHub now and refreshes the snapshot. The open pull requests and the merged ones
 * are fetched side by side and each list is written as soon as it arrives, so the slower merged
 * fetch never holds back the Mine tab. A failed fetch keeps its last list; once both are done,
 * the snapshot records the problem, if any.
 */
async function refresh($: EngineInterface, options: Options): Promise<void> {
  const results = await Promise.allSettled([refreshOpen($, options), refreshMerged($, options)])
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  await update($, snapshot, last => ({ ...last, problem: failure ? problemOf(failure.reason) : null }))
}

/** Fetches the open pull requests and derives each one's Turn and label with the domain rules. */
async function refreshOpen($: EngineInterface, options: Options): Promise<void> {
  const data = await graphql<OpenPullRequestsSearchData>($, options, OPEN_PULL_REQUESTS_SEARCH, { q: MY_PULL_REQUESTS })
  const prs = await withThreads($, options, visibleOnly(openPullRequestsOf(data), options))
  const now = await $.clock.now()
  const mine = prs.map(pr => toItem(pr, readiness(pr), now, options.staleThreshold))
  await update($, snapshot, last => ({ ...last, mine, updatedAt: now }))
}

/** Fetches the pull requests merged within the merged window and derives each one's Shipment. */
async function refreshMerged($: EngineInterface, options: Options): Promise<void> {
  const q = mergedPullRequestsSearch(options.mergedWindow, await $.clock.now())
  if (q === null) {
    await update($, snapshot, last => ({ ...last, merged: [] }))
    return
  }
  const data = await graphql<MergedPullRequestsSearchData>($, options, MERGED_PULL_REQUESTS_SEARCH, { q })
  const prs = visibleOnly(mergedPullRequestsOf(data), options)
  const merged = await Promise.all(prs.map(async pr => toMergedItem(pr, await containingRelease($, options, pr))))
  // Promotions to staging and production (ticket 09) are read here, before the list is written.
  await update($, snapshot, last => ({ ...last, merged }))
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
