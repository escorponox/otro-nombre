import type { ElementTable } from 'claude-code'

import type { PullRequestItem, Turn } from '../types'

/** The dot colours of a Turn, as theme keys. */
export const TURN_COLOUR: Record<Turn, string> = { mine: 'error', theirs: 'warning', done: 'success', parked: 'inactive' }

/** The elements an item is drawn with, from `$.ui.resolve(e)`. */
type Elements = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

/** What pressing an item's parts does; the pane supplies them, since `$` never crosses an import. */
export interface ItemHandlers {
  /** Pressing `#number repo`. */
  onOpen: (item: PullRequestItem) => unknown
}

/**
 * An action on a pull request: a Button keyed `<kind>:<item id>` on the item's action row, drawn
 * when the action `appliesTo` the item; `hotkey` presses it while its pull request holds the focus.
 * `actions.ts` runs it when pressed. To add an action, add it here and a case for its kind there.
 */
interface Action {
  kind: string
  label: string
  hotkey: string
  appliesTo: (item: PullRequestItem) => boolean
}

/** The actions, in their order on the row. */
const ACTIONS: readonly Action[] = [{ kind: 'copy', label: 'Copy link', hotkey: 'c', appliesTo: () => true }]

/** The columns a terminal Button takes beyond its label: it draws `[ label ]`. */
const BUTTON_CHROME_COLUMNS = 4

/** How an item is drawn besides its pull request. */
export interface ItemLook {
  /** It holds the focus: its `#number repo` is drawn inverse. */
  isFocused?: boolean
  /** A Review request also names its author, after the label. */
  showAuthor?: boolean
}

/** The columns of an item's bullet; its text wraps in the rest. */
const BULLET_COLUMNS = 2

/**
 * A pull request as a list item: its Turn dot as a two-column bullet, then a column with
 * `#number repo`, the label, the age and the stale mark on the first line, and the title under it,
 * wrapping with a hanging indent, and its action row under the title. `flexShrink` 0: an item never
 * squeezes inside the clipping list. The pull request holding the focus has its `#number repo` drawn
 * inverse, and only its actions carry hotkeys.
 */
export function pullRequestItem(
  { Box, Text, Button }: Elements,
  item: PullRequestItem,
  handlers: ItemHandlers,
  { isFocused = false, showAuthor = false }: ItemLook = {},
) {
  return (
    <Box key={`item:${item.id}`} flexDirection="row" flexShrink={0}>
      <Box width={BULLET_COLUMNS} flexShrink={0}>
        <Text color={TURN_COLOUR[item.turn]}>●</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        <Box flexDirection="row" flexWrap="wrap">
          {/* No hotkey: a plain Button draws its hotkey as a visible prefix. */}
          <Button key={`pr:${item.id}`} plain onPress={() => handlers.onOpen(item)}>
            <Text bold inverse={isFocused}>{`#${item.number} ${repoName(item.repo)}`}</Text>
          </Button>
          <Text dimColor>{' · '}</Text>
          <Text dimColor>{meta(item, showAuthor)}</Text>
          {item.isStale && <Text color="warning">{' · stale'}</Text>}
        </Box>
        <Text>{item.title}</Text>
        {actionRow({ Box, Text, Button }, item, isFocused)}
      </Box>
    </Box>
  )
}

/**
 * The Buttons of the actions that apply to `item`, on a line of their own, separated by a drawn
 * space: an empty `gap` left stale cells after the list scrolled. Pressing one does nothing here,
 * `actions.ts` answers the press. Hotkeys only on the focused pull request, so two never clash.
 */
function actionRow({ Box, Text, Button }: Elements, item: PullRequestItem, isFocused: boolean) {
  return (
    <Box key={`actions:${item.id}`} flexDirection="row" flexWrap="wrap">
      {actionsOf(item).flatMap((action, index) => [
        index > 0 && <Text>{' '}</Text>,
        <Button key={`${action.kind}:${item.id}`} hotkey={isFocused ? action.hotkey : undefined} onPress={() => undefined}>
          {action.label}
        </Button>,
      ])}
    </Box>
  )
}

function actionsOf(item: PullRequestItem): Action[] {
  return ACTIONS.filter(action => action.appliesTo(item))
}

/**
 * The rows `pullRequestItem` takes in a body `columns` wide, estimated as its lines wrapped at
 * the column's width (the first line as if marked stale, to err tall). The list's scroll into
 * view counts on it: keep it in step with the drawing.
 */
export function itemRows(item: PullRequestItem, columns: number, showAuthor = false): number {
  const firstLine = `#${item.number} ${repoName(item.repo)} · ${meta(item, showAuthor)} · stale`
  const width = columns - BULLET_COLUMNS
  return wrappedRows(firstLine, width) + wrappedRows(item.title, width) + actionRowRows(item, width)
}

/** The rows the action row takes in `columns`, its Buttons wrapping whole onto the next line. */
function actionRowRows(item: PullRequestItem, columns: number): number {
  let rows = 1
  let used = 0
  for (const action of actionsOf(item)) {
    const width = action.label.length + BUTTON_CHROME_COLUMNS
    const needed = used === 0 ? width : used + 1 + width
    if (needed > columns && used > 0) {
      rows++
      used = width
    } else {
      used = needed
    }
  }
  return rows
}

/** The rows `text` takes wrapped at `columns`; at least one. */
export function wrappedRows(text: string, columns: number): number {
  return Math.max(1, Math.ceil(text.length / Math.max(1, columns)))
}

/** The first line after `#number repo`: the label, the author when shown, and the age. */
function meta(item: PullRequestItem, showAuthor: boolean): string {
  const byAuthor = showAuthor ? ` · by ${item.author}` : ''
  return `${item.label}${byAuthor} · ${item.ageDays}d`
}

/** `owner/name` -> `name`. */
function repoName(nameWithOwner: string): string {
  return nameWithOwner.slice(nameWithOwner.indexOf('/') + 1)
}
