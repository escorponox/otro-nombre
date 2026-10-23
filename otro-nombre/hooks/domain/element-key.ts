/**
 * The pane's element keys: an element of a pull request is keyed `<kind>:<item id>` (`pr:PR_12`,
 * `copy:PR_12`, `merge:PR_12`), a team switch `team:<org/team>`, and the hooks that answer a press
 * or a focus split the key back.
 */

/** The kind of a team switch's key. */
export const TEAM_SWITCH = 'team'

/** `merge:PR_12` -> `['merge', 'PR_12']`; a key without a colon has no item id. */
export function splitKey(element: string): [string, string] {
  const colon = element.indexOf(':')
  return colon < 0 ? [element, ''] : [element.slice(0, colon), element.slice(colon + 1)]
}
