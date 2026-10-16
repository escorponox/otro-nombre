// PROTOTYPE — throwaway. Answers two questions:
//   1. Can a mod reach GitHub with the person's `gh` token ($.process.run + $.http.fetch)?
//   2. What should the PR panel look like? Three structurally different variants,
//      switched with `v`: A tabs+list, B triage by Turn, C master-detail.
// Write actions are stubs: the two-press confirmation is real, the action is not.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { MergedRow, Row, ShipStep, Snapshot, Turn } from '../types'

const PANE = 'pr-master-proto'
const VARIANTS = ['A', 'B', 'C']
const VARIANT_NAMES: Record<string, string> = { A: 'Tabs + list', B: 'Triage by Turn', C: 'Master-detail' }
const CONFIRM_MS = 3000

const snapshot = atom({ plugin: 'pr-master-proto', key: 'snapshot' } as const, null)
const variant = atom({ plugin: 'pr-master-proto', key: 'variant' } as const, 'A')
const tab = atom({ plugin: 'pr-master-proto', key: 'tab' } as const, 'mine')
const legend = atom({ plugin: 'pr-master-proto', key: 'legend' } as const, false)
const armed = atom({ plugin: 'pr-master-proto', key: 'armed' } as const, '')
const selected = atom({ plugin: 'pr-master-proto', key: 'selected' } as const, '')
const note = atom({ plugin: 'pr-master-proto', key: 'note' } as const, '')
// The list scrolls by whole items under a sticky header; the engine's own pane scroll is taken over.
const listOffset = atom({ plugin: 'pr-master-proto', key: 'listOffset' } as const, 0)

async function listIds($: any): Promise<string[]> {
  const snap = await read($, snapshot)
  if (!snap) return []
  const t = await read($, tab)
  return (t === 'mine' ? snap.mine : t === 'review' ? snap.review : snap.merged).map((r: { id: string }) => r.id)
}

const TURN_COLOR: Record<Turn, string> = { mine: 'error', theirs: 'warning', done: 'success', parked: 'inactive' }
const TURN_TEXT: Record<Turn, string> = {
  mine: 'Your move',
  theirs: 'Waiting on others',
  done: 'Nothing left to do',
  parked: 'Draft',
}
const STEP_COLOR: Record<ShipStep, string> = { arrived: 'success', running: 'warning', failed: 'error', unknown: 'inactive' }

// ---------- GitHub ----------

const PR_FIELDS = `
  id number title url isDraft mergeable mergeStateStatus reviewDecision createdAt
  author { login } repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`

function query(mergedSince: string): string {
  return `query {
    viewer { login }
    mine: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 30) {
      nodes { ... on PullRequest { ${PR_FIELDS} } } }
    review: search(query: "is:pr is:open archived:false draft:false review-requested:@me -author:@me sort:updated-desc", type: ISSUE, first: 20) {
      nodes { ... on PullRequest { ${PR_FIELDS} } } }
    merged: search(query: "is:pr is:merged author:@me archived:false merged:>${mergedSince} sort:updated-desc", type: ISSUE, first: 10) {
      nodes { ... on PullRequest { id number title url repository { nameWithOwner }
        mergeCommit { statusCheckRollup { state } } } } }
  }`
}

async function readToken($: any): Promise<{ token: string; how: string }> {
  for (const gh of ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    try {
      const run = await $.process.run([gh, 'auth', 'token'], { timeoutMs: 10000 })
      if (run.exitCode === 0 && run.stdout.trim()) return { token: run.stdout.trim(), how: `${gh} auth token ok` }
      return { token: '', how: `${gh} auth token exit ${run.exitCode}: ${run.stderr.trim().slice(0, 200)}` }
    } catch (error) {
      // try the next path
      if (gh === '/usr/local/bin/gh') return { token: '', how: `gh not runnable: ${String(error).slice(0, 200)}` }
    }
  }
  return { token: '', how: 'gh not found' }
}

function checksState(pr: any): string {
  return pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? 'NONE'
}

function mineRow(pr: any, now: number): Row {
  const checks = checksState(pr)
  let turn: Turn = 'theirs'
  let label = 'Waiting for review'
  if (pr.isDraft) [turn, label] = ['parked', 'Draft']
  else if (pr.mergeable === 'CONFLICTING') [turn, label] = ['mine', 'Merge conflicts']
  else if (checks === 'FAILURE' || checks === 'ERROR') [turn, label] = ['mine', 'Checks failing']
  else if (pr.reviewDecision === 'CHANGES_REQUESTED') [turn, label] = ['mine', 'Changes requested']
  else if (checks === 'PENDING' || checks === 'EXPECTED') [turn, label] = ['theirs', 'Checks running']
  else if (pr.mergeStateStatus === 'BEHIND') [turn, label] = ['theirs', 'Behind base branch']
  else if (['CLEAN', 'UNSTABLE', 'HAS_HOOKS'].includes(pr.mergeStateStatus)) [turn, label] = ['done', 'Ready to merge']
  return toRow(pr, turn, label, now)
}

function reviewRow(pr: any, now: number): Row {
  const checks = checksState(pr)
  let turn: Turn = 'mine'
  let label = 'Needs review'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') [turn, label] = ['theirs', 'Changes requested']
  else if (checks === 'FAILURE' || checks === 'ERROR') [turn, label] = ['theirs', 'Checks failing']
  else if (checks === 'PENDING' || checks === 'EXPECTED') [turn, label] = ['theirs', 'Checks running']
  else if (pr.reviewDecision === 'APPROVED') [turn, label] = ['done', 'Approved already']
  return toRow(pr, turn, label, now)
}

function toRow(pr: any, turn: Turn, label: string, now: number): Row {
  return {
    id: pr.id,
    ref: `${pr.repository.nameWithOwner}#${pr.number}`,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login ?? '?',
    turn,
    label,
    ageDays: Math.floor((now - Date.parse(pr.createdAt)) / 86400000),
  }
}

function mergedRow(pr: any): MergedRow {
  const state = pr.mergeCommit?.statusCheckRollup?.state
  const ci: ShipStep =
    state === 'SUCCESS' ? 'arrived' : state === 'FAILURE' || state === 'ERROR' ? 'failed' : state ? 'running' : 'unknown'
  // Release / stg / prod are MOCKED: the deployments-repo lookup is out of this prototype's question.
  return {
    id: pr.id,
    ref: `${pr.repository.nameWithOwner}#${pr.number}`,
    title: pr.title,
    url: pr.url,
    steps: { ci, release: 'unknown', stg: 'unknown', prod: 'unknown' },
  }
}

async function refresh($: any): Promise<void> {
  await update($, note, () => 'Refreshing…')
  const startedAt = await $.clock.now()
  const { token, how } = await readToken($)
  if (!token) {
    await update($, note, () => `Token: ${how}`)
    return
  }
  const since = new Date(startedAt - 7 * 86400000).toISOString().slice(0, 10)
  let response
  try {
    response = await $.http.fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'pr-master-proto' },
      body: JSON.stringify({ query: query(since) }),
    })
  } catch (error) {
    await update($, note, () => `Token: ${how} · fetch threw: ${String(error).slice(0, 200)}`)
    return
  }
  const elapsed = (await $.clock.now()) - startedAt
  const body = JSON.parse(response.text)
  if (!response.ok || body.errors) {
    await update($, note, () => `Token: ${how} · HTTP ${response.status} · ${JSON.stringify(body.errors ?? body).slice(0, 300)}`)
    return
  }
  const now = Date.now()
  const data = body.data
  const next: Snapshot = {
    login: data.viewer.login,
    mine: data.mine.nodes.filter((n: any) => n.id).map((n: any) => mineRow(n, now)),
    review: data.review.nodes.filter((n: any) => n.id).map((n: any) => reviewRow(n, now)),
    merged: data.merged.nodes.filter((n: any) => n.id).map(mergedRow),
    fetchedAt: now,
    diagnostics: `${how} · HTTP ${response.status} · ${elapsed} ms · rate ${response.headers['x-ratelimit-remaining'] ?? '?'} left`,
  }
  await update($, snapshot, () => next)
  await update($, note, () => '')
  showStatus($, next)
}

function showStatus($: any, snap: Snapshot): void {
  const ready = snap.mine.filter(r => r.turn === 'done').length
  const toReview = snap.review.filter(r => r.turn === 'mine').length
  const yourMove = snap.mine.filter(r => r.turn === 'mine').length
  const parts = [
    ready && `${ready} ready`,
    toReview && `${toReview} to review`,
    yourMove && `${yourMove} need you`,
  ].filter(Boolean)
  $.ui.status(parts.length ? `● ${parts.join(' · ')}` : undefined)
}

async function openInBrowser($: any, url: string): Promise<void> {
  const run = await $.process.run(['open', url], { timeoutMs: 10000 })
  await update($, note, () => (run.exitCode === 0 ? `Opened ${url}` : `open failed (exit ${run.exitCode}): ${run.stderr.trim().slice(0, 200)}`))
}

// ---------- two-press confirmation ----------

async function confirmOrArm($: any, key: string, action: string): Promise<void> {
  const current = await read($, armed)
  if (current === key) {
    await update($, armed, () => '')
    await update($, note, () => `STUB: would ${action} now (nothing was sent)`)
    return
  }
  await update($, armed, () => key)
  $.clock.after(CONFIRM_MS, () => update($, armed, cur => (cur === key ? '' : cur)))
}

// ---------- drawing ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'PROTOTYPE: open the PR panel variants' })
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    await $.ui.open({ id: PANE, title: 'PR Master (prototype)', focus: true })
    void refresh($)
    return { text: 'PR panel prototype opened.' }
  })

  // Moving the focus away from an armed button disarms it, and brings a list item scrolled out of view back into it.
  on('ui.focus', async ($, e, next) => {
    if (e.requestId === PANE) {
      const current = await read($, armed)
      if (current && e.element !== current) await update($, armed, () => '')
      const id = e.element?.split(':')[1]
      if (id && (await read($, variant)) === 'A') {
        const index = (await listIds($)).indexOf(id)
        if (index >= 0) {
          // The hotkeys follow the focus: the PR owning the focused element becomes the selected one.
          await update($, selected, () => id)
          await update($, listOffset, offset => (index < offset ? index : index > offset + 3 ? index - 3 : offset))
        }
      }
    }
    return next(e)
  })

  // Variant A: wheel and scroll keys move the list alone, one item per row asked, the header stays put.
  on('ui.scroll', async ($, e, next) => {
    if (e.requestId !== PANE || (await read($, variant)) !== 'A') return next(e)
    const count = (await listIds($)).length
    await update($, listOffset, offset => Math.max(0, Math.min(Math.max(0, count - 1), offset + Math.sign(e.by))))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const v = await read($, variant)
    const t = await read($, tab)
    const showLegend = await read($, legend)
    const armedKey = await read($, armed)
    const sel = await read($, selected)
    const msg = await read($, note)
    const offset = await read($, listOffset)
    const width = e.props.bodyColumns ?? 80

    const dot = (turn: Turn) => <Text color={TURN_COLOR[turn]}>●</Text>

    const actionButton = (key: string, label: string, hotkey: string | undefined, action: string) => (
      <Button
        key={key}
        hotkey={hotkey}
        variant={armedKey === key ? 'primary' : undefined}
        onPress={() => confirmOrArm($, key, action)}
      >
        {armedKey === key ? `Confirm ${label.toLowerCase()}?` : label}
      </Button>
    )

    // Hotkeys only on the selected PR's actions: with every PR showing its buttons, the same letter on all rows would clash.
    const actionsFor = (row: Row, kind: 'mine' | 'review', withHotkeys = true) => {
      const hk = (key: string) => (withHotkeys ? key : undefined)
      const buttons = [
        <Button key={`copy:${row.id}`} hotkey={hk('c')} onPress={press => $.ui.copy({ text: row.url, surface: press.surface })}>
          Copy link
        </Button>,
        kind === 'mine' && row.turn === 'done' && actionButton(`merge:${row.id}`, 'Squash merge', hk('m'), `squash-merge ${row.ref}`),
        kind === 'mine' && row.label === 'Behind base branch' &&
          actionButton(`update:${row.id}`, 'Update branch', hk('u'), `update branch of ${row.ref}`),
        kind === 'mine' && actionButton(`close:${row.id}`, 'Close', hk('x'), `close ${row.ref}`),
        kind === 'review' && actionButton(`approve:${row.id}`, 'Approve', hk('p'), `approve ${row.ref}`),
        <Button key={`analyse:${row.id}`} hotkey={hk('n')} onPress={() => update($, note, () => `STUB: would start ${kind === 'mine' ? 'Unblock' : 'Review'} analysis of ${row.ref}`)}>
          {kind === 'mine' ? 'Unblock analysis' : 'Review analysis'}
        </Button>,
      ].filter(Boolean)
      // A painted space between buttons instead of `gap`: an empty gap kept stale cells after a scroll.
      return (
        <Box flexDirection="row" flexWrap="wrap" flexShrink={0}>
          {buttons.flatMap((button, i) => (i === 0 ? [button] : [<Text> </Text>, button]))}
        </Box>
      )
    }

    const rowButton = (row: Row, extra?: string) => (
      <Button key={`row:${row.id}`} plain onPress={() => update($, selected, cur => (cur === row.id ? '' : row.id))}>
        <Text color={TURN_COLOR[row.turn]}>● </Text>
        {row.title} <Text dimColor>{row.ref} · {row.label}{extra ?? ''} · {row.ageDays}d</Text>
      </Button>
    )

    const shipment = (m: MergedRow) => (
      <Box flexDirection="column">
        <Button key={`merged:${m.id}`} plain onPress={() => update($, note, () => `STUB: would open ${m.url}`)}>
          {m.title} <Text dimColor>{m.ref}</Text>
        </Button>
        <Box flexDirection="row" gap={1} paddingLeft={2}>
          {(['ci', 'release', 'stg', 'prod'] as const).map(step => (
            <Text>
              <Text color={STEP_COLOR[m.steps[step]]}>●</Text> <Text dimColor>{step}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          Variant {v} · {VARIANT_NAMES[v]}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="variant" hotkey="v" plain onPress={() => update($, variant, cur => VARIANTS[(VARIANTS.indexOf(cur) + 1) % VARIANTS.length])}>
            variant
          </Button>
          <Button key="legend" hotkey="l" plain onPress={() => update($, legend, cur => !cur)}>
            legend
          </Button>
          <Button key="refresh" hotkey="r" plain onPress={() => void refresh($)}>
            refresh
          </Button>
        </Box>
      </Box>
    )

    const legendBox = showLegend && (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>Turn — who moves next</Text>
        {(['mine', 'theirs', 'done', 'parked'] as const).map(turn => (
          <Text>
            {dot(turn)} {TURN_TEXT[turn]}
          </Text>
        ))}
        <Text bold>Shipment — ci · release · stg · prod</Text>
        <Text>
          <Text color="success">●</Text> arrived <Text color="warning">●</Text> in progress <Text color="error">●</Text> failed{' '}
          <Text color="inactive">●</Text> n/a or unknown
        </Text>
      </Box>
    )

    const footer = (
      <Box flexDirection="column">
        {msg && <Text color="suggestion">{msg}</Text>}
        {snap && <Text dimColor>{snap.login} · {snap.diagnostics} · width {width}</Text>}
      </Box>
    )

    if (!snap) {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Text dimColor>No data yet.</Text>
          {footer}
        </Box>
      )
    }

    const tabs = (
      <Box flexDirection="row" gap={2}>
        {(
          [
            ['mine', 'Mine', snap.mine.length, '1'],
            ['review', 'Review', snap.review.length, '2'],
            ['merged', 'Merged', snap.merged.length, '3'],
          ] as const
        ).map(([id, label, count, hotkey]) => (
          <Button key={`tab:${id}`} hotkey={hotkey} variant={t === id ? 'primary' : undefined} onPress={async () => {
            await update($, tab, () => id)
            await update($, listOffset, () => 0)
          }}>
            {`${label} ${count}`}
          </Button>
        ))}
      </Box>
    )

    const shortRef = (row: Row) => {
      const [repo, number] = (row.ref.split('/')[1] ?? row.ref).split('#')
      return `#${number} ${repo}`
    }

    // A list item: a bullet with a hanging indent, the title beside it, the shipment info indented under the title.
    const mergedCard = (m: MergedRow) => (
      <Box flexDirection="row" flexShrink={0}>
        <Box width={2} flexShrink={0}>
          <Text color="suggestion">▸</Text>
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          <Button key={`merged:${m.id}`} plain onPress={() => update($, note, () => `STUB: would open ${m.url}`)}>
            <Text bold>{m.title}</Text>
          </Button>
          <Box flexDirection="column" paddingLeft={2}>
            <Box flexDirection="row" gap={1}>
              {(['ci', 'release', 'stg', 'prod'] as const).map(step => (
                <Text>
                  <Text color={STEP_COLOR[m.steps[step]]}>●</Text> <Text dimColor>{step}</Text>
                </Text>
              ))}
            </Box>
            <Text dimColor wrap="truncate-end">{m.ref}</Text>
          </Box>
        </Box>
      </Box>
    )

    // A list item: the Turn dot is the bullet; number and repo on one line (pressing it opens the PR), the title
    // indented under it, and the actions always on a line of their own. The item holding the focus is drawn
    // inverse and owns the hotkeys (`selected` follows the focus, see the ui.focus hook).
    // flexShrink 0: an item never squeezes to fit the list's height; the list clips it at the bottom instead.
    const prItem = (row: Row, kind: 'mine' | 'review') => (
      <Box flexDirection="row" flexShrink={0}>
        <Box width={2} flexShrink={0}>
          <Text color={TURN_COLOR[row.turn]}>●</Text>
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          {/* No hotkey here: a plain Button draws its hotkey as an `o:` prefix. Enter on it opens the PR. */}
          <Button key={`a:${row.id}`} plain onPress={() => openInBrowser($, row.url)}>
            <Text bold inverse={sel === row.id}>{shortRef(row)}</Text>{' '}
            <Text dimColor>· {row.label}{kind === 'review' ? ` · by ${row.author}` : ''} · {row.ageDays}d</Text>
          </Button>
          <Text>{row.title}</Text>
          {actionsFor(row, kind, sel === row.id)}
        </Box>
      </Box>
    )

    const listOf = (rows: Row[], kind: 'mine' | 'review') =>
      rows.length === 0 ? <Text dimColor>Nothing here.</Text> : rows.map(row => prItem(row, kind))

    // Variant A: header, legend and tabs stay put; only the list under them scrolls, by whole items.
    const listItems =
      t === 'mine' ? listOf(snap.mine, 'mine') : t === 'review' ? listOf(snap.review, 'review') : snap.merged.length ? snap.merged.map(mergedCard) : [<Text dimColor>Nothing here.</Text>]
    const items = Array.isArray(listItems) ? listItems : [listItems]
    const shown = items.slice(Math.min(offset, Math.max(0, items.length - 1)))
    const variantA = (
      <Box flexDirection="column" height={e.props.scroll.bodyRows} gap={1}>
        <Box flexDirection="column" flexShrink={0} gap={1}>
          {header}
          {legendBox}
          {tabs}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" gap={1}>
          {offset > 0 && (
            <Box flexShrink={0}>
              <Text dimColor>↑ {offset} more above</Text>
            </Box>
          )}
          {shown}
        </Box>
        <Box flexShrink={0}>{footer}</Box>
      </Box>
    )

    // Variant B: no tabs. Everything open, grouped by whose Turn it is; shipments as a strip at the end.
    const all = [...snap.mine.map(r => ({ r, kind: 'mine' as const })), ...snap.review.map(r => ({ r, kind: 'review' as const }))]
    const variantB = (
      <Box flexDirection="column" gap={1}>
        {(['mine', 'done', 'theirs', 'parked'] as const).map(turn => {
          const group = all.filter(x => x.r.turn === turn)
          if (group.length === 0) return <Box />
          return (
            <Box flexDirection="column">
              <Text bold>
                {dot(turn)} {TURN_TEXT[turn]} ({group.length})
              </Text>
              {group.map(({ r, kind }) => (
                <Box flexDirection="column" paddingLeft={2}>
                  {rowButton(r, kind === 'review' ? ` · review for ${r.author}` : ' · yours')}
                  {sel === r.id && <Box paddingLeft={2}>{actionsFor(r, kind)}</Box>}
                </Box>
              ))}
            </Box>
          )
        })}
        <Box flexDirection="column">
          <Text bold>Shipping</Text>
          {snap.merged.map(m => (
            <Text>
              {(['ci', 'release', 'stg', 'prod'] as const).map(step => (
                <Text color={STEP_COLOR[m.steps[step]]}>●</Text>
              ))}{' '}
              {m.title} <Text dimColor>{m.ref}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )

    // Variant C: compact list of dots + refs on the left, full detail and actions of the selected PR on the right.
    // Pressing the selected row again closes the detail; with no detail the list takes the full width.
    const current = t === 'merged' ? [] : t === 'mine' ? snap.mine : snap.review
    const focused = current.find(r => r.id === sel)
    const listWidth = focused ? Math.max(24, Math.floor(width * 0.4)) : width
    const variantC = (
      <Box flexDirection="column" gap={1}>
        {tabs}
        {t === 'merged' ? (
          <Box flexDirection="column" gap={1}>{snap.merged.map(mergedCard)}</Box>
        ) : (
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="column" width={listWidth} gap={focused ? 0 : 1}>
              {current.map(row => {
                const toggle = () => update($, selected, cur => (cur === row.id ? '' : row.id))
                if (focused) {
                  // Detail open: one compact line per PR.
                  return (
                    <Button key={`c:${row.id}`} plain onPress={toggle}>
                      <Text color={TURN_COLOR[row.turn]}>● </Text>
                      <Text bold={focused.id === row.id} inverse={focused.id === row.id} wrap="truncate-end">
                        {shortRef(row)}
                      </Text>
                    </Button>
                  )
                }
                // Detail closed: the Turn dot is the bullet; number and repo on one line, the title indented under it.
                return (
                  <Box flexDirection="row">
                    <Box width={2} flexShrink={0}>
                      <Text color={TURN_COLOR[row.turn]}>●</Text>
                    </Box>
                    <Box flexDirection="column" flexShrink={1}>
                      <Button key={`c:${row.id}`} plain onPress={toggle}>
                        <Text bold>{shortRef(row)}</Text> <Text dimColor>· {row.label} · {row.ageDays}d</Text>
                      </Button>
                      <Text>{row.title}</Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
            {focused ? (
              <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
                <Text bold>{focused.title}</Text>
                <Text dimColor>{focused.ref} · by {focused.author} · {focused.ageDays}d</Text>
                <Text>
                  {dot(focused.turn)} {TURN_TEXT[focused.turn]}: {focused.label}
                </Text>
                {actionsFor(focused, t === 'mine' ? 'mine' : 'review')}
              </Box>
            ) : current.length === 0 ? (
              <Text dimColor>Nothing here.</Text>
            ) : null}
          </Box>
        )}
      </Box>
    )

    if (v === 'A') return <Box width={width}>{variantA}</Box>

    return (
      <Box flexDirection="column" width={width} gap={1}>
        {header}
        {legendBox}
        {v === 'B' && variantB}
        {v === 'C' && variantC}
        {footer}
      </Box>
    )
  })
}
