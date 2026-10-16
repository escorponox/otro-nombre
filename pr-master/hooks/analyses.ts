import { atom, read, update } from 'claude-code'
import type { AgentSpawnResult, EngineInterface, On, TurnCompleteInput } from 'claude-code'

import type { Analysis, AnalysisKind, PullRequestItem, RunningAnalysis } from '../types'
import { ANALYSIS_NAME, analysisKey, analysisOfAction, analysisPrompt, analysisRef, continuePrompt, handedBackAnalysis, latestAnalyses } from './domain/analysis'
import { splitKey } from './domain/element-key'
import { messageOf, refOf } from './domain/format'
import { EMPTY_SNAPSHOT, findOpenItem } from './snapshot'

/** The subagent type every analysis runs on: read-only tools, since an analysis changes nothing. */
const SUBAGENT_TYPE = 'Explore'

/** The key prefix of the Button that carries an analysis into the conversation. */
const CONTINUE = 'continue'

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
/** Drawn on the refresh line by `pane.tsx`. */
const actionProblem = atom({ plugin: 'pr-master', key: 'actionProblem' } as const, null as string | null)
const analyses = atom({ plugin: 'pr-master', key: 'analyses' } as const, {} as Record<string, Analysis>)
const analysing = atom({ plugin: 'pr-master', key: 'analysing' } as const, {} as Record<string, RunningAnalysis>)
const handBacks = atom({ plugin: 'pr-master', key: 'handBacks' } as const, {} as Record<string, string>)

/**
 * The analyses: a press on an analysis action (see `ANALYSIS_ACTION`) starts a background subagent
 * with that analysis's prompt, one at a time per pull request; the subagent's `turn.complete`,
 * matched by its `agentId`, brings the result, kept in `$.store` under `owner/repo#number@headSha`
 * and shown under the pull request. Opening the panel reads the kept results; "Continue in
 * conversation" submits one as a prompt. The running analyses live in `$.state`, so a module
 * reload still matches their answers. The engine also hands each subagent's report to the
 * conversation, which would start a turn on it: that delivery is dropped, the panel showing it.
 */
export function registerAnalyses(on: On) {
  // Work after `next`: actions.ts clears the refresh line's problem on every press.
  on('ui.press', { plugin: 'pr-master' }, async ($, e, next) => {
    const pressed = await next(e)
    const [action, id] = splitKey(e.element)
    const kind = analysisOfAction(action)
    if (kind === undefined && action !== CONTINUE) return pressed
    const item = findOpenItem(await read($, snapshot), id)
    if (!item) return pressed
    // The subagent may take a while to start: the press does not wait for it.
    if (kind !== undefined) void analyse($, kind, item)
    else await continueInConversation($, item)
    return pressed
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await finish($, e.agentId, e)
    return next(e)
  })

  on('ui.open', { id: 'pr-master' }, async ($, e, next) => {
    const opened = await next(e)
    await readKeptAnalyses($)
    return opened
  })

  // A hook that fails is skipped, so the hand-back then reaches the conversation: nothing is lost.
  on('prompt.submit', async ($, e, next) => {
    const handedBack = handedBackAnalysis(e.origin, e.text, await read($, handBacks))
    if (!handedBack) return next(e)
    await update($, handBacks, ({ [handedBack.agentId]: _, ...others }) => others)
    return { drop: `The ${handedBack.name} is in the PR panel` }
  })
}

/**
 * Starts a `kind` analysis of `item`'s head commit, unless one of the pull request already runs.
 * A spawn that is refused, fails or hands back no `agentId` (so its answer could never be matched)
 * leaves nothing running and says why on the refresh line.
 */
async function analyse($: EngineInterface, kind: AnalysisKind, item: PullRequestItem) {
  const ref = analysisRef(item)
  let isStarting = false
  await update($, analysing, running => {
    if (running[ref]) return running
    isStarting = true
    return { ...running, [ref]: { kind, headSha: item.headSha } }
  })
  if (!isStarting) return

  const stop = async (problem: string) => {
    await update($, analysing, ({ [ref]: _, ...others }) => others)
    await fail($, problem)
  }
  const name = `${ANALYSIS_NAME[kind]} of ${refOf(item)}`
  let spawned: AgentSpawnResult
  try {
    spawned = await $.agent.spawn({ prompt: analysisPrompt(kind, item), description: name, subagentType: SUBAGENT_TYPE })
  } catch (error) {
    await stop(`Couldn't start the ${name} (${messageOf(error)})`)
    return
  }
  if (spawned.deny !== undefined) {
    await stop(`Couldn't start the ${name} (${spawned.deny})`)
  } else if (spawned.agentId === undefined) {
    await stop(`Couldn't follow the ${name} (no subagent id)`)
  } else {
    const { agentId } = spawned
    await update($, analysing, running => ({ ...running, [ref]: { kind, headSha: item.headSha, agentId } }))
    await update($, handBacks, names => ({ ...names, [agentId]: name }))
  }
}

/**
 * The end of a subagent's turn: when it is one of this session's analyses, keeps its answer for the
 * pull request and commit (dropping older ones of the pull request) and shows it.
 */
async function finish($: EngineInterface, agentId: string, end: TurnCompleteInput) {
  const entry = Object.entries(await read($, analysing)).find(([, running]) => running.agentId === agentId)
  if (!entry) return
  const [ref, running] = entry
  await update($, analysing, ({ [ref]: _, ...others }) => others)

  const text = end.answer.trim()
  if (end.reason !== 'answer' || text === '') {
    await fail($, `The ${ANALYSIS_NAME[running.kind]} of ${ref} ended with no answer (${end.reason})`)
    return
  }
  const analysis: Analysis = { kind: running.kind, headSha: running.headSha, text, analysedAt: await $.clock.now() }
  const key = analysisKey(ref, running.headSha)
  for (const older of (await $.store.keys()).filter(other => other.startsWith(`${ref}@`) && other !== key)) {
    await $.store.delete(older)
  }
  await $.store.set(key, analysis)
  await update($, analyses, kept => ({ ...kept, [ref]: analysis }))
}

/** Reads the analyses kept in `$.store`, by this session or another, into the panel. */
async function readKeptAnalyses($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.includes('#') && key.includes('@'))
  const entries = await Promise.all(keys.map(async key => [key, await $.store.get(key)] as const))
  await update($, analyses, () => latestAnalyses(entries))
}

/** Submits the pull request's latest analysis into the conversation. */
async function continueInConversation($: EngineInterface, item: PullRequestItem) {
  const analysis = (await read($, analyses))[analysisRef(item)]
  if (analysis) await $.prompt.submit({ text: continuePrompt(analysis, item) })
}

async function fail($: EngineInterface, problem: string) {
  await update($, actionProblem, () => problem)
}

