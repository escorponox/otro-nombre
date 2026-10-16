/** Which pull requests the person wants to see, from the mod's settings. */
export interface Visibility {
  /** Logins of the organisations (or users) whose repositories are hidden. */
  hiddenOrgs: readonly string[]
  /** Whether pull requests in private repositories are shown. */
  showPrivate: boolean
}

/** What `visibleOnly` reads of a pull request: where it lives. */
export interface RepositoryFacts {
  /** The repository owner's login. */
  owner: string
  isPrivate: boolean
}

/**
 * The pull requests the person wants to see, in their order. Applied to every fetched list
 * before anything is derived, so a hidden one counts nowhere. GitHub logins ignore case.
 */
export function visibleOnly<PullRequest extends RepositoryFacts>(prs: readonly PullRequest[], visibility: Visibility): PullRequest[] {
  const hidden = new Set(visibility.hiddenOrgs.map(login => login.trim().toLowerCase()))
  return prs.filter(pr => !hidden.has(pr.owner.toLowerCase()) && (visibility.showPrivate || !pr.isPrivate))
}
