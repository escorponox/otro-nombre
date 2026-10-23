/**
 * Whether a release tag contains a merge commit, kept across refreshes: a tag and a commit never
 * change, so neither does the answer. Keyed `owner/name tag...oid`.
 */
export type KeptAncestry = Record<string, boolean>

/** The key of the answer to whether `tag` contains the commit `oid` in `repository` (`owner/name`). */
export function ancestryKey(repository: string, tag: string, oid: string): string {
  return `${repository} ${tag}...${oid}`
}

/** The kept answers read back from the store; none when it holds no such record. */
export function keptAncestryOf(stored: unknown): KeptAncestry {
  if (typeof stored !== 'object' || stored === null) return {}
  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
}

/**
 * The answers to keep from one refresh's: the ones GitHub could tell (null, an unknown tag or
 * commit, is asked again next time). Only this refresh's, so the record never outgrows the merged window.
 */
export function ancestryToKeep(answers: ReadonlyMap<string, boolean | null>): KeptAncestry {
  return Object.fromEntries([...answers].filter((entry): entry is [string, boolean] => entry[1] !== null))
}

/** Whether two kept records hold the same answers. */
export function isSameAncestry(a: KeptAncestry, b: KeptAncestry): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => b[key] === a[key])
}
