import type { ElementTable } from 'claude-code'

import type { ActionKind, ActionProgress, Analysis, MergedPullRequestItem, PullRequestItem, RunningAnalysis, Tab, Turn } from '../types'
import { ANALYSIS_ACTION, ANALYSIS_NAME, isOutOfDate } from './domain/analysis'
import { shortRefOf } from './domain/format'

/** The dot colours of a Turn, as theme keys. */
export const TURN_COLOUR: Record<Turn, string> = { mine: 'error', theirs: 'warning', done: 'success', parked: 'inactive' }

/** The elements an item is drawn with, from `$.ui.resolve(e)`. */
export type Elements = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

/** A pull request with the tab it is listed in: which actions apply depends on both. */
export type Listed = { tab: Exclude<Tab, 'merged'>; item: PullRequestItem } | { tab: 'merged'; item: MergedPullRequestItem }

/** How an item is drawn besides its pull request. */
export interface ItemLook {
  /** The tab it is listed in: which actions apply depends on it. */
  tab: Exclude<Tab, 'merged'>
  /** It holds the focus: its `#number repo` is drawn inverse and its actions carry hotkeys. */
  isFocused?: boolean
  /** A Review request also names its author, after the label. */
  showAuthor?: boolean
  /** The key of the write action Button waiting for its confirming press, wherever it is. */
  armed?: string | null
  /** Its last write action, under way or ended. */
  progress?: ActionProgress
  /** Its analysis: the one running and the latest result kept. */
  analysis?: ItemAnalysis
}

/** A pull request's analysis as drawn under it. */
export interface ItemAnalysis {
  running?: RunningAnalysis
  result?: Analysis
}

/** The label of the Button that carries an analysis into the conversation. */
const CONTINUE_LABEL = 'Continue in conversation'

/**
 * The words of a write action: its Button's label while armed, and its progress on the row while
 * it runs, once done, and when it failed (followed by GitHub's reason).
 */
interface WriteWords {
  confirm: string
  running: string
  done: string
  failed: string
}

/**
 * An action on a pull request: a Button keyed `<kind>:<item id>` on the item's action row, drawn
 * when the action `appliesTo` the item in its tab (Merged pull requests included); `hotkey` presses it while its pull request holds
 * the focus. `actions.ts` runs it when pressed. To add an action, add it here and a case for its
 * kind there. A write action has `write` words instead: its first press arms it and a second one
 * runs it; `refresh.ts` runs it, with the mutation `github/write-actions.ts` gives for its kind.
 */
interface Action {
  kind: ActionKind
  label: string
  hotkey: string
  appliesTo: (listed: Listed) => boolean
  write?: WriteWords
}

/** The actions, in their order on the row. */
const ACTIONS: readonly Action[] = [
  { kind: 'copy', label: 'Copy link', hotkey: 'c', appliesTo: () => true },
  {
    kind: 'merge',
    label: 'Squash merge',
    hotkey: 'm',
    // Turn Done on a My pull request is Ready to merge.
    appliesTo: listed => listed.tab === 'mine' && listed.item.turn === 'done',
    write: { confirm: 'Confirm merge?', running: 'Merging…', done: 'Merged', failed: "Couldn't merge" },
  },
  {
    kind: 'update',
    label: 'Update branch',
    hotkey: 'u',
    appliesTo: listed => listed.tab === 'mine' && listed.item.isBehind,
    write: { confirm: 'Confirm update?', running: 'Updating branch…', done: 'Branch updated', failed: "Couldn't update the branch" },
  },
  {
    kind: 'close',
    label: 'Close',
    hotkey: 'x',
    appliesTo: listed => listed.tab === 'mine',
    write: { confirm: 'Confirm close?', running: 'Closing…', done: 'Closed', failed: "Couldn't close" },
  },
  {
    kind: 'approve',
    label: 'Approve',
    hotkey: 'p',
    appliesTo: listed => listed.tab === 'review',
    write: { confirm: 'Confirm approve?', running: 'Approving…', done: 'Approved', failed: "Couldn't approve" },
  },
  // `analyses.ts` answers the analysis actions' presses.
  { kind: ANALYSIS_ACTION.review, label: ANALYSIS_NAME.review, hotkey: 'n', appliesTo: listed => listed.tab === 'review' },
  { kind: ANALYSIS_ACTION.unblock, label: ANALYSIS_NAME.unblock, hotkey: 'n', appliesTo: listed => listed.tab === 'mine' },
]

/** The columns a terminal Button takes beyond its label: it draws `[ label ]`. */
const BUTTON_CHROME_COLUMNS = 4

/** The columns of an item's bullet; its text wraps in the rest. */
export const BULLET_COLUMNS = 2

/**
 * A pull request as a list item: its Turn dot as a two-column bullet, then a column with
 * `#number repo`, the label, the age and the stale mark on the first line, and the title under it,
 * wrapping with a hanging indent, and its action row under the title. `flexShrink` 0: an item never
 * squeezes inside the clipping list. The pull request holding the focus has its `#number repo` drawn
 * inverse, and only its actions carry hotkeys.
 */
export function pullRequestItem({ Box, Text, Button }: Elements, item: PullRequestItem, look: ItemLook) {
  const { isFocused = false, showAuthor = false, analysis = {} } = look
  return (
    <Box key={`item:${item.id}`} flexDirection="row" flexShrink={0}>
      <Box width={BULLET_COLUMNS} flexShrink={0}>
        <Text color={TURN_COLOUR[item.turn]}>●</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        <Box flexDirection="row" flexWrap="wrap">
          {/* No hotkey: a plain Button draws its hotkey as a visible prefix. `actions.ts` answers the press. */}
          <Button key={`pr:${item.id}`} plain onPress={() => undefined}>
            <Text bold inverse={isFocused}>{shortRefOf(item)}</Text>
          </Button>
          <Text dimColor>{' · '}</Text>
          <Text dimColor>{meta(item, showAuthor)}</Text>
          {item.isStale && <Text color="warning">{' · stale'}</Text>}
        </Box>
        <Text>{item.title}</Text>
        {actionRow({ Box, Text, Button }, { tab: look.tab, item }, look)}
        {(analysis.running || analysis.result) && analysisBlock({ Box, Text, Button }, item, analysis)}
      </Box>
    </Box>
  )
}

/** How an action row is drawn: whether its pull request holds the focus, and its write action's state. */
export type RowLook = Pick<ItemLook, 'isFocused' | 'armed' | 'progress'>

/**
 * The Buttons of the actions that apply to the listed pull request, on a line of their own,
 * separated by a drawn space: an empty `gap` left stale cells after the list scrolled, then its
 * last write action's progress. Pressing one does nothing here, `actions.ts` and `refresh.ts` answer the press. Hotkeys
 * only on the focused pull request, so two never clash. An armed write action reads "Confirm …?",
 * in the primary variant. No modal dialog: the confirmation is the Button itself.
 */
export function actionRow({ Box, Text, Button }: Elements, listed: Listed, look: RowLook) {
  const { item } = listed
  const progress = progressText(look.progress)
  const hasFailed = look.progress?.phase === 'failed'
  return (
    <Box key={`actions:${item.id}`} flexDirection="row" flexWrap="wrap">
      {actionsOf(listed).flatMap((action, index) => {
        const key = `${action.kind}:${item.id}`
        const isArmed = action.write !== undefined && look.armed === key
        return [
          index > 0 && <Text>{' '}</Text>,
          <Button
            key={key}
            hotkey={look.isFocused ? action.hotkey : undefined}
            variant={isArmed ? 'primary' : undefined}
            onPress={() => undefined}
          >
            {isArmed ? action.write?.confirm : action.label}
          </Button>,
        ]
      })}
      {progress !== undefined && <Text>{' '}</Text>}
      {progress !== undefined && (
        <Text color={hasFailed ? 'error' : undefined} dimColor={!hasFailed}>
          {progress}
        </Text>
      )}
    </Box>
  )
}

/**
 * Under the action row: "analysing…" while an analysis runs, and the latest result kept, headed by
 * its name and commit, marked out of date when the pull request has moved on, with the Button that
 * carries it into the conversation (`analyses.ts` answers its press).
 */
function analysisBlock({ Box, Text, Button }: Elements, item: PullRequestItem, { running, result }: ItemAnalysis) {
  return (
    <Box key={`analysis:${item.id}`} flexDirection="column">
      {running && <Text dimColor>{runningLine(running)}</Text>}
      {result && (
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold>{resultHeading(result)}</Text>
          {isOutOfDate(result, item) && <Text color="warning">{outOfDateMark(result)}</Text>}
        </Box>
      )}
      {result && <Text wrap="wrap">{result.text}</Text>}
      {result && (
        <Button key={`continue:${item.id}`} onPress={() => undefined}>
          {CONTINUE_LABEL}
        </Button>
      )}
    </Box>
  )
}

const runningLine = (running: RunningAnalysis) => `${ANALYSIS_NAME[running.kind]}: analysing…`
const resultHeading = (result: Analysis) => `${ANALYSIS_NAME[result.kind]} of ${result.headSha.slice(0, 7)}`
const outOfDateMark = (result: Analysis) => ` · out of date, new commits since: press ${ANALYSIS_NAME[result.kind]} to run it again`

function actionsOf(listed: Listed): Action[] {
  return ACTIONS.filter(action => action.appliesTo(listed))
}

/** What a write action's progress reads: `Merging…`, `Merged`, `Couldn't merge (reason)`. */
function progressText(progress: ActionProgress | undefined): string | undefined {
  const words = ACTIONS.find(action => action.kind === progress?.kind)?.write
  if (!progress || !words) return undefined
  if (progress.phase === 'running') return words.running
  if (progress.phase === 'done') return words.done
  return `${words.failed} (${progress.problem ?? 'unknown error'})`
}

/**
 * The rows `pullRequestItem` takes in a body `columns` wide, estimated as its lines wrapped at
 * the column's width (the first line as if marked stale, to err tall). The list's scroll into
 * view counts on it: keep it in step with the drawing.
 */
export function itemRows(item: PullRequestItem, columns: number, look: ItemLook): number {
  const firstLine = `${shortRefOf(item)} · ${meta(item, look.showAuthor ?? false)} · stale`
  const width = columns - BULLET_COLUMNS
  return (
    wrappedRows(firstLine, width) +
    wrappedRows(item.title, width) +
    actionRowRows({ tab: look.tab, item }, width, look) +
    analysisRows(item, look.analysis ?? {}, width)
  )
}

/** The rows `analysisBlock` takes in `columns`; none when there is no analysis to draw. */
function analysisRows(item: PullRequestItem, { running, result }: ItemAnalysis, columns: number): number {
  let rows = running ? wrappedRows(runningLine(running), columns) : 0
  if (result) {
    const heading = resultHeading(result) + (isOutOfDate(result, item) ? outOfDateMark(result) : '')
    rows += wrappedRows(heading, columns)
    rows += result.text.split('\n').reduce((sum, line) => sum + wrappedRows(line, columns), 0)
    rows += wrappedRows(CONTINUE_LABEL, columns - BUTTON_CHROME_COLUMNS)
  }
  return rows
}

/**
 * The rows the action row takes in `columns`, its Buttons (as if armed, to err tall) and then its
 * progress wrapping whole onto the next line.
 */
export function actionRowRows(listed: Listed, columns: number, look: RowLook): number {
  const progress = progressText(look.progress)
  const widths = [
    ...actionsOf(listed).map(action => Math.max(action.label.length, action.write?.confirm.length ?? 0) + BUTTON_CHROME_COLUMNS),
    ...(progress === undefined ? [] : [progress.length]),
  ]
  let rows = 1
  let used = 0
  for (const width of widths) {
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
