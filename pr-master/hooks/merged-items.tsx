import type { ElementTable } from 'claude-code'

import type { MergedPullRequestItem, Shipment, ShipmentStep } from '../types'
import { wrappedRows } from './items'

/** The Shipment dot colours, as theme keys. */
export const SHIPMENT_COLOUR: Record<ShipmentStep, string> = { arrived: 'success', running: 'warning', failed: 'error', unknown: 'inactive' }

/** The Shipment steps in pipeline order, with the names drawn beside their dots. */
const STEPS: readonly { step: keyof Omit<Shipment, 'tag'>; name: string }[] = [
  { step: 'ci', name: 'ci' },
  { step: 'release', name: 'release' },
  { step: 'stg', name: 'stg' },
  { step: 'prod', name: 'prod' },
]

/** The elements an item is drawn with, from `$.ui.resolve(e)`. */
type Elements = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

/**
 * A Merged pull request as a list item: a `▸` bullet, the title, and indented under it the four
 * Shipment dots with their names and the ref (with the release tag once one contains it).
 * `flexShrink` 0: an item never squeezes inside the clipping list.
 */
export function mergedPullRequestItem({ Box, Text, Button }: Elements, item: MergedPullRequestItem) {
  const { shipment } = item
  const ref = `#${item.number} ${repoName(item.repo)}${shipment.tag ? ` · ${shipment.tag}` : ''}`
  return (
    <Box key={`item:${item.id}`} flexDirection="row" flexShrink={0}>
      <Box width={BULLET_COLUMNS} flexShrink={0}>
        <Text color="suggestion">▸</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        {/* `actions.ts` answers the press. */}
        <Button key={`pr:${item.id}`} plain onPress={() => undefined}>
          <Text bold>{item.title}</Text>
        </Button>
        <Box flexDirection="column" paddingLeft={INDENT_COLUMNS}>
          <Box flexDirection="row" flexWrap="wrap">
            {/* Drawn spaces apart, not a gap: a gap left stale cells after a self-scroll. */}
            {STEPS.map(({ step, name }, index) => (
              <Text key={`${step}:${item.id}`}>
                <Text color={SHIPMENT_COLOUR[shipment[step]]}>●</Text>
                <Text dimColor>{index < STEPS.length - 1 ? ` ${name}  ` : ` ${name}`}</Text>
              </Text>
            ))}
          </Box>
          <Text dimColor wrap="truncate-end">{ref}</Text>
        </Box>
      </Box>
    </Box>
  )
}

/** The columns of the bullet and of the indent under the title. */
const BULLET_COLUMNS = 2
const INDENT_COLUMNS = 2

/**
 * The rows a Merged pull request takes in `columns`: its title wrapped, the Shipment line wrapped
 * under the indent, and the ref, truncated to one row. The list's scroll into view counts on it:
 * keep it in step with the drawing.
 */
export function mergedItemRows(item: MergedPullRequestItem, columns: number): number {
  const width = columns - BULLET_COLUMNS
  const shipmentLine = STEPS.map(({ name }) => `● ${name}`).join('  ')
  return wrappedRows(item.title, width) + wrappedRows(shipmentLine, width - INDENT_COLUMNS) + 1
}

/** `owner/name` -> `name`. */
function repoName(nameWithOwner: string): string {
  return nameWithOwner.slice(nameWithOwner.indexOf('/') + 1)
}
