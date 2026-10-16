import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, UiPressArgument } from 'claude-code'

import type { MergedPullRequestItem, PullRequestItem } from '../types'
import { splitKey } from './domain/element-key'
import { messageOf, refOf } from './domain/format'
import { EMPTY_SNAPSHOT, findItem } from './snapshot'

const OPEN_TIMEOUT_MS = 10_000

/** A pull request of any list: an open one or a merged one. */
type ListedItem = PullRequestItem | MergedPullRequestItem

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
/** Drawn on the refresh line by `pane.tsx`. */
const actionProblem = atom({ plugin: 'pr-master', key: 'actionProblem' } as const, null as string | null)

/**
 * The pull request actions. The pane draws each action's Button keyed `<kind>:<item id>` (see
 * `items.tsx`) with a closure that does nothing; this hook answers the press, since every `$` call
 * must live in the file holding its hook. Any press on the pane clears the last action's failure.
 *
 * To add an action: add it to `ACTIONS` in `items.tsx` and a `case` for its kind below.
 */
export function registerActions(on: On) {
  on('ui.press', { plugin: 'pr-master' }, async ($, e, next) => {
    await update($, actionProblem, () => null)
    const [kind, id] = splitKey(e.element)
    const item = findItem(await read($, snapshot), id)
    if (item) {
      switch (kind) {
        case 'pr':
          await openInBrowser($, item)
          break
        case 'copy':
          await copyLink($, e, item)
          break
      }
    }
    return next(e)
  })
}

/** Runs `open <url>`; a failure shows on the refresh line. */
async function openInBrowser($: EngineInterface, item: ListedItem) {
  try {
    const run = await $.process.run(['open', item.url], { timeoutMs: OPEN_TIMEOUT_MS })
    if (run.exitCode !== 0) await fail($, `Couldn't open ${refOf(item)} (${run.stderr.trim() || `exit ${run.exitCode}`})`)
  } catch (error) {
    await fail($, `Couldn't open ${refOf(item)} (${messageOf(error)})`)
  }
}

/** Copies the pull request's URL on the surface the press came from. */
async function copyLink($: EngineInterface, press: UiPressArgument, item: ListedItem) {
  const copied = await $.ui.copy({ text: item.url, surface: press.surface })
  if (!copied.isCopied) await fail($, `Couldn't copy the link of ${refOf(item)} (${copied.reason})`)
}

async function fail($: EngineInterface, problem: string) {
  await update($, actionProblem, () => problem)
}
