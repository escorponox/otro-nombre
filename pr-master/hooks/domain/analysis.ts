import type { Analysis, AnalysisKind, PullRequestItem } from '../../types'
import { QUILL_REVIEWER } from './readiness'

/** What each analysis is called, on its action and its result. */
export const ANALYSIS_NAME: Record<AnalysisKind, string> = { review: 'Review analysis', unblock: 'Unblock analysis' }

/** The action that runs each analysis: its Button is keyed `<action>:<item id>`. */
export const ANALYSIS_ACTION: Record<AnalysisKind, string> = { review: 'review-analysis', unblock: 'unblock-analysis' }

/** The analysis an action runs; undefined for an action that runs none. */
export function analysisOfAction(action: string): AnalysisKind | undefined {
  return (Object.keys(ANALYSIS_ACTION) as AnalysisKind[]).find(kind => ANALYSIS_ACTION[kind] === action)
}

/** The pull request an analysis is of: `owner/repo#number`. */
export function analysisRef(item: PullRequestItem): string {
  return `${item.repo}#${item.number}`
}

/** The `$.store` key of an analysis of the pull request `ref` (`owner/repo#number`) at a commit: `owner/repo#number@headSha`. */
export function analysisKey(ref: string, headSha: string): string {
  return `${ref}@${headSha}`
}

/** A store key of an analysis, split into the pull request and the commit; undefined for any other key. */
function parseAnalysisKey(key: string): { ref: string; headSha: string } | undefined {
  const match = /^([^#@/]+\/[^#@/]+#\d+)@(\w+)$/.exec(key)
  return match?.[1] && match[2] ? { ref: match[1], headSha: match[2] } : undefined
}

/** Whether the pull request has moved on from the commit the analysis read. */
export function isOutOfDate(analysis: Analysis, item: PullRequestItem): boolean {
  return analysis.headSha !== item.headSha
}

/** The latest analysis of each pull request among the store's entries, by `owner/repo#number`. */
export function latestAnalyses(entries: readonly (readonly [string, unknown])[]): Record<string, Analysis> {
  const latest: Record<string, Analysis> = {}
  for (const [key, value] of entries) {
    const parsed = parseAnalysisKey(key)
    if (!parsed || !isAnalysis(value)) continue
    const known = latest[parsed.ref]
    if (!known || value.analysedAt > known.analysedAt) latest[parsed.ref] = value
  }
  return latest
}

function isAnalysis(value: unknown): value is Analysis {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Analysis>
  return typeof candidate.kind === 'string' && typeof candidate.headSha === 'string' && typeof candidate.text === 'string' && typeof candidate.analysedAt === 'number'
}

/** The prompt of the background subagent that runs a `kind` analysis of `item`. */
export function analysisPrompt(kind: AnalysisKind, item: PullRequestItem): string {
  switch (kind) {
    case 'review':
      return reviewAnalysisPrompt(item)
    case 'unblock':
      return unblockAnalysisPrompt(item)
  }
}

/** Where every analysis prompt starts: the pull request, its head commit, how to read it, and to change nothing. */
function pullRequestBrief(item: PullRequestItem): string {
  return [
    `Pull request: ${item.url} (#${item.number} in ${item.repo}, "${item.title}" by ${item.author}), head commit ${item.headSha}.`,
    `Read it with the GitHub CLI: \`gh pr view ${item.url} --comments\` and \`gh pr diff ${item.url}\`; read files of the repository at that commit with \`gh api\` when the diff is not enough.`,
    'Do not change anything: no comments, reviews, approvals, pushes, branches or file edits. Only read.',
  ].join('\n')
}

/** How every analysis answer is shaped: it is drawn as plain text in a narrow panel. */
const ANSWER_SHAPE =
  'Answer in plain text, no Markdown: a short line per point, at most about 250 words, as each heading on its own line followed by its points starting with "- ".'

function reviewAnalysisPrompt(item: PullRequestItem): string {
  return [
    'Analyse this pull request for the person about to review it.',
    pullRequestBrief(item),
    'Answer under three headings:',
    'What it does: the change in a few lines.',
    'Risks: what could break or regress, security or data concerns, missing tests.',
    'What to look at: the files and lines a reviewer should read first, and why.',
    ANSWER_SHAPE,
  ].join('\n\n')
}

/**
 * The panel knows only the pull request's Readiness (the first blocker of its ladder) and whether
 * it is behind; the subagent fetches the rest of the blockers itself with `gh`.
 */
function unblockAnalysisPrompt(item: PullRequestItem): string {
  const known = [`Its Readiness: ${item.label}.`]
  if (item.isBehind) known.push('Its branch is behind its base branch.')
  return [
    'Analyse this pull request for its author, who wants to merge it.',
    pullRequestBrief(item),
    known.join(' '),
    [
      'The Readiness names only the first blocker found; check them all:',
      `- Failing checks: \`gh pr checks ${item.url}\`, then \`gh run view <run id> --log-failed\` for each failing run.`,
      `- Merge conflicts, behind its base branch, changes requested: \`gh pr view ${item.url} --json mergeable,mergeStateStatus,reviewDecision,reviews,baseRefName\`.`,
      `- Unresolved review threads, and which of them are Quill's (author \`${QUILL_REVIEWER}\`): \`gh api graphql\` on the pull request's \`reviewThreads\` (\`isResolved\`, \`path\`, \`line\`, and each comment's author login and body).`,
    ].join('\n'),
    'Answer under two headings:',
    'Why it is not ready: each blocker, with the failing check, conflicting files or thread it comes from.',
    'How to fix it: the steps that clear each blocker, in order.',
    ANSWER_SHAPE,
  ].join('\n\n')
}

/** The prompt that carries an analysis into the conversation. */
export function continuePrompt(analysis: Analysis, item: PullRequestItem): string {
  return [
    `Here is the ${ANALYSIS_NAME[analysis.kind]} of ${item.url} (#${item.number} in ${item.repo}, "${item.title}") at commit ${analysis.headSha.slice(0, 7)}:`,
    analysis.text,
    'Let us continue from it.',
  ].join('\n\n')
}
