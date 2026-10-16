import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnCompleteInput } from 'claude-code'

import type { Analysis, AnalysisKind, PullRequestItem, RunningAnalysis } from '../types'
import { ANALYSIS_NAME, analysisKey, analysisOfAction, analysisPrompt, analysisRef, continuePrompt, latestAnalyses } from './domain/analysis'
import { EMPTY_SNAPSHOT, findItem } from './snapshot'

/** The subagent type every analysis runs on. */
const SUBAGENT_TYPE = 'general-purpose'

/** The key prefix of the Button that carries an analysis into the conversation. */
const CONTINUE = 'continue'

// The engine's scan only accepts atoms declared in the file that reads and writes them.
const snapshot = atom({ plugin: 'pr-master', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
/** Drawn on the refresh line by `pane.tsx`. */
const actionProblem = atom({ plugin: 'pr-master', key: 'actionProblem' } as const, null as string | null)
const analyses = atom({ plugin: 'pr-master', key: 'analyses' } as const, {} as Record<string, Analysis>)
const analysing = atom({ plugin: 'pr-master', key: 'analysing' } as const, {} as Record<string, RunningAnalysis>)

/**
 * The analyses: a press on an analysis action (see `ANALYSIS_ACTION`) starts a background subagent
 * with that analysis's prompt, one at a time per pull request; the subagent's `turn.complete`,
 * matched by its `agentId`, brings the result, kept in `$.store` under `owner/repo#number@headSha`
 * and shown under the pull request. Opening the panel reads the kept results; "Continue in
 * conversation" submits one as a prompt. The running analyses live in `$.state`, so a module
 * reload still matches their answers.
 */
export function registerAnalyses(on: On) {
  // Work after `next`: actions.ts clears the refresh line's problem on every press.
  on('ui.press', { plugin: 'pr-master' }, async ($, e, next) => {
    const pressed = await next(e)
    const [action, id] = splitKey(e.element)
    const kind = analysisOfAction(action)
    if (kind === undefined && action !== CONTINUE) return pressed
    const item = findItem(await read($, snapshot), id)
    if (!item) return pressed
    if (kind !== undefined) await analyse($, kind, item)
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
}

/** Starts a `kind` analysis of `item`'s head commit, unless one of the pull request already runs. */
async function analyse($: EngineInterface, kind: AnalysisKind, item: PullRequestItem) {
  const ref = analysisRef(item)
  let isStarting = false
  await update($, analysing, running => {
    if (running[ref]) return running
    isStarting = true
    return { ...running, [ref]: { kind, headSha: item.headSha } }
  })
  if (!isStarting) return

  const spawned = await $.agent.spawn({
    prompt: analysisPrompt(kind, item),
    description: `${ANALYSIS_NAME[kind]} of #${item.number} ${item.repo}`,
    subagentType: SUBAGENT_TYPE,
  })
  if (spawned.deny !== undefined) {
    await update($, analysing, ({ [ref]: _, ...others }) => others)
    await fail($, `Couldn't start the ${ANALYSIS_NAME[kind]} of #${item.number} ${item.repo} (${spawned.deny})`)
    return
  }
  await update($, analysing, running => ({ ...running, [ref]: { kind, headSha: item.headSha, agentId: spawned.agentId } }))
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

/** `review-analysis:PR_12` -> `['review-analysis', 'PR_12']`; a key without a colon has no item id. */
function splitKey(element: string): [string, string] {
  const colon = element.indexOf(':')
  return colon < 0 ? [element, ''] : [element.slice(0, colon), element.slice(colon + 1)]
}

