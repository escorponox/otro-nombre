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
import { ancestryKey, ancestryToKeep, isSameAncestry, keptAncestryOf } from './domain/ancestry'
import type { KeptAncestry } from './domain/ancestry'
import { unlistedAnalysisKeys } from './domain/analysis'
import { ARM_MS, pressOf } from './domain/confirmation'
import { toItem } from './domain/item'
import { isDue } from './domain/polling'
import { ancestryTag, promotionOf, regionFileOf, regionPromotion, stableVersionOf } from './domain/promotion'
import type { Environment, Promotion, RegionPromotion, RegionVersion } from './domain/promotion'
import type { OpenPullRequest } from './domain/pull-request'
import { readiness } from './domain/readiness'
import { reviewState } from './domain/review-state'
import { reviewWindowStart } from './domain/review-window'
import { awaitsRelease, isContained, releaseCandidates, toMergedItem } from './domain/shipment'
import type { MergedPullRequest, Release } from './domain/shipment'
import { statusRow } from './domain/status-row'
import { visibleOnly } from './domain/visibility'
import { GH_TOKEN_COMMANDS, NoToken, graphqlData, graphqlRequest, restRequest } from './github/client'
import { CIRCLECI_CONFIG, appFoldersOf, appTreesOf, appTreesQuery, blobTextsOf, blobsQuery, codeSearchPath, imageNamesOf } from './github/deployments'
import type { AppTreesData, BlobsData, CircleCiConfigData, DeploymentApp, TreeEntry } from './github/deployments'
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
import { EMPTY_SNAPSHOT, findOpenItem } from './snapshot'

const GH_TIMEOUT_MS = 10_000
/** The `$.store` key of the snapshot cache shared by the person's sessions. */
const CACHE_KEY = 'snapshot-cache'
/** How often the session looks at the shared cache; `isDue` decides whether it fetches. */
const POLL_TICK_MS = 15_000

/** The `$.store` key of the teams the person switched off (`org/team` list). */
const TEAMS_OFF = 'teamsOff'

/** The key prefix of a team switch Button in the pane. */
const TEAM_SWITCH = 'team:'

/** The `$.store` key of each repo's discovered app folders (see `DeploymentsCache`). */
const DEPLOYMENTS_KEY = 'deployments'
/** How long a repo's discovery is kept before it is made again. */
const REDISCOVER_MS = 86_400_000
/** The `$.store` key of the version each region file's blob promotes, by blob id; null when it has none. */
const STABLE_VERSIONS_KEY = 'stable-versions'
/** The `$.store` key of the compare answers GitHub could tell (see `KeptAncestry`). */
const ANCESTRY_KEY = 'ancestry'

/** Each repo's (`owner/name`) app folders in the deployments repos, and when they were discovered. */
type DeploymentsCache = Record<string, { apps: DeploymentApp[]; checkedAt: number }>

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
      const item = findOpenItem(await read($, snapshot), id)
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
  return fetching ?? track(fetchIntoCache($, options))
}

/**
 * Fetches anew once the fetch in flight, if any, is done: after a write action, whose effect a
 * fetch that started before it cannot show.
 */
function refreshAnew($: EngineInterface, options: Options): Promise<void> {
  const before = fetching ?? Promise.resolve()
  return track(before.catch(() => undefined).then(() => fetchIntoCache($, options)))
}

/** Makes `fetch` the one in flight, joined by the refreshes asked for until it is done. */
function track(fetch: Promise<void>): Promise<void> {
  const tracked: Promise<void> = fetch.finally(() => {
    if (fetching === tracked) fetching = undefined
  })
  fetching = tracked
  return tracked
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
    fetchOpen($, options).then(async lists => {
      await amend(current => ({ ...current, ...lists }))
      await forgetUnlistedAnalyses($, [...lists.mine, ...lists.review])
    }),
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
  const regionsOf = await promotedRegions($, options, [...new Set(prs.map(pr => pr.repository))])
  const now = await $.clock.now()
  const ancestry: Ancestry = { kept: keptAncestryOf(await $.store.get(ANCESTRY_KEY)), answers: new Map() }
  const items = await Promise.all(prs.map(async pr => {
    const release = await containingRelease($, options, pr, ancestry)
    const promotion = await regionsPromotion($, options, pr, regionsOf(pr.repository), ancestry)
    return toMergedItem(pr, release, promotion, now)
  }))
  const toKeep = ancestryToKeep(ancestry.answers)
  if (!isSameAncestry(toKeep, ancestry.kept)) await $.store.set(ANCESTRY_KEY, toKeep)
  return items
}

/**
 * One merged fetch's answers to whether a release tag contains a merge commit: the ones kept in
 * the store by earlier refreshes, and the ones this fetch used, by `ancestryKey`.
 */
interface Ancestry {
  kept: KeptAncestry
  answers: Map<string, boolean | null>
}

/**
 * The earliest release whose tag contains the merge commit, checked by commit ancestry one
 * candidate at a time, earliest first; null when none does or the ship status does not hang on one.
 * `ancestry` keeps the answers for the pull request's Promotion.
 */
async function containingRelease(
  $: EngineInterface,
  options: Options,
  pr: MergedPullRequest,
  ancestry: Ancestry,
): Promise<Release | null> {
  if (!awaitsRelease(pr)) return null
  for (const release of releaseCandidates(pr)) {
    if (await containsMergeCommit($, options, pr, release.tag, ancestry)) return release
  }
  return null
}

/**
 * Whether the release tagged `tag` contains the merge commit, by GitHub's compare; null when it
 * cannot be told (no merge commit, or GitHub knows no such tag). A tag is compared once per
 * refresh, and an answer GitHub could tell never again: `ancestry` keeps the answers.
 */
async function containsMergeCommit(
  $: EngineInterface,
  options: Options,
  pr: MergedPullRequest,
  tag: string,
  ancestry: Ancestry,
): Promise<boolean | null> {
  if (!pr.mergeCommit) return null
  const key = ancestryKey(pr.repository, tag, pr.mergeCommit.oid)
  if (!ancestry.answers.has(key)) ancestry.answers.set(key, ancestry.kept[key] ?? (await compare($, options, pr.repository, tag, pr.mergeCommit.oid)))
  return ancestry.answers.get(key) ?? null
}

/** Whether `tag` contains the commit `oid` in `repository`, by GitHub's compare; null when GitHub knows no such tag or commit. */
async function compare($: EngineInterface, options: Options, repository: string, tag: string, oid: string): Promise<boolean | null> {
  const status = comparisonStatusOf(await rest($, options, comparePath(repository, tag, oid)))
  return status === null ? null : isContained(status)
}

/**
 * A merged pull request's Promotion to staging and production from the version each region runs
 * (`regions`, none without a deployments setup), one region at a time so a tag is compared once.
 */
async function regionsPromotion(
  $: EngineInterface,
  options: Options,
  pr: MergedPullRequest,
  regions: RegionVersion[],
  ancestry: Ancestry,
): Promise<Promotion> {
  const promotions: { environment: Environment; promotion: RegionPromotion }[] = []
  for (const region of regions) {
    const tag = ancestryTag(pr, region.version)
    const contains = tag === null ? null : await containsMergeCommit($, options, pr, tag, ancestry)
    promotions.push({ environment: region.environment, promotion: regionPromotion(pr, region.version, contains) })
  }
  return promotionOf(promotions)
}

/**
 * The regions each repo is deployed to, with the version each runs: the repos' apps discovered
 * once (see `deploymentApps`), then every app folder read at once (see `regionVersions`).
 */
async function promotedRegions($: EngineInterface, options: Options, repositories: string[]): Promise<(repository: string) => RegionVersion[]> {
  const appsOf = new Map<string, DeploymentApp[]>()
  // One repo at a time: code search allows few requests a minute.
  for (const repository of repositories) appsOf.set(repository, await deploymentApps($, options, repository))
  const apps = [...appsOf.values()].flat()
  const versions = await regionVersions($, options, apps)
  return repository => (appsOf.get(repository) ?? []).flatMap(app => versions[apps.indexOf(app)] ?? [])
}

/**
 * A repo's app folders in the deployments repos of its org, discovered once and kept in the
 * store shared by the person's sessions; discovered again after a day, so a setup made since shows.
 */
async function deploymentApps($: EngineInterface, options: Options, repository: string): Promise<DeploymentApp[]> {
  const now = await $.clock.now()
  const known = (await $.store.get(DEPLOYMENTS_KEY)) as DeploymentsCache | undefined
  const cached = known?.[repository]
  if (cached && now - cached.checkedAt < REDISCOVER_MS) return cached.apps
  const apps = await discoverApps($, options, repository)
  const latest = (await $.store.get(DEPLOYMENTS_KEY)) as DeploymentsCache | undefined
  await $.store.set(DEPLOYMENTS_KEY, { ...latest, [repository]: { apps, checkedAt: now } })
  return apps
}

/**
 * A repo's app folders (ADR 0001): its images, named as `repository:` in its CircleCI config; the
 * folders of the `values.yaml` files naming one in its org; of those, the ones holding a `kargo` entry.
 */
async function discoverApps($: EngineInterface, options: Options, repository: string): Promise<DeploymentApp[]> {
  const [owner = '', name = ''] = repository.split('/')
  const images = imageNamesOf(await graphql<CircleCiConfigData>($, options, CIRCLECI_CONFIG, { owner, name }))
  const candidates = new Map<string, DeploymentApp>()
  for (const image of images) {
    for (const app of appFoldersOf(await rest($, options, codeSearchPath(image, owner)))) {
      candidates.set(`${app.repository}/${app.path}`, app)
    }
  }
  const folders = [...candidates.values()]
  if (folders.length === 0) return []
  const trees = await appTrees($, options, folders)
  return folders.filter((_, index) => trees[index]?.some(entry => entry.name === 'kargo'))
}

/** Each app folder's entries, read in one query. */
async function appTrees($: EngineInterface, options: Options, apps: DeploymentApp[]): Promise<TreeEntry[][]> {
  const { query, variables } = appTreesQuery(apps)
  return appTreesOf(await graphql<AppTreesData>($, options, query, variables), apps.length)
}

/**
 * Each app's regions with the version each runs: one tree query for every app folder, and the
 * region files read only when their blob is new; the store keeps each blob's version, holding
 * only the blobs of this read so it never outgrows the deployments repos.
 */
async function regionVersions($: EngineInterface, options: Options, apps: DeploymentApp[]): Promise<RegionVersion[][]> {
  if (apps.length === 0) return []
  const trees = await appTrees($, options, apps)
  const files = apps.map((app, index) => (trees[index] ?? []).flatMap(entry => {
    const region = regionFileOf(entry.name)
    return region ? [{ ...region, repository: app.repository, oid: entry.oid }] : []
  }))
  const known = ((await $.store.get(STABLE_VERSIONS_KEY)) ?? {}) as Record<string, string | null>
  const unread = [...new Map(files.flat().filter(file => !(file.oid in known)).map(file => [file.oid, file])).values()]
  const read: Record<string, string | null> = {}
  if (unread.length > 0) {
    const { query, variables } = blobsQuery(unread)
    const texts = blobTextsOf(await graphql<BlobsData>($, options, query, variables), unread.length)
    unread.forEach((file, index) => { read[file.oid] = stableVersionOf(texts[index] ?? '') })
  }
  const everyVersion = { ...known, ...read }
  const versions = Object.fromEntries(files.flat().map(file => [file.oid, everyVersion[file.oid] ?? null]))
  if (unread.length > 0 || Object.keys(known).length !== Object.keys(versions).length) await $.store.set(STABLE_VERSIONS_KEY, versions)
  return files.map(list => list.map(file => ({ environment: file.environment, version: versions[file.oid] ?? null })))
}

/**
 * Deletes from the store the analyses (see `analyses.ts`) of the pull requests no longer in the
 * open lists, merged or closed since: nothing would ever draw them again.
 */
async function forgetUnlistedAnalyses($: EngineInterface, listed: PullRequestItem[]): Promise<void> {
  for (const key of unlistedAnalysisKeys(await $.store.keys(), listed)) await $.store.delete(key)
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
  await refreshAnew($, options)
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
