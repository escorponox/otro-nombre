import type { HttpResponse } from 'claude-code'

import type { ChecksState } from '../domain/pull-request'
import type { ComparisonStatus, MergedPullRequest } from '../domain/shipment'
import { GitHubError } from './client'

/** The merged window setting's choices, as `userConfig` stores them. */
export type MergedWindow = 'off' | '1d' | '3d' | '1w'

const DAY_MS = 86_400_000
const WINDOW_DAYS: Record<Exclude<MergedWindow, 'off'>, number> = { '1d': 1, '3d': 3, '1w': 7 }

/** The search for the person's pull requests merged within `window` before `now`; null when the window is off. */
export function mergedPullRequestsSearch(window: MergedWindow, now: number): string | null {
  if (window === 'off') return null
  // GitHub's search takes a time with its offset, to the second.
  const since = `${new Date(now - WINDOW_DAYS[window] * DAY_MS).toISOString().slice(0, 19)}+00:00`
  return `is:pr is:merged author:@me archived:false merged:>${since} sort:updated-desc`
}

const SEARCH_LIMIT = 30
/** Enough to hold the releases cut since the oldest merge in the window. */
const RELEASES_LIMIT = 20
const CONTEXTS_LIMIT = 50

/** The GraphQL query of the search for merged pull requests; its variable `q` is the search. */
export const MERGED_PULL_REQUESTS_SEARCH = `query MergedPullRequests($q: String!) {
  search(query: $q, type: ISSUE, first: ${SEARCH_LIMIT}) {
    nodes { ... on PullRequest {
      id number title url mergedAt
      repository {
        nameWithOwner isPrivate owner { login }
        releases(first: ${RELEASES_LIMIT}, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName createdAt isDraft } }
      }
      mergeCommit {
        oid
        statusCheckRollup { state contexts(first: ${CONTEXTS_LIMIT}) {
          nodes { __typename ... on CheckRun { status conclusion } ... on StatusContext { state } }
        } }
      }
    } }
  }
}`

/** A check context: a check run (its conclusion is null while it runs) or a commit status. */
type ContextNode =
  | { __typename: 'CheckRun'; status: string; conclusion: string | null }
  | { __typename: 'StatusContext'; state: string }

/** A merged pull request node as `MERGED_PULL_REQUESTS_SEARCH` returns it. */
interface MergedPullRequestNode {
  id: string
  number: number
  title: string
  url: string
  mergedAt: string
  repository: {
    nameWithOwner: string
    isPrivate: boolean
    owner: { login: string }
    releases: { nodes: { tagName: string; createdAt: string; isDraft: boolean }[] }
  }
  mergeCommit: {
    oid: string
    statusCheckRollup: { state: Exclude<ChecksState, null>; contexts: { nodes: ContextNode[] } } | null
  } | null
}

/** What `MERGED_PULL_REQUESTS_SEARCH` answers; nodes that are not pull requests come back empty. */
export interface MergedPullRequestsSearchData {
  search: { nodes: (MergedPullRequestNode | Record<string, never>)[] }
}

/** The merged pull requests of a search answer, as plain data. */
export function mergedPullRequestsOf(data: MergedPullRequestsSearchData): MergedPullRequest[] {
  return data.search.nodes.filter(isPullRequest).map(toMergedPullRequest)
}

function isPullRequest(node: MergedPullRequestNode | Record<string, never>): node is MergedPullRequestNode {
  return 'id' in node
}

function toMergedPullRequest(node: MergedPullRequestNode): MergedPullRequest {
  const rollup = node.mergeCommit?.statusCheckRollup ?? null
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repository: node.repository.nameWithOwner,
    owner: node.repository.owner.login,
    isPrivate: node.repository.isPrivate,
    mergedAt: node.mergedAt,
    mergeCommit: node.mergeCommit && {
      oid: node.mergeCommit.oid,
      checks: rollup?.state ?? null,
      contexts: (rollup?.contexts.nodes ?? []).map(outcomeOf),
    },
    releases: node.repository.releases.nodes.map(release => ({
      tag: release.tagName,
      createdAt: release.createdAt,
      isDraft: release.isDraft,
    })),
  }
}

function outcomeOf(context: ContextNode): string {
  return context.__typename === 'CheckRun' ? (context.conclusion ?? context.status) : context.state
}

/** The REST path comparing release `tag` (base) with merge commit `oid` (head) in `repository`. */
export function comparePath(repository: string, tag: string, oid: string): string {
  // One commit is enough: only the status is read.
  return `/repos/${repository}/compare/${encodeURIComponent(tag)}...${oid}?per_page=1`
}

/** The status of a compare answer; null when GitHub knows no such tag or commit. */
export function comparisonStatusOf(response: HttpResponse): ComparisonStatus | null {
  if (response.status === 404) return null
  if (!response.ok) throw new GitHubError(`HTTP ${response.status}`)
  const body = JSON.parse(response.text) as { status: string }
  return body.status.toUpperCase() as ComparisonStatus
}
