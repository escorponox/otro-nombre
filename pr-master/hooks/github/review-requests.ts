import type { ReviewRequest, ReviewStateOnGitHub } from '../domain/review-state'
import type { Visibility } from '../domain/visibility'
import { OPEN_PULL_REQUEST_FIELDS, toOpenPullRequest } from './open-pull-requests'
import type { OpenPullRequestNode } from './open-pull-requests'

/** The teams of the viewer's organisations the viewer is in, as member and as admin (needs `read:org`). */
export const VIEWER_TEAMS = `query ViewerTeams {
  viewer {
    organizations(first: 100) {
      nodes {
        login
        member: teams(first: 100, role: MEMBER) { nodes { combinedSlug } }
        admin: teams(first: 100, role: ADMIN) { nodes { combinedSlug } }
      }
    }
  }
}`

interface TeamNodes {
  nodes: { combinedSlug: string }[]
}

/** What `VIEWER_TEAMS` answers. */
export interface ViewerTeamsData {
  viewer: { organizations: { nodes: { login: string; member: TeamNodes; admin: TeamNodes }[] } }
}

/** The viewer's teams as `org/team`, sorted, leaving out those of hidden organisations. */
export function teamsOf(data: ViewerTeamsData, visibility: Visibility): string[] {
  const hidden = new Set(visibility.hiddenOrgs.map(login => login.trim().toLowerCase()))
  const slugs = data.viewer.organizations.nodes
    .filter(org => !hidden.has(org.login.toLowerCase()))
    .flatMap(org => [...org.member.nodes, ...org.admin.nodes])
    .map(team => team.combinedSlug)
  return [...new Set(slugs)].sort()
}

/** A team of the viewer and whether the person wants its Review requests. */
export interface Team {
  /** `org/team`. */
  slug: string
  isOn: boolean
}

const SEARCH_LIMIT = 50

/** The fields of a Review request: an open pull request's, and the viewer's latest review of it. */
const REVIEW_REQUEST_FIELDS = `${OPEN_PULL_REQUEST_FIELDS}
  viewerLatestReview { state }`

/** A dismissed approval's fields also hold the teams asked to review it, to honour the team switches. */
const DISMISSED_APPROVAL_FIELDS = `${REVIEW_REQUEST_FIELDS}
  timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
    nodes { ... on ReviewRequestedEvent { requestedReviewer { ... on Team { combinedSlug } } } }
  }`

/** The `created:>` qualifier of the review window, or nothing when it is off. */
const createdAfter = (windowStart: string | null) => (windowStart === null ? '' : ` created:>${windowStart}`)

/**
 * With private repositories hidden, GitHub is asked for public ones only, so that the counts it
 * returns for each team agree with what the panel lists.
 */
const publicOnly = (visibility: Visibility) => (visibility.showPrivate ? '' : ' is:public')

/** The search for a team's Review requests the person has not reviewed yet. */
export function teamSearch(team: string, windowStart: string | null, visibility: Visibility): string {
  return `is:pr is:open archived:false draft:false team-review-requested:${team} -author:@me -reviewed-by:@me${createdAfter(windowStart)} sort:updated-desc${publicOnly(visibility)}`
}

/** The search for pull requests the person reviewed that have no review standing: their approval was dismissed. */
export function dismissedSearch(windowStart: string | null, visibility: Visibility): string {
  return `is:pr is:open archived:false draft:false -author:@me reviewed-by:@me review:none${createdAfter(windowStart)}${publicOnly(visibility)}`
}

/** The alias (and variable) of each team's search: `t0`, `t1`, ... in the order of `teams`. */
const teamAlias = (index: number) => `t${index}`

/**
 * One GraphQL query holding an aliased search per team, a switched-off team's with `first: 0`
 * for its count alone, and the dismissed approvals' search.
 */
export function reviewRequestsQuery(teams: readonly Team[], windowStart: string | null, visibility: Visibility) {
  const variables: Record<string, string> = {}
  const searches = teams.map((team, index) => {
    const alias = teamAlias(index)
    variables[alias] = teamSearch(team.slug, windowStart, visibility)
    const first = team.isOn ? SEARCH_LIMIT : 0
    return `${alias}: search(query: $${alias}, type: ISSUE, first: ${first}) { issueCount nodes { ... on PullRequest { ${REVIEW_REQUEST_FIELDS} } } }`
  })
  variables.dismissed = dismissedSearch(windowStart, visibility)
  searches.push(
    `dismissed: search(query: $dismissed, type: ISSUE, first: ${SEARCH_LIMIT}) { issueCount nodes { ... on PullRequest { ${DISMISSED_APPROVAL_FIELDS} } } }`,
  )
  const declarations = Object.keys(variables).map(name => `$${name}: String!`).join(', ')
  return { query: `query ReviewRequests(${declarations}) {\n  ${searches.join('\n  ')}\n}`, variables }
}

/** A Review request node as the searches return it. */
interface ReviewRequestNode extends OpenPullRequestNode {
  viewerLatestReview: { state: ReviewStateOnGitHub } | null
  /** Only in the dismissed approvals' search. */
  timelineItems?: { nodes: { requestedReviewer?: { combinedSlug?: string } | null }[] }
}

interface SearchResult {
  issueCount: number
  nodes: (ReviewRequestNode | Record<string, never>)[]
}

/** What `reviewRequestsQuery` answers: one result per alias. */
export type ReviewRequestsData = Record<string, SearchResult>

/**
 * The Review requests of an answer, each listed once (team requests first, in their teams' order)
 * with every team it was found asked of, and each team's count as GitHub gives it. A dismissed
 * approval is listed unless every one of the person's teams asked to review it is switched off.
 */
export function reviewRequestsOf(data: ReviewRequestsData, teams: readonly Team[]): { requests: ReviewRequest[]; counts: number[] } {
  const fromTeams = teams.flatMap((team, index) =>
    pullRequestsOf(data[teamAlias(index)]).map(pr => ({ ...pr, requestedTeams: [team.slug] })),
  )
  const dismissed = pullRequestsOf(data.dismissed).filter(pr => pr.myReview === 'DISMISSED' && !isAskedOnlyOfTeamsOff(pr, teams))
  const byId = new Map<string, ReviewRequest>()
  for (const pr of [...fromTeams, ...dismissed]) {
    const listed = byId.get(pr.id)
    byId.set(pr.id, listed ? { ...listed, requestedTeams: [...new Set([...listed.requestedTeams, ...pr.requestedTeams])] } : pr)
  }
  return { requests: [...byId.values()], counts: teams.map((team, index) => data[teamAlias(index)]?.issueCount ?? 0) }
}

function isAskedOnlyOfTeamsOff(pr: ReviewRequest, teams: readonly Team[]): boolean {
  const mine = teams.filter(team => pr.requestedTeams.includes(team.slug))
  return mine.length > 0 && mine.every(team => !team.isOn)
}

function pullRequestsOf(result: SearchResult | undefined): ReviewRequest[] {
  return (result?.nodes ?? []).filter(isPullRequest).map(node => ({
    ...toOpenPullRequest(node),
    myReview: node.viewerLatestReview?.state ?? null,
    requestedTeams: (node.timelineItems?.nodes ?? []).flatMap(item => item.requestedReviewer?.combinedSlug ?? []),
  }))
}

function isPullRequest(node: ReviewRequestNode | Record<string, never>): node is ReviewRequestNode {
  return 'id' in node
}
