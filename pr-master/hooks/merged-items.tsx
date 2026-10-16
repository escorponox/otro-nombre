import type { ElementTable } from 'claude-code'

import type { MergedPullRequestItem, Shipment, ShipmentStep } from '../types'

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

/** What pressing a Merged pull request's parts does; the pane supplies them, since `$` never crosses an import. */
export interface MergedItemHandlers {
  /** Pressing its title. */
  onOpen: (item: MergedPullRequestItem) => unknown
}

/**
 * A Merged pull request as a list item: a `▸` bullet, the title, and indented under it the four
 * Shipment dots with their names and the ref (with the release tag once one contains it).
 * `flexShrink` 0: an item never squeezes inside the clipping list.
 */
export function mergedPullRequestItem({ Box, Text, Button }: Elements, item: MergedPullRequestItem, handlers: MergedItemHandlers) {
  const { shipment } = item
  const ref = `#${item.number} ${repoName(item.repo)}${shipment.tag ? ` · ${shipment.tag}` : ''}`
  return (
    <Box key={`item:${item.id}`} flexDirection="row" flexShrink={0}>
      <Box width={2} flexShrink={0}>
        <Text color="suggestion">▸</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        <Button key={`pr:${item.id}`} plain onPress={() => handlers.onOpen(item)}>
          <Text bold>{item.title}</Text>
        </Button>
        <Box flexDirection="column" paddingLeft={2}>
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

/** `owner/name` -> `name`. */
function repoName(nameWithOwner: string): string {
  return nameWithOwner.slice(nameWithOwner.indexOf('/') + 1)
}
