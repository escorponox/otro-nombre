import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

export const PLUGIN = 'pr-master'
export const PANE_ID = 'pr-master'
export const SURFACES = ['terminal', 'desktop'] as const

/** The Pane's mount arguments as a docked pane on `surface`. */
export function paneMount(surface: (typeof SURFACES)[number]) {
  return {
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'PR Master', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
}

/**
 * The world beneath the mod, answered as Claude Code would: the session's panes
 * (`open` is the engine's pane record) and the commands the mod registers.
 * Call before the first call on `$`.
 */
export function world(on: On) {
  const open = new Set<string>()
  /** Every `$.ui.open` the mod made, with its arguments. */
  const opens: { id: string; focus?: boolean }[] = []
  const commands: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => { commands.push(e.name); return { value: { command: e.name } } })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => { open.add(e.id); opens.push({ id: e.id, focus: e.focus }); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { open.delete(e.id); return { value: undefined } })
  return { open, opens, commands }
}

export const GRAPHQL_URL = 'https://api.github.com/graphql'
export const MY_PULL_REQUESTS_QUERY = 'is:pr is:open author:@me archived:false sort:updated-desc'

/** GitHub's REST compare of `base...head` in `owner/name`. */
const COMPARE_URL = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/compare\/(.+)\.\.\.([^?]+)/

/** A request the mod sent to GitHub. */
export interface GitHubRequest {
  url: string
  method: string | undefined
  headers: Record<string, string>
  query: string
  variables: Record<string, unknown>
}

/**
 * GitHub and the `gh` CLI beneath the mod. Change the fields between calls on `$`
 * to change what the next refresh sees. Call before the first call on `$`.
 *
 * GraphQL searches are answered by their `q` variable: `searches[q]` holds the
 * pull request nodes (see `pullRequestNode`); a search nobody canned is a GraphQL error.
 * The review threads query is answered from `threads[id]` (see `reviewThread`); none by default.
 * The merged pull requests' search is answered from `merged`, and REST compares from `compares`.
 */
export function github(on: On) {
  const fake = {
    /** What `gh auth token` prints; `null` makes it exit 1 (logged out); `'missing'` makes every gh path fail to start. */
    ghToken: 'gho_fake' as string | null | 'missing',
    searches: { [MY_PULL_REQUESTS_QUERY]: [] } as Record<string, object[]>,
    /** The review threads of each pull request, by node id. */
    threads: {} as Record<string, object[]>,
    /** When set, every GraphQL request answers this HTTP status. */
    failWith: undefined as number | undefined,
    /** The nodes answered to any search for merged pull requests (see `mergedPullRequestNode`); none by default. */
    merged: [] as object[],
    /** When set, the search for merged pull requests alone answers this HTTP status. */
    mergedFailWith: undefined as number | undefined,
    /**
     * What the search for merged pull requests waits for before it answers, e.g. `() => clock.sleep(5_000)`
     * on the test's `mock.clock` (a fake cannot call `$.clock` from this file). Keep it under the
     * hook's 10 s budget, past which the fake is dropped.
     */
    mergedWait: undefined as (() => Promise<void>) | undefined,
    /**
     * REST compare answers, keyed `owner/name tag...mergeCommitOid`, valued as GitHub's `status`
     * (`behind`, `identical`, `ahead`, `diverged`); a compare nobody canned is a 404.
     */
    compares: {} as Record<string, string>,
    /** The requests of the open pull requests' fetch, in order. */
    requests: [] as GitHubRequest[],
    /** The requests of the merged pull requests' fetch (the search and the compares), in order. */
    mergedRequests: [] as GitHubRequest[],
    argvs: [] as string[][],
  }
  on('process.run', ($, e) => {
    fake.argvs.push([...e.argv])
    if (fake.ghToken === 'missing') throw new Error(`${e.argv[0]}: not found`)
    const isLoggedIn = fake.ghToken !== null
    return {
      value: {
        exitCode: isLoggedIn ? 0 : 1,
        stdout: isLoggedIn ? `${fake.ghToken}\n` : '',
        stderr: isLoggedIn ? '' : 'no oauth token found for github.com',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('http.fetch', async ($, e) => {
    const body = JSON.parse(e.init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> }
    const compare = COMPARE_URL.exec(e.url)
    const isMergedSearch = String(body.variables?.q).includes('is:merged')
    const request = {
      url: e.url,
      method: e.init?.method,
      headers: { ...e.init?.headers },
      query: body.query ?? '',
      variables: body.variables ?? {},
    }
    if (compare || isMergedSearch) fake.mergedRequests.push(request)
    else fake.requests.push(request)
    if (fake.failWith !== undefined) {
      return { value: { status: fake.failWith, ok: false, headers: {}, text: '{"message":"Server Error"}' } }
    }
    if (compare) {
      const [, repo, base, head] = compare
      const status = fake.compares[`${repo} ${decodeURIComponent(base ?? '')}...${head}`]
      return status
        ? { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ status, ahead_by: 0, behind_by: 1, commits: [] }) } }
        : { value: { status: 404, ok: false, headers: {}, text: '{"message":"Not Found"}' } }
    }
    if (isMergedSearch) {
      await fake.mergedWait?.()
      if (fake.mergedFailWith !== undefined) {
        return { value: { status: fake.mergedFailWith, ok: false, headers: {}, text: '{"message":"Server Error"}' } }
      }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ data: { search: { nodes: fake.merged } } }) } }
    }
    const ids = body.variables?.ids as string[] | undefined
    const nodes = fake.searches[String(body.variables?.q)]
    const answer = ids
      ? { data: { nodes: ids.map(id => ({ id, reviewThreads: { nodes: fake.threads[id] ?? [] } })) } }
      : nodes
        ? { data: { search: { nodes } } }
        : { errors: [{ message: `no canned search for ${String(body.variables?.q)}` }] }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } }
  })
  return fake
}

/** A pull request node as GitHub's GraphQL search returns it: an approved, clean, public one unless `facts` say otherwise. */
export function pullRequestNode(number: number, facts: {
  repo?: string
  title?: string
  createdAt?: string
  isDraft?: boolean
  mergeable?: string
  mergeStateStatus?: string
  reviewDecision?: string | null
  checks?: string | null
  isPrivate?: boolean
} = {}) {
  const repo = facts.repo ?? 'acme/api'
  return {
    id: `PR_${number}`,
    number,
    title: facts.title ?? `Pull request ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    isDraft: facts.isDraft ?? false,
    mergeable: facts.mergeable ?? 'MERGEABLE',
    mergeStateStatus: facts.mergeStateStatus ?? 'CLEAN',
    reviewDecision: facts.reviewDecision === undefined ? 'APPROVED' : facts.reviewDecision,
    createdAt: facts.createdAt ?? '2026-10-13T00:00:00Z',
    author: { login: 'me' },
    repository: { nameWithOwner: repo, isPrivate: facts.isPrivate ?? false, owner: { login: repo.split('/')[0] } },
    commits: { nodes: [{ commit: { statusCheckRollup: facts.checks === null ? null : { state: facts.checks ?? 'SUCCESS' } } }] },
  }
}

/**
 * A merged pull request node as GitHub's GraphQL search returns it: merged at `mergedAt`
 * (2026-10-15 10:00 UTC by default) as commit `merge-<number>`, whose checks all passed
 * (two successful check runs), in a public repo with no releases, unless `facts` say otherwise.
 */
export function mergedPullRequestNode(number: number, facts: {
  repo?: string
  title?: string
  mergedAt?: string
  /** `null`: GitHub has no merge commit for it. */
  mergeCommit?: null
  checks?: string | null
  /** Each check run's conclusion; `null` while it runs. */
  conclusions?: (string | null)[]
  /** The repo's releases, newest first as GitHub answers them. */
  releases?: { tag: string; createdAt: string; isDraft?: boolean }[]
  isPrivate?: boolean
} = {}) {
  const repo = facts.repo ?? 'acme/api'
  const contexts = (facts.conclusions ?? ['SUCCESS', 'SUCCESS']).map(conclusion => ({
    __typename: 'CheckRun',
    status: conclusion === null ? 'IN_PROGRESS' : 'COMPLETED',
    conclusion,
  }))
  return {
    id: `PR_${number}`,
    number,
    title: facts.title ?? `Merged pull request ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    mergedAt: facts.mergedAt ?? '2026-10-15T10:00:00Z',
    repository: {
      nameWithOwner: repo,
      isPrivate: facts.isPrivate ?? false,
      owner: { login: repo.split('/')[0] },
      releases: {
        nodes: (facts.releases ?? []).map(release => ({
          tagName: release.tag,
          createdAt: release.createdAt,
          isDraft: release.isDraft ?? false,
        })),
      },
    },
    mergeCommit: facts.mergeCommit === null ? null : {
      oid: `merge-${number}`,
      statusCheckRollup: facts.checks === null ? null : { state: facts.checks ?? 'SUCCESS', contexts: { nodes: contexts } },
    },
  }
}

/** A review thread node as GitHub's GraphQL API returns it: opened by `author`, unresolved unless `isResolved`. */
export function reviewThread(author: string, isResolved = false) {
  return { isResolved, comments: { nodes: [{ author: { login: author } }] } }
}

export async function startSession($: Engine) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
}

export async function runPrs($: Engine) {
  return $.command.run({ command: 'prs', args: '' } as never)
}

/** A drawn element as `FoundElement.children` holds it. */
interface Drawn {
  type: string
  props: Record<string, unknown>
  children: (Drawn | string)[]
}

const textOf = (node: Drawn | string | undefined): string =>
  node === undefined ? '' : typeof node === 'string' ? node : node.children.map(textOf).join('')

/**
 * An item as drawn: its bullet's dot colour; on its first line `#number repo`, then its label and age,
 * and whether it is marked stale; its title on the line under it.
 */
export async function drawnItem(ui: Mounted<(typeof SURFACES)[number], 'Pane'>, id: string) {
  const item = await ui.find({ key: `item:${id}` })
  const [bullet, column] = (item?.children ?? []) as Drawn[]
  const [firstLine, title] = (column?.children ?? []) as Drawn[]
  const [ref, ...rest] = firstLine?.children ?? []
  const [, meta, stale] = rest.map(textOf)
  const dot = bullet?.children[0] as Drawn | undefined
  return {
    dot: dot?.props.color,
    ref: textOf(ref),
    meta,
    isStale: stale === ' · stale',
    title: textOf(title),
  }
}

/**
 * A Merged pull request as drawn: its bullet; its title; indented under it, each Shipment step's
 * name with its dot colour, and the ref.
 */
export async function drawnMergedItem(ui: Mounted<(typeof SURFACES)[number], 'Pane'>, id: string) {
  const item = await ui.find({ key: `item:${id}` })
  const [bullet, column] = (item?.children ?? []) as Drawn[]
  const [title, indented] = (column?.children ?? []) as Drawn[]
  const [steps, ref] = (indented?.children ?? []) as Drawn[]
  const shipment: Record<string, unknown> = {}
  for (const step of (steps?.children ?? []) as Drawn[]) {
    const [dot, name] = step.children as Drawn[]
    shipment[textOf(name).trim()] = dot?.props.color
  }
  return { bullet: textOf(bullet), title: textOf(title), shipment, ref: textOf(ref), indent: indented?.props.paddingLeft }
}
