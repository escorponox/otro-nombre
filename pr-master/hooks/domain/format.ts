/** A pull request as far as its name reads it. */
export interface Named {
  number: number
  /** `owner/name`. */
  repo: string
}

/** `#12 owner/name`: a pull request as the refresh line and the analyses name it. */
export function refOf(pr: Named): string {
  return `#${pr.number} ${pr.repo}`
}

/** `#12 name`: a pull request as its list item draws it, its owner left out. */
export function shortRefOf(pr: Named): string {
  return `#${pr.number} ${pr.repo.slice(pr.repo.indexOf('/') + 1)}`
}

/** What a failure says: an error's message, or anything else thrown as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
