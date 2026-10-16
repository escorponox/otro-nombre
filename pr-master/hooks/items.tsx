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
 * A pull request as a list item: its Turn dot as a two-column bullet, then a column with
 * `#number repo`, the label, the age and the stale mark on the first line, and the title under it,
 * wrapping with a hanging indent. `flexShrink` 0: an item never squeezes inside the clipping list.
 */
export function pullRequestItem({ Box, Text, Button }: Elements, item: PullRequestItem, handlers: ItemHandlers) {
  return (
    <Box key={`item:${item.id}`} flexDirection="row" flexShrink={0}>
      <Box width={2} flexShrink={0}>
        <Text color={TURN_COLOUR[item.turn]}>●</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        <Box flexDirection="row" flexWrap="wrap">
          {/* No hotkey: a plain Button draws its hotkey as a visible prefix. */}
          <Button key={`pr:${item.id}`} plain onPress={() => handlers.onOpen(item)}>
            <Text bold>{`#${item.number} ${repoName(item.repo)}`}</Text>
          </Button>
          <Text dimColor>{' · '}</Text>
          <Text dimColor>{`${item.label} · ${item.ageDays}d`}</Text>
          {item.isStale && <Text color="warning">{' · stale'}</Text>}
        </Box>
        <Text>{item.title}</Text>
      </Box>
    </Box>
  )
}

/** `owner/name` -> `name`. */
function repoName(nameWithOwner: string): string {
  return nameWithOwner.slice(nameWithOwner.indexOf('/') + 1)
}
