import type { HttpResponse } from 'claude-code'

import { GitHubError } from './client'

/**
 * The deployments repo lookup's requests and answers as plain data (ADR 0001): a repo's images,
 * named as `repository:` in its CircleCI config; the app folders of the org's deployments repos
 * whose `values.yaml` names one; and those folders' entries and files.
 */

/** An app folder of a deployments repo: `path` in `repository` (`owner/name`). */
export interface DeploymentApp {
  repository: string
  path: string
}

/** An entry of an app folder, with its git object id. */
export interface TreeEntry {
  name: string
  oid: string
}

/** The GraphQL query of a repo's CircleCI config on its default branch; variables `owner` and `name`. */
export const CIRCLECI_CONFIG = `query CircleCiConfig($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { object(expression: "HEAD:.circleci/config.yml") { ... on Blob { text } } }
}`

/** What `CIRCLECI_CONFIG` answers; no object when the repo has no CircleCI config. */
export interface CircleCiConfigData {
  repository: { object: { text: string | null } | null } | null
}

/**
 * The image names a CircleCI config pushes: its plain `repository:` values. Templated values
 * (`<<pipeline.parameters.x>>`) and YAML aliases (`*name`) name no image the mod can read.
 */
export function imageNamesOf(data: CircleCiConfigData): string[] {
  const text = data.repository?.object?.text ?? ''
  const names = [...text.matchAll(/^[ \t-]*repository:[ \t]*["']?([a-z0-9][a-z0-9._/-]*)["']?[ \t]*(?:#.*)?$/gm)].map(match => match[1] ?? '')
  return [...new Set(names)]
}

/** The REST path of the code search for `values.yaml` files naming `image` in the repos of `org`. */
export function codeSearchPath(image: string, org: string): string {
  return `/search/code?q=${encodeURIComponent(`"${image}" org:${org} filename:values.yaml`)}&per_page=100`
}

/** A code search answer, as far as it is read. */
interface CodeSearchBody {
  items: { name: string; path: string; repository: { full_name: string } }[]
}

/** The folders holding the `values.yaml` files a code search found: the candidate app folders. */
export function appFoldersOf(response: HttpResponse): DeploymentApp[] {
  if (!response.ok) throw new GitHubError(`HTTP ${response.status}`)
  const body = JSON.parse(response.text) as CodeSearchBody
  return body.items
    .filter(item => item.name === 'values.yaml' && item.path.includes('/'))
    .map(item => ({ repository: item.repository.full_name, path: item.path.slice(0, item.path.lastIndexOf('/')) }))
}

/** A GraphQL query with its variables. */
export interface Query {
  query: string
  variables: Record<string, string>
}

/**
 * One query reading several objects, one alias each: `targets[i]` is a folder of
 * `repositories[i]` (`kind` expression, read as a tree) or a blob id (`kind` oid, read as text).
 */
function objectsQuery(name: string, kind: 'expression' | 'oid', targets: { repository: string; target: string }[]): Query {
  const type = kind === 'expression' ? 'String!' : 'GitObjectID!'
  const selection = kind === 'expression' ? '... on Tree { entries { name oid } }' : '... on Blob { text }'
  const variables: Record<string, string> = {}
  const declarations: string[] = []
  const fields = targets.map(({ repository, target }, index) => {
    const [owner = '', repo = ''] = repository.split('/')
    Object.assign(variables, { [`o${index}`]: owner, [`n${index}`]: repo, [`t${index}`]: target })
    declarations.push(`$o${index}: String!, $n${index}: String!, $t${index}: ${type}`)
    return `  a${index}: repository(owner: $o${index}, name: $n${index}) { object(${kind}: $t${index}) { ${selection} } }`
  })
  return { query: `query ${name}(${declarations.join(', ')}) {\n${fields.join('\n')}\n}`, variables }
}

/** The query of the entries of each app folder, at once. */
export function appTreesQuery(apps: DeploymentApp[]): Query {
  return objectsQuery('AppTrees', 'expression', apps.map(app => ({ repository: app.repository, target: `HEAD:${app.path}` })))
}

/** What `appTreesQuery` answers: an alias per app folder, with no object when the folder is gone. */
export type AppTreesData = Record<string, { object: { entries: TreeEntry[] } | null } | null>

/** Each app folder's entries, in the order asked; empty for a folder that is gone. */
export function appTreesOf(data: AppTreesData, count: number): TreeEntry[][] {
  return Array.from({ length: count }, (_, index) => data[`a${index}`]?.object?.entries ?? [])
}

/** The query of the text of each blob, at once. */
export function blobsQuery(blobs: { repository: string; oid: string }[]): Query {
  return objectsQuery('StableVersions', 'oid', blobs.map(blob => ({ repository: blob.repository, target: blob.oid })))
}

/** What `blobsQuery` answers: an alias per blob. */
export type BlobsData = Record<string, { object: { text: string | null } | null } | null>

/** Each blob's text, in the order asked; empty for a blob GitHub no longer has. */
export function blobTextsOf(data: BlobsData, count: number): string[] {
  return Array.from({ length: count }, (_, index) => data[`a${index}`]?.object?.text ?? '')
}
