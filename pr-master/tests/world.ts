import type { On } from 'claude-code'
import type { Engine, Mounted } from 'claude-code/testing'

export const PLUGIN = 'pr-master'
export const PANE_ID = 'pr-master'
export const SURFACES = ['terminal', 'desktop'] as const

/** The Pane's mount arguments as a docked pane on `surface`, its body `bodyRows` tall. */
export function paneMount(surface: (typeof SURFACES)[number], bodyRows = 40) {
  return {
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'PR Master', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
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
  /** Every scroll of a window the engine itself made: one the mod let through. */
  const engineScrolls: number[] = []
  on('ui.scroll', ($, e) => { engineScrolls.push(e.offset); return {} })
  on('ui.focus', () => ({}))
  /** Every `$.ui.copy` the mod made. `copyFails` makes the next copies reach no clipboard. */
  const copies: { text: string; surface: string | undefined }[] = []
  const clipboard = { copyFails: false }
  on('ui.copy', ($, e) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: clipboard.copyFails ? { isCopied: false, reason: 'no-clipboard' } : { isCopied: true } }
  })
  return { open, opens, commands, engineScrolls, copies, clipboard }
}

export const GRAPHQL_URL = 'https://api.github.com/graphql'
export const MY_PULL_REQUESTS_QUERY = 'is:pr is:open author:@me archived:false sort:updated-desc'

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
 */
export function github(on: On) {
  const fake = {
    /** What `gh auth token` prints; `null` makes it exit 1 (logged out); `'missing'` makes every gh path fail to start. */
    ghToken: 'gho_fake' as string | null | 'missing',
    searches: { [MY_PULL_REQUESTS_QUERY]: [] } as Record<string, object[]>,
    /** The review threads of each pull request, by node id. */
    threads: {} as Record<string, object[]>,
    /** What `open <url>` prints to stderr as it exits 1; undefined: it opens the browser. */
    openFailure: undefined as string | undefined,
    /** When set, every GraphQL request answers this HTTP status. */
    failWith: undefined as number | undefined,
    requests: [] as GitHubRequest[],
    argvs: [] as string[][],
  }
  on('process.run', ($, e) => {
    fake.argvs.push([...e.argv])
    if (e.argv[0] === 'open') {
      const exitCode = fake.openFailure === undefined ? 0 : 1
      return { value: { exitCode, stdout: '', stderr: fake.openFailure ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
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
  on('http.fetch', ($, e) => {
    const body = JSON.parse(e.init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> }
    fake.requests.push({
      url: e.url,
      method: e.init?.method,
      headers: { ...e.init?.headers },
      query: body.query ?? '',
      variables: body.variables ?? {},
    })
    if (fake.failWith !== undefined) {
      return { value: { status: fake.failWith, ok: false, headers: {}, text: '{"message":"Server Error"}' } }
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
