import type { OpenPullRequest } from '../domain/pull-request'

const THREADS_LIMIT = 100

/**
 * The GraphQL query of the review threads of some pull requests, by node id: whether each thread
 * is resolved and who opened it (its first comment's author). Its variable `ids` holds the ids.
 */
export const REVIEW_THREADS = `query ReviewThreads($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id
      reviewThreads(first: ${THREADS_LIMIT}) { nodes { isResolved comments(first: 1) { nodes { author { login } } } } }
    }
  }
}`

/** A review thread node as `REVIEW_THREADS` returns it; `author` is `null` for a deleted account. */
interface ReviewThreadNode {
  isResolved: boolean
  comments: { nodes: { author: { login: string } | null }[] }
}

/** What `REVIEW_THREADS` answers; a node GitHub no longer finds comes back `null`. */
export interface ReviewThreadsData {
  nodes: ({ id: string; reviewThreads: { nodes: ReviewThreadNode[] } } | null)[]
}

/** The pull requests whose review threads are read: as PRMasterTray does, only the blocked ones. */
export function needsThreads(pr: OpenPullRequest): boolean {
  return pr.mergeState === 'BLOCKED'
}

/** `prs` with the authors of their unresolved review threads from a `REVIEW_THREADS` answer. */
export function withUnresolvedThreads(prs: OpenPullRequest[], data: ReviewThreadsData): OpenPullRequest[] {
  const authorsById = new Map<string, string[]>()
  for (const node of data.nodes) {
    if (!node) continue
    const unresolved = node.reviewThreads.nodes.filter(thread => !thread.isResolved)
    authorsById.set(node.id, unresolved.map(thread => thread.comments.nodes[0]?.author?.login ?? 'ghost'))
  }
  return prs.map(pr => ({ ...pr, unresolvedThreadAuthors: authorsById.get(pr.id) ?? pr.unresolvedThreadAuthors }))
}
