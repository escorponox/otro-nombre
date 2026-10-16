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
 * wrapping with a hanging indent. `flexShrink` 0: an item never squeezes inside the clipping list.
 * The pull request holding the focus has its `#number repo` drawn inverse.
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
      </Box>
    </Box>
  )
}

/**
 * The rows `pullRequestItem` takes in a body `columns` wide, estimated as its lines wrapped at
 * the column's width (the first line as if marked stale, to err tall). The list's scroll into
 * view counts on it: keep it in step with the drawing.
 */
export function itemRows(item: PullRequestItem, columns: number, showAuthor = false): number {
  const firstLine = `#${item.number} ${repoName(item.repo)} · ${meta(item, showAuthor)} · stale`
  return wrappedRows(firstLine, columns - BULLET_COLUMNS) + wrappedRows(item.title, columns - BULLET_COLUMNS)
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
