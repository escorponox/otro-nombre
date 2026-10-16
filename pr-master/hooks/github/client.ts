import type { HttpInit, HttpResponse } from 'claude-code'

/**
 * The GitHub client's requests and answers as plain data. The calls on `$` that send them
 * live in `../refresh.ts`, since the engine follows `$` only into functions of the same file.
 */

/** The `gh auth token` command lines to try, in order: the host's PATH may lack Homebrew's folders. */
export const GH_TOKEN_COMMANDS: readonly (readonly string[])[] = [
  ['gh', 'auth', 'token'],
  ['/opt/homebrew/bin/gh', 'auth', 'token'],
  ['/usr/local/bin/gh', 'auth', 'token'],
]

/** Neither `gh auth token` nor the GitHub token setting gave a token. */
export class NoToken extends Error {
  constructor() {
    super('No GitHub token')
  }
}

/** GitHub answered a request with an error. */
export class GitHubError extends Error {}

/** The `$.http.fetch` arguments of a GraphQL query. */
export function graphqlRequest(token: string, query: string, variables: Record<string, unknown>): { url: string; init: HttpInit } {
  return {
    url: 'https://api.github.com/graphql',
    init: {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'pr-master' },
      body: JSON.stringify({ query, variables }),
    },
  }
}

/** The `data` of a GraphQL answer; throws `GitHubError` when GitHub answered an error. */
export function graphqlData<Data>(response: HttpResponse): Data {
  if (!response.ok) throw new GitHubError(`HTTP ${response.status}`)
  const body = JSON.parse(response.text) as { data?: Data; errors?: { message: string }[] }
  if (body.errors?.length || !body.data) throw new GitHubError(body.errors?.[0]?.message ?? 'GitHub answered no data')
  return body.data
}
