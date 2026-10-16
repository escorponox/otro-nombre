import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Snapshot, Tab } from '../types'
import { clampOffset, offsetShowing, scrolledOffset } from './domain/list-window'
import { TURN_COLOUR, itemRows, pullRequestItem, wrappedRows } from './items'
import type { ItemHandlers } from './items'
import { EMPTY_SNAPSHOT } from './snapshot'

export const PANE_ID = 'pr-master'
const PANE_TITLE = 'PR Master'

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const tab = atom({ plugin: 'pr-master', key: 'tab' } as const, 'mine' as Tab)
const legend = atom({ plugin: 'pr-master', key: 'legend' } as const, false)
/** Written by `refresh.ts`. */
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
const listOffset = atom({ plugin: 'pr-master', key: 'listOffset' } as const, 0)
const focused = atom({ plugin: 'pr-master', key: 'focused' } as const, null as string | null)

/**
 * The body the pane was last drawn in. `ui.focus` carries no size, and drawing may not write
 * `$.state`, so the scroll into view reads it here; a reload forgets it until the next draw.
 */
let lastBody = { rows: 40, columns: 60 }

/** The Shipment dot colours, as theme keys. */
const SHIPMENT_COLOUR = { arrived: 'success', running: 'warning', failed: 'error', unknown: 'inactive' } as const

const TURN_WORDS = { mine: 'Mine', theirs: 'Theirs', done: 'Done', parked: 'Parked' } as const

const TABS: readonly { id: Tab; label: string; hotkey: string }[] = [
  { id: 'mine', label: 'Mine', hotkey: '1' },
  { id: 'review', label: 'Review', hotkey: '2' },
  { id: 'merged', label: 'Merged', hotkey: '3' },
]

/**
 * The pane view: the `/prs` command that toggles the PR panel and the hooks that draw it.
 * Drawing reads `$.state` only.
 */
export function registerPane(on: On) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Open or close the PR panel' })
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    await togglePane($)
    return {}
  })

  registerListScroll(on)

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = await read($, tab)
    const isLegendShown = await read($, legend)
    const shot = await read($, snapshot)
    const count = (id: Tab) => listOf(shot, id).length
    const items = listOf(shot, shown)
    const offset = clampOffset(await read($, listOffset), items.length)
    const focusedId = await read($, focused)
    lastBody = { rows: e.props.scroll.bodyRows, columns: e.props.bodyColumns }

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{PANE_TITLE}</Text>
        <Box flexDirection="row">
          {/* refresh.ts answers the press: it hooks `ui.press` on this key. */}
          <Button key="refresh" hotkey="r" plain onPress={() => undefined}>
            refresh
          </Button>
          <Text> </Text>
          <Button key="legend" hotkey="l" plain onPress={() => update($, legend, isShown => !isShown)}>
            legend
          </Button>
        </Box>
      </Box>
    )

    const legendEntry = (key: string, colour: string, word: string) => (
      <Box key={`legend:${key}`} flexDirection="row">
        <Text color={colour}>●</Text>
        <Text> {word}</Text>
      </Box>
    )
    const legendBox = (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>Turn: who moves next</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {(['mine', 'theirs', 'done', 'parked'] as const).map(turn =>
            legendEntry(`turn:${turn}`, TURN_COLOUR[turn], TURN_WORDS[turn]),
          )}
        </Box>
        <Text bold>Shipment: CI · release · staging · production</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {(['arrived', 'running', 'failed', 'unknown'] as const).map(step =>
            legendEntry(`shipment:${step}`, SHIPMENT_COLOUR[step], step),
          )}
        </Box>
      </Box>
    )

    const tabs = (
      <Box flexDirection="row" gap={2}>
        {TABS.map(({ id, label, hotkey }) => (
          <Button
            key={`tab:${id}`}
            hotkey={hotkey}
            variant={shown === id ? 'primary' : undefined}
            onPress={() => showTab($, id)}
          >
            {`${label} ${count(id)}`}
          </Button>
        ))}
      </Box>
    )

    // Header, legend and tabs stay put; only the list box under them grows and clips.
    return (
      <Box flexDirection="column" width={e.props.bodyColumns} height={e.props.scroll.bodyRows} gap={1}>
        <Box flexDirection="column" flexShrink={0} gap={1}>
          {header}
          {isLegendShown && legendBox}
          {tabs}
        </Box>
        <Box key="list" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" gap={1}>
          {offset > 0 && <Text dimColor>{`↑ ${offset} more above`}</Text>}
          {items.length === 0 ? (
            <Text dimColor>No pull requests here.</Text>
          ) : (
            items.slice(offset).map(item => pullRequestItem({ Box, Text, Button }, item, ITEM_HANDLERS, item.id === focusedId))
          )}
        </Box>
        <Box key="footer" flexShrink={0}>
          <Text dimColor wrap="wrap">{refreshLine(shot)}</Text>
        </Box>
      </Box>
    )
  })
}

/** A tab shows from its top, with none of its pull requests focused yet. */
async function showTab($: EngineInterface, id: Tab) {
  await update($, tab, () => id)
  await update($, listOffset, () => 0)
  await update($, focused, () => null)
}

/**
 * The list scrolls itself, by whole pull requests: the mod answers the pane's `ui.scroll` without
 * `next`, so the engine's window never moves and the header, legend and tabs stay put. A `ui.focus`
 * on an element of a pull request (keyed `<kind>:<id>`) makes it the focused pull request and
 * scrolls it into view; one on anything else leaves none focused.
 */
function registerListScroll(on: On) {
  on('ui.scroll', { requestId: PANE_ID }, async ($, e) => {
    const count = listOf(await read($, snapshot), await read($, tab)).length
    await update($, listOffset, offset => scrolledOffset(offset, e.by, count))
    return {}
  })

  on('ui.focus', { requestId: PANE_ID }, async ($, e, next) => {
    const shot = await read($, snapshot)
    const isLegendShown = await read($, legend)
    const items = listOf(shot, await read($, tab))
    const id = e.element?.slice(e.element.indexOf(':') + 1)
    const index = items.findIndex(item => item.id === id)
    await update($, focused, () => items[index]?.id ?? null)
    if (index >= 0) {
      const heights = items.map(item => itemRows(item, lastBody.columns))
      const rows = listRows(lastBody, isLegendShown, refreshLine(shot))
      await update($, listOffset, offset => offsetShowing(index, { offset: clampOffset(offset, items.length), heights, rows }))
    }
    return next(e)
  })
}

/** The rows of the header line and of the tabs line. */
const HEADER_ROWS = 1
const TABS_ROWS = 1
/** The legend's rows: its border and four lines. */
const LEGEND_ROWS = 6
/** The blank line the pane's `gap` puts between two blocks. */
const GAP_ROWS = 1

/**
 * The rows the list box gets in a body: what the fixed block (header, legend, tabs), the refresh
 * line and the blank lines between them leave.
 */
function listRows(body: { rows: number; columns: number }, isLegendShown: boolean, footer: string): number {
  const fixed = HEADER_ROWS + GAP_ROWS + (isLegendShown ? LEGEND_ROWS + GAP_ROWS : 0) + TABS_ROWS
  return body.rows - fixed - GAP_ROWS - GAP_ROWS - wrappedRows(footer, body.columns)
}

// Opening a pull request in the browser comes with the action row (ticket 10).
const ITEM_HANDLERS: ItemHandlers = { onOpen: () => undefined }

/** The pull requests a tab lists. Review requests and Merged pull requests are not fetched yet. */
function listOf(shot: Snapshot, id: Tab) {
  return id === 'mine' ? shot.mine : []
}

/** How the last refresh went: when it last succeeded, or why it failed. */
function refreshLine({ updatedAt, problem }: Snapshot): string {
  const lastUpdated = updatedAt === null ? '' : ` · last updated ${clockTime(updatedAt)}`
  if (problem?.kind === 'no-token') {
    return "No GitHub token: run `gh auth login`, or set the GitHub token in pr-master's plugin options"
  }
  if (problem?.kind === 'failed') return `Couldn't refresh (${problem.reason})${lastUpdated}`
  return updatedAt === null ? 'Not refreshed yet' : `Updated ${clockTime(updatedAt)}`
}

/** `HH:MM` in the local time zone. */
function clockTime(ms: number): string {
  const time = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`
}

/** The engine's pane list is the source of truth: it survives a module reload and a close by the person. */
async function togglePane($: EngineInterface) {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE_ID)) {
    await $.ui.close({ id: PANE_ID })
  } else {
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true })
  }
}
