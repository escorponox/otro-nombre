import { expect, test } from 'claude-code/testing'

import type { Analysis, PullRequestItem } from '../types'
import { analysisKey, analysisPrompt, continuePrompt, handedBackAnalysis, isOutOfDate, latestAnalyses, unlistedAnalysisKeys } from '../hooks/domain/analysis'

const SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const OLD_SHA = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567'

const item: PullRequestItem = {
  id: 'PR_41',
  number: 41,
  repo: 'acme/web',
  title: 'Cache the session token',
  url: 'https://github.com/acme/web/pull/41',
  author: 'ana',
  headSha: SHA,
  turn: 'mine',
  label: 'Needs review',
  ageDays: 2,
  isStale: false,
  isBehind: false,
}

const analysis = (headSha: string, analysedAt: number): Analysis => ({ kind: 'review', headSha, text: 'It caches.', analysedAt })

test('an analysis is kept under owner/repo#number@headSha', () => {
  expect(analysisKey('acme/web#41', SHA)).toBe(`acme/web#41@${SHA}`)
})

test('the analyses kept for pull requests no longer listed are the ones to forget; other store keys are not analyses', () => {
  const keys = [`acme/web#41@${SHA}`, `acme/web#41@${OLD_SHA}`, `acme/web#99@${SHA}`, `acme/api#41@${SHA}`, 'snapshot-cache', 'teamsOff']
  expect(unlistedAnalysisKeys(keys, [item])).toEqual([`acme/web#99@${SHA}`, `acme/api#41@${SHA}`])
})

test('the Review analysis prompt names the pull request, its head commit and what to answer, and forbids changing anything', () => {
  const prompt = analysisPrompt('review', item)
  expect(prompt).toContain('https://github.com/acme/web/pull/41')
  expect(prompt).toContain(SHA)
  expect(prompt).toContain('gh pr diff https://github.com/acme/web/pull/41')
  expect(prompt).toContain('What it does')
  expect(prompt).toContain('Risks')
  expect(prompt).toContain('What to look at')
  expect(prompt).toContain('Do not change anything')
})

test('an analysis of the pull request\'s head is up to date; one of an older commit is out of date', () => {
  expect(isOutOfDate(analysis(SHA, 1), item)).toBe(false)
  expect(isOutOfDate(analysis(OLD_SHA, 1), item)).toBe(true)
})

test('the stored analyses are read as the latest one of each pull request, other keys ignored', () => {
  const latest = latestAnalyses([
    [`acme/web#41@${OLD_SHA}`, analysis(OLD_SHA, 1)],
    [`acme/web#41@${SHA}`, analysis(SHA, 2)],
    [`acme/api#7@${OLD_SHA}`, analysis(OLD_SHA, 3)],
    ['snapshot-cache', { snapshot: {} }],
    ['acme/api#8@abc', 'not an analysis'],
  ])
  expect(latest).toEqual({ 'acme/web#41': analysis(SHA, 2), 'acme/api#7': analysis(OLD_SHA, 3) })
})

test('continuing in conversation hands the analysis over with the pull request and the commit it read', () => {
  const prompt = continuePrompt(analysis(SHA, 1), item)
  expect(prompt).toContain('Review analysis')
  expect(prompt).toContain('https://github.com/acme/web/pull/41')
  expect(prompt).toContain(SHA.slice(0, 7))
  expect(prompt).toContain('It caches.')
})

const myPullRequest: PullRequestItem = {
  ...item,
  id: 'PR_12',
  number: 12,
  repo: 'acme/api',
  url: 'https://github.com/acme/api/pull/12',
  author: 'coves',
  label: 'Checks failing',
}

test('the Unblock analysis prompt names the pull request, its head commit, its Readiness, how to fetch its blockers and what to answer, and forbids changing anything', () => {
  const prompt = analysisPrompt('unblock', myPullRequest)
  expect(prompt).toContain('https://github.com/acme/api/pull/12')
  expect(prompt).toContain(SHA)
  expect(prompt).toContain('Readiness: Checks failing')
  expect(prompt).toContain('gh pr checks https://github.com/acme/api/pull/12')
  expect(prompt).toContain('reviewThreads')
  expect(prompt).toContain('quill-reviewer')
  expect(prompt).toContain('Why it is not ready')
  expect(prompt).toContain('How to fix it')
  expect(prompt).toContain('Do not change anything')
  expect(prompt).not.toContain('Its branch is behind its base branch')
})

test('the Unblock analysis prompt names being behind the base branch as a blocker when it is', () => {
  expect(analysisPrompt('unblock', { ...myPullRequest, isBehind: true })).toContain('Its branch is behind its base branch')
})

/** A subagent's report as the engine hands it into the conversation. */
const handBack = (agentId: string) =>
  `Another Claude session sent a message:\n<agent-message from="${agentId}">\n[Subagent hand-back] The report follows:\n  Why it is not ready`
const started = { afb1e21edfeb795a4: 'Unblock analysis of #12 acme/api' }

test("an analysis subagent's hand-back is found by the id in its frame", () => {
  expect(handedBackAnalysis({ kind: 'peer' }, handBack('afb1e21edfeb795a4'), started)).toEqual({
    agentId: 'afb1e21edfeb795a4',
    name: 'Unblock analysis of #12 acme/api',
  })
  expect(handedBackAnalysis({ kind: 'task-notification' }, handBack('afb1e21edfeb795a4'), started)?.agentId).toBe('afb1e21edfeb795a4')
})

test('the hand-back of a subagent the mod did not start is not an analysis', () => {
  expect(handedBackAnalysis({ kind: 'peer' }, handBack('a0000000000000000'), started)).toBeUndefined()
})

test('a message with no hand-back frame is not an analysis', () => {
  expect(handedBackAnalysis({ kind: 'peer' }, 'Another Claude session sent a message: hello', started)).toBeUndefined()
})

test('what the person sends is never taken for a hand-back, even quoting one', () => {
  for (const kind of ['composer', 'bridge', 'sdk'] as const) {
    expect(handedBackAnalysis({ kind }, handBack('afb1e21edfeb795a4'), started)).toBeUndefined()
  }
})
