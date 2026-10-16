import type { ChecksState, OpenPullRequest } from '../domain/pull-request'

/** The GraphQL fields of an open pull request that `toOpenPullRequest` reads. */
export const OPEN_PULL_REQUEST_FIELDS = `
  id number title url isDraft mergeable mergeStateStatus reviewDecision createdAt
  author { login }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`

/** An open pull request node as `OPEN_PULL_REQUEST_FIELDS` returns it. */
export interface OpenPullRequestNode {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  mergeable: OpenPullRequest['mergeable']
  mergeStateStatus: OpenPullRequest['mergeState']
  reviewDecision: OpenPullRequest['reviewDecision']
  createdAt: string
  /** `null` for a deleted account. */
  author: { login: string } | null
  repository: { nameWithOwner: string }
  commits: { nodes: { commit: { statusCheckRollup: { state: Exclude<ChecksState, null> } | null } }[] }
}

const SEARCH_LIMIT = 50

/** The GraphQL query of one search for open pull requests; its variable `q` is the search. */
export const OPEN_PULL_REQUESTS_SEARCH = `query OpenPullRequests($q: String!) {
  search(query: $q, type: ISSUE, first: ${SEARCH_LIMIT}) {
    nodes { ... on PullRequest { ${OPEN_PULL_REQUEST_FIELDS} } }
  }
}`

/** What `OPEN_PULL_REQUESTS_SEARCH` answers; nodes that are not pull requests come back empty. */
export interface OpenPullRequestsSearchData {
  search: { nodes: (OpenPullRequestNode | Record<string, never>)[] }
}

/** The person's open pull requests, most recently updated first. */
export const MY_PULL_REQUESTS = 'is:pr is:open author:@me archived:false sort:updated-desc'

/** The pull requests of a search answer, as plain data. */
export function openPullRequestsOf(data: OpenPullRequestsSearchData): OpenPullRequest[] {
  return data.search.nodes.filter(isPullRequest).map(toOpenPullRequest)
}

function isPullRequest(node: OpenPullRequestNode | Record<string, never>): node is OpenPullRequestNode {
  return 'id' in node
}

export function toOpenPullRequest(node: OpenPullRequestNode): OpenPullRequest {
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repository: node.repository.nameWithOwner,
    author: node.author?.login ?? 'ghost',
    createdAt: node.createdAt,
    isDraft: node.isDraft,
    mergeable: node.mergeable,
    mergeState: node.mergeStateStatus,
    reviewDecision: node.reviewDecision,
    checks: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    // Read by a second query, and only for blocked pull requests (see `threads.ts`).
    unresolvedThreadAuthors: [],
  }
}
